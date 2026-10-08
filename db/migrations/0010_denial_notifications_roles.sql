-- 1. Denials are local decisions: GHL email failures are recorded, never blocking.
-- 2. A pending request whose start time has passed can't be approved (DB guard).
-- 3. Admins can promote/demote other active users; the last active admin is protected.

-- ---------------------------------------------------------------------------
-- 1. GHL notification outcome for booking decisions (e.g. the denial email)
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists ghl_notification_error text;
grant update (ghl_notification_error) on public.bookings to app_member;

-- ---------------------------------------------------------------------------
-- 2. Past-due approvals are refused here too, not only in the app.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_booking_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rescheduling boolean := coalesce(current_setting('app.booking_reschedule', true), '') = old.id::text;
begin
  if new.user_id is distinct from old.user_id
     or new.room_id is distinct from old.room_id
     or ((new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time) and not rescheduling)
     or new.created_at is distinct from old.created_at then
    raise exception 'Booking details cannot change after submission' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('approved', 'denied', 'cancelled'))
    or (old.status = 'approved' and new.status = 'cancelled')
  ) then
    raise exception 'Invalid booking status change from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if old.status = 'pending' and new.status = 'approved' and new.start_time <= now() then
    raise exception 'This request can no longer be approved because its start time has passed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Admin role changes, recorded in the existing access history
-- ---------------------------------------------------------------------------
alter type public.access_change add value if not exists 'promoted';
alter type public.access_change add value if not exists 'demoted';

alter table public.account_access_events
  add column if not exists previous_role public.app_role,
  add column if not exists new_role public.app_role;

-- Promote an active user to admin, or demote another admin to user.
-- Never changes the caller's own role and never leaves zero active admins
-- (the sole admin trying to step down gets the last-admin message).
create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.app_role)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles;
begin
  -- One role/access change at a time, so two admins can't demote each other at once.
  perform pg_advisory_xact_lock(hashtextextended('admin-roles', 0));

  if not public.is_admin() then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;

  select * into target from public.profiles where id = p_user_id for update;
  if not found then
    return;
  end if;
  if target.role = p_role then
    raise exception 'That user already has this role' using errcode = 'check_violation';
  end if;
  if p_role = 'admin' and target.access_status <> 'active' then
    raise exception 'Only active accounts can be made admins' using errcode = 'check_violation';
  end if;
  if p_role = 'user' and target.access_status = 'active' and not exists (
    select 1 from public.profiles where role = 'admin' and access_status = 'active' and id <> p_user_id
  ) then
    raise exception 'At least one active administrator must remain.' using errcode = 'check_violation';
  end if;
  if p_user_id = public.app_current_user_id() then
    raise exception 'Admins cannot change their own role' using errcode = 'check_violation';
  end if;

  insert into public.account_access_events (user_id, change, actor_id, previous_role, new_role)
  values (p_user_id, case when p_role = 'admin' then 'promoted' else 'demoted' end::public.access_change, public.app_current_user_id(), target.role, p_role);

  return query
    update public.profiles set role = p_role where id = p_user_id returning *;
end;
$$;

-- Access changes: same rules as before, plus the last-active-admin guard.
create or replace function public.admin_set_user_access(p_user_id uuid, p_status public.access_status, p_reason text)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.access_status;
  target_role public.app_role;
  change public.access_change;
begin
  perform pg_advisory_xact_lock(hashtextextended('admin-roles', 0));

  if not public.is_admin() then
    raise exception 'Only admins can change account access' using errcode = '42501';
  end if;

  select access_status, role into current_status, target_role from public.profiles where id = p_user_id for update;
  if not found then
    return;
  end if;

  change := case
    when current_status = 'pending' and p_status = 'active' then 'approved'
    when current_status = 'pending' and p_status = 'denied' then 'denied'
    when current_status = 'active' and p_status = 'revoked' then 'revoked'
    when current_status in ('denied', 'revoked') and p_status = 'active' then 'restored'
  end::public.access_change;

  if change is null then
    raise exception 'Invalid access change from % to %', current_status, p_status using errcode = 'check_violation';
  end if;

  if target_role = 'admin' and current_status = 'active' and p_status <> 'active' and not exists (
    select 1 from public.profiles where role = 'admin' and access_status = 'active' and id <> p_user_id
  ) then
    raise exception 'At least one active administrator must remain.' using errcode = 'check_violation';
  end if;
  if p_user_id = public.app_current_user_id() then
    raise exception 'Admins cannot change their own access' using errcode = 'check_violation';
  end if;

  insert into public.account_access_events (user_id, change, reason, actor_id)
  values (p_user_id, change, case when p_status in ('denied', 'revoked') then nullif(btrim(p_reason), '') end, public.app_current_user_id());

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

-- Notification results belong to access decisions, not role changes.
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
  update public.account_access_events
  set notification_error = p_error,
      notified_at = case when p_error is null then now() else notified_at end
  where id = (
    select id from public.account_access_events
    where user_id = p_user_id and change::text in ('approved', 'denied', 'revoked', 'restored')
    order by created_at desc limit 1
  );
end;
$$;

revoke execute on function public.admin_set_user_role(uuid, public.app_role) from public;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to app_member;
