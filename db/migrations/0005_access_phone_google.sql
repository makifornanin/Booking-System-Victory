-- Account access approval, phone numbers, Google Calendar sync and the daily verse cache.

-- ---------------------------------------------------------------------------
-- Profiles: phone + access approval
-- ---------------------------------------------------------------------------
create type public.access_status as enum ('pending', 'active', 'denied', 'revoked');

alter table public.profiles
  add column phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column access_status public.access_status not null default 'pending',
  add column access_reason text check (access_reason is null or char_length(access_reason) <= 500),
  add column access_reviewed_by uuid references public.profiles (id) on delete set null,
  add column access_reviewed_at timestamptz,
  -- Set when the GHL account-status notification failed, so admins can retry it.
  add column access_notification_error text,
  -- Cached GHL contact for this person, so approvals don't search GHL every time.
  add column ghl_contact_id text,
  add constraint profiles_reason_required check (
    access_status not in ('denied', 'revoked')
    or (access_reason is not null and char_length(btrim(access_reason)) > 0)
  );

create index profiles_access_status_idx on public.profiles (access_status, created_at desc);

-- Admins must also have active access; revoking an admin removes admin rights.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = public.app_current_user_id() and role = 'admin' and access_status = 'active'
  );
$$;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = public.app_current_user_id() and access_status = 'active'
  );
$$;

revoke execute on function public.is_active_member() from public;
grant execute on function public.is_active_member() to app_member;

-- Pending, denied and revoked accounts can sign in but see nothing in the portal.
drop policy "Members read active rooms" on public.rooms;
create policy "Active members read active rooms"
  on public.rooms for select to app_member
  using ((select public.is_active_member()) and (is_active or (select public.is_admin())));

drop policy "Members read their own bookings" on public.bookings;
create policy "Active members read their own bookings"
  on public.bookings for select to app_member
  using (user_id = public.app_current_user_id() and (select public.is_active_member()));

drop policy "Members create their own pending bookings" on public.bookings;
create policy "Active members create their own pending bookings"
  on public.bookings for insert to app_member
  with check (
    user_id = public.app_current_user_id()
    and (select public.is_active_member())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and denial_reason is null
    and ghl_appointment_id is null
    and review_locked_at is null
  );

drop policy "Members read live announcements" on public.announcements;
create policy "Active members read live announcements"
  on public.announcements for select to app_member
  using (
    (select public.is_active_member())
    and is_published
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
  );

-- Access decisions go through this function only (members have no update grant on
-- these columns), so a member can never change their own access status.
create or replace function public.admin_set_user_access(p_user_id uuid, p_status public.access_status, p_reason text)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.access_status;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change account access' using errcode = '42501';
  end if;
  if p_user_id = public.app_current_user_id() then
    raise exception 'Admins cannot change their own access' using errcode = 'check_violation';
  end if;

  select access_status into current_status from public.profiles where id = p_user_id for update;
  if not found then
    return;
  end if;

  if not (
    (current_status = 'pending' and p_status in ('active', 'denied'))
    or (current_status = 'active' and p_status = 'revoked')
    or (current_status in ('denied', 'revoked') and p_status = 'active')
  ) then
    raise exception 'Invalid access change from % to %', current_status, p_status using errcode = 'check_violation';
  end if;

  return query
    update public.profiles
    set access_status = p_status,
        access_reason = case when p_status in ('denied', 'revoked') then nullif(btrim(p_reason), '') else null end,
        access_reviewed_by = public.app_current_user_id(),
        access_reviewed_at = now(),
        access_notification_error = null
    where id = p_user_id
    returning *;
end;
$$;

create or replace function public.admin_set_access_notification(p_user_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can record notifications' using errcode = '42501';
  end if;
  update public.profiles set access_notification_error = p_error where id = p_user_id;
end;
$$;

create or replace function public.admin_set_ghl_contact(p_user_id uuid, p_contact_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can link GHL contacts' using errcode = '42501';
  end if;
  update public.profiles set ghl_contact_id = p_contact_id where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bookings: Google Calendar event + cancellation of approved bookings
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column google_calendar_event_id text,
  add column google_calendar_sync_error text;

-- Records the result of syncing a booking to the owner's Google Calendar.
create or replace function public.set_booking_calendar_sync(p_booking_id uuid, p_event_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings
  set google_calendar_event_id = p_event_id,
      google_calendar_sync_error = p_error
  where id = p_booking_id
    and (public.is_admin() or (user_id = public.app_current_user_id() and public.is_active_member()));
end;
$$;

-- Members can cancel their own future pending or approved booking. For approved
-- bookings the server cancels the GHL appointment first.
create or replace function public.cancel_my_booking(p_booking_id uuid)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.app_current_user_id() is null or not public.is_active_member() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
    update public.bookings
    set status = 'cancelled'
    where id = p_booking_id
      and user_id = public.app_current_user_id()
      and status in ('pending', 'approved')
      and start_time > now()
      and (review_locked_at is null or review_locked_at < now() - interval '2 minutes')
    returning *;
end;
$$;

revoke execute on function public.admin_set_user_access(uuid, public.access_status, text) from public;
revoke execute on function public.admin_set_access_notification(uuid, text) from public;
revoke execute on function public.admin_set_ghl_contact(uuid, text) from public;
revoke execute on function public.set_booking_calendar_sync(uuid, text, text) from public;
grant execute on function public.admin_set_user_access(uuid, public.access_status, text) to app_member;
grant execute on function public.admin_set_access_notification(uuid, text) to app_member;
grant execute on function public.admin_set_ghl_contact(uuid, text) to app_member;
grant execute on function public.set_booking_calendar_sync(uuid, text, text) to app_member;
grant execute on function public.cancel_my_booking(uuid) to app_member;

-- ---------------------------------------------------------------------------
-- Google Calendar connections (server-only; no app_member access at all)
-- ---------------------------------------------------------------------------
create table public.google_calendar_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- AES-256-GCM encrypted refresh token (iv.tag.ciphertext, base64url).
  refresh_token_ciphertext text not null,
  scope text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from public;

create trigger google_calendar_connections_set_updated_at
  before update on public.google_calendar_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Verse of the Day cache (one ESV request per day across all servers)
-- ---------------------------------------------------------------------------
create table public.daily_verses (
  verse_date date primary key,
  reference text not null,
  passage text not null,
  fetched_at timestamptz not null default now()
);

alter table public.daily_verses enable row level security;
revoke all on public.daily_verses from public;
