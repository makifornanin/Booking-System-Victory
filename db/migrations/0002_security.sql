-- Database-level authorization.
--
-- The app connects as the database owner, which bypasses RLS. Every request that
-- acts for a signed-in user runs inside a transaction that switches to the
-- restricted `app_member` role and sets `app.user_id`:
--
--   begin; set local role app_member; select set_config('app.user_id', '<uuid>', true); ...; commit;
--
-- So even if application code had a bug, a member still could not read others'
-- bookings, approve or deny requests, write review fields, or change roles.
-- Column grants limit what can be written; policies limit which rows.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_member') then
    create role app_member nologin noinherit;
  end if;
end;
$$;

-- Let the connecting (owner) role switch into app_member.
grant app_member to current_user;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.bookings enable row level security;
alter table public.announcements enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.rooms, public.bookings, public.announcements from public;
grant usage on schema public to app_member;

grant select on public.profiles to app_member;
grant update (full_name) on public.profiles to app_member;

grant select on public.rooms to app_member;

grant select on public.bookings to app_member;
grant insert (user_id, room_id, event_name, event_type, purpose, attendee_count, start_time, end_time)
  on public.bookings to app_member;
grant update (status, denial_reason, ghl_appointment_id, reviewed_by, reviewed_at, review_locked_at, review_locked_by)
  on public.bookings to app_member;

grant select, insert, update, delete on public.announcements to app_member;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "Members read their own profile"
  on public.profiles for select to app_member
  using (id = public.app_current_user_id());

create policy "Admins read all profiles"
  on public.profiles for select to app_member
  using ((select public.is_admin()));

-- Only full_name is updatable (column grant above); role is never writable by the app role.
create policy "Members update their own name"
  on public.profiles for update to app_member
  using (id = public.app_current_user_id())
  with check (id = public.app_current_user_id());

-- ---------------------------------------------------------------------------
-- rooms (managed with SQL / the Neon console; read-only for the app)
-- ---------------------------------------------------------------------------
create policy "Members read active rooms"
  on public.rooms for select to app_member
  using (is_active or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create policy "Members read their own bookings"
  on public.bookings for select to app_member
  using (user_id = public.app_current_user_id());

create policy "Admins read all bookings"
  on public.bookings for select to app_member
  using ((select public.is_admin()));

create policy "Members create their own pending bookings"
  on public.bookings for insert to app_member
  with check (
    user_id = public.app_current_user_id()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and denial_reason is null
    and ghl_appointment_id is null
    and review_locked_at is null
  );

create policy "Admins review bookings"
  on public.bookings for update to app_member
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
create policy "Members read live announcements"
  on public.announcements for select to app_member
  using (
    is_published
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
  );

create policy "Admins read all announcements"
  on public.announcements for select to app_member
  using ((select public.is_admin()));

create policy "Admins create announcements"
  on public.announcements for insert to app_member
  with check ((select public.is_admin()) and created_by = public.app_current_user_id());

create policy "Admins update announcements"
  on public.announcements for update to app_member
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins delete announcements"
  on public.announcements for delete to app_member
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Busy periods for a room without exposing who booked them.
create or replace function public.get_room_busy_ranges(p_room_id uuid, p_from timestamptz, p_to timestamptz)
returns table (start_time timestamptz, end_time timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.app_current_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'Invalid range' using errcode = '22023';
  end if;

  return query
    select b.start_time, b.end_time
    from public.bookings b
    where b.room_id = p_room_id
      and b.status in ('pending', 'approved')
      and b.start_time < p_to
      and b.end_time > p_from
    order by b.start_time;
end;
$$;

-- Members may cancel their own pending request unless an admin is mid-review.
create or replace function public.cancel_my_booking(p_booking_id uuid)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.app_current_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  return query
    update public.bookings
    set status = 'cancelled'
    where id = p_booking_id
      and user_id = public.app_current_user_id()
      and status = 'pending'
      and (review_locked_at is null or review_locked_at < now() - interval '2 minutes')
    returning *;
end;
$$;

revoke execute on function public.get_room_busy_ranges(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.cancel_my_booking(uuid) from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.app_current_user_id() from public;

grant execute on function public.get_room_busy_ranges(uuid, timestamptz, timestamptz) to app_member;
grant execute on function public.cancel_my_booking(uuid) to app_member;
grant execute on function public.is_admin() to app_member;
grant execute on function public.app_current_user_id() to app_member;
