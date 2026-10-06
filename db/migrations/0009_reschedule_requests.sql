-- Reschedule requests: a member asks to move an APPROVED booking to a new date
-- and time in the same room. The original booking stays approved and untouched
-- until an admin approves the request; the requested slot is held meanwhile.
--
-- Concurrency: new bookings and new reschedule requests for a room take the same
-- per-room advisory lock before checking each other, so a held slot and a new
-- booking can never be created over each other. Pending requests also exclude
-- each other through a constraint, like bookings do.

create type public.reschedule_status as enum ('pending', 'approved', 'denied', 'cancelled');

create table public.booking_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete restrict,
  requested_by uuid not null default public.app_current_user_id() references public.profiles (id) on delete cascade,
  original_start timestamptz not null,
  original_end timestamptz not null,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  status public.reschedule_status not null default 'pending',
  denial_reason text check (denial_reason is null or char_length(denial_reason) <= 500),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  -- Short claim while an admin review talks to GHL (same pattern as bookings).
  review_locked_at timestamptz,
  review_locked_by uuid references public.profiles (id) on delete set null,
  -- Last GHL email problem for this request (approval/denial tag), for retry.
  notification_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reschedule_time_order check (requested_end > requested_start),
  constraint reschedule_max_duration check (requested_end - requested_start <= interval '8 hours'),
  constraint reschedule_changes_time check (requested_start <> original_start or requested_end <> original_end),
  constraint reschedule_denial_requires_reason check (
    status <> 'denied' or (denial_reason is not null and char_length(btrim(denial_reason)) > 0)
  ),
  constraint reschedule_review_timestamp check (status not in ('approved', 'denied') or reviewed_at is not null),
  -- A pending request holds its slot: no two pending requests may overlap in a room.
  constraint reschedule_holds_no_overlap exclude using gist (
    room_id with =,
    tstzrange(requested_start, requested_end, '[)') with &&
  ) where (status = 'pending')
);

-- At most one active (pending) request per booking.
create unique index reschedule_one_pending_per_booking on public.booking_reschedule_requests (booking_id) where status = 'pending';
create index reschedule_booking_created_idx on public.booking_reschedule_requests (booking_id, created_at desc);
create index reschedule_status_created_idx on public.booking_reschedule_requests (status, created_at);
create index reschedule_requested_by_idx on public.booking_reschedule_requests (requested_by, created_at desc);

create trigger reschedule_set_updated_at
  before update on public.booking_reschedule_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Insert: only the owner's future approved booking; same rules as bookings.
-- Keep in sync with src/lib/config.ts and validate_booking_insert().
-- ---------------------------------------------------------------------------
create or replace function public.validate_reschedule_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.bookings;
  local_start timestamp := new.requested_start at time zone 'Asia/Manila';
  local_end timestamp := new.requested_end at time zone 'Asia/Manila';
begin
  select * into original from public.bookings where id = new.booking_id for update;
  if not found or original.user_id is distinct from new.requested_by then
    raise exception 'You can only reschedule your own bookings' using errcode = '42501';
  end if;
  if original.status <> 'approved' then
    raise exception 'Only approved bookings can be rescheduled' using errcode = 'check_violation';
  end if;
  if original.start_time <= now() then
    raise exception 'Past bookings cannot be rescheduled' using errcode = 'check_violation';
  end if;

  -- Copied from the booking, never trusted from the client.
  new.room_id := original.room_id;
  new.original_start := original.start_time;
  new.original_end := original.end_time;
  new.status := 'pending';
  new.denial_reason := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_locked_at := null;
  new.review_locked_by := null;
  new.notification_error := null;

  if new.requested_end <= new.requested_start then
    raise exception 'End time must be after the start time' using errcode = 'check_violation';
  end if;
  if new.requested_start <= now() then
    raise exception 'Booking must start in the future' using errcode = 'check_violation';
  end if;
  if new.requested_start > now() + interval '91 days' then
    raise exception 'Bookings open up to 90 days ahead' using errcode = 'check_violation';
  end if;
  if local_end::date <> local_start::date
     or local_start::time < time '07:00'
     or local_end::time > time '22:00' then
    raise exception 'That time is outside bookable hours' using errcode = 'check_violation';
  end if;
  if extract(second from local_start) <> 0
     or extract(minute from local_start)::int % 30 <> 0
     or extract(epoch from (new.requested_end - new.requested_start))::int % 1800 <> 0 then
    raise exception 'Bookings use 30-minute steps' using errcode = 'check_violation';
  end if;

  -- Same lock as new bookings in this room, then check the requested slot is free.
  perform pg_advisory_xact_lock(hashtextextended('room:' || new.room_id::text, 0));
  if exists (
    select 1 from public.bookings b
    where b.room_id = new.room_id
      and b.status in ('pending', 'approved')
      and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(new.requested_start, new.requested_end, '[)')
  ) then
    raise exception 'That time overlaps another booking for this room' using errcode = 'exclusion_violation';
  end if;

  return new;
end;
$$;

create trigger reschedule_validate_insert
  before insert on public.booking_reschedule_requests
  for each row execute function public.validate_reschedule_insert();

-- New bookings may not take a slot held by a pending reschedule request.
-- (Fires after bookings_validate_insert: triggers run in name order.)
create or replace function public.check_reschedule_holds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Malformed ranges are rejected by the table's own check constraints.
  if new.end_time <= new.start_time then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('room:' || new.room_id::text, 0));
  if exists (
    select 1 from public.booking_reschedule_requests r
    where r.room_id = new.room_id
      and r.status = 'pending'
      and tstzrange(r.requested_start, r.requested_end, '[)') && tstzrange(new.start_time, new.end_time, '[)')
  ) then
    raise exception 'That time overlaps another booking for this room' using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

create trigger bookings_validate_reschedule_holds
  before insert on public.bookings
  for each row execute function public.check_reschedule_holds();

-- ---------------------------------------------------------------------------
-- Updates: request details never change; status moves forward only, and
-- "approved" is only reachable through admin_apply_reschedule().
-- ---------------------------------------------------------------------------
create or replace function public.enforce_reschedule_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_id is distinct from old.booking_id
     or new.room_id is distinct from old.room_id
     or new.requested_by is distinct from old.requested_by
     or new.original_start is distinct from old.original_start
     or new.original_end is distinct from old.original_end
     or new.requested_start is distinct from old.requested_start
     or new.requested_end is distinct from old.requested_end
     or new.created_at is distinct from old.created_at then
    raise exception 'Reschedule request details cannot change' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status = 'pending' then
      raise exception 'Invalid reschedule status change from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status = 'approved' and coalesce(current_setting('app.reschedule_apply', true), '') <> old.id::text then
      raise exception 'Reschedules are approved through admin_apply_reschedule' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger reschedule_enforce_update
  before update on public.booking_reschedule_requests
  for each row execute function public.enforce_reschedule_update();

-- Booking times change only when an approved reschedule is applied.
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

  return new;
end;
$$;

-- A cancelled booking releases any slot it was holding for a reschedule.
create or replace function public.cancel_reschedules_for_cancelled_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.booking_reschedule_requests
    set status = 'cancelled'
    where booking_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

create trigger bookings_cancel_pending_reschedules
  after update of status on public.bookings
  for each row execute function public.cancel_reschedules_for_cancelled_booking();

-- ---------------------------------------------------------------------------
-- Admin approval: atomically move the booking and close the request.
-- Called only after GHL accepted the new time.
-- ---------------------------------------------------------------------------
create or replace function public.admin_apply_reschedule(p_request_id uuid)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.booking_reschedule_requests;
  original public.bookings;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve reschedules' using errcode = '42501';
  end if;

  select * into req from public.booking_reschedule_requests where id = p_request_id for update;
  if not found or req.status <> 'pending' or req.review_locked_by is distinct from public.app_current_user_id() then
    return;
  end if;

  select * into original from public.bookings where id = req.booking_id for update;
  if original.status <> 'approved' or original.start_time <> req.original_start or original.end_time <> req.original_end then
    raise exception 'The booking changed after this request was made' using errcode = 'check_violation';
  end if;
  if req.requested_start <= now() then
    raise exception 'Booking must start in the future' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('room:' || req.room_id::text, 0));
  if exists (
    select 1 from public.bookings b
    where b.room_id = req.room_id and b.id <> original.id and b.status in ('pending', 'approved')
      and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(req.requested_start, req.requested_end, '[)')
  ) or exists (
    select 1 from public.booking_reschedule_requests r
    where r.room_id = req.room_id and r.id <> req.id and r.status = 'pending'
      and tstzrange(r.requested_start, r.requested_end, '[)') && tstzrange(req.requested_start, req.requested_end, '[)')
  ) then
    raise exception 'That time overlaps another booking for this room' using errcode = 'exclusion_violation';
  end if;

  perform set_config('app.reschedule_apply', req.id::text, true);
  update public.booking_reschedule_requests
  set status = 'approved', reviewed_by = public.app_current_user_id(), reviewed_at = now(),
      review_locked_at = null, review_locked_by = null
  where id = req.id;

  perform set_config('app.booking_reschedule', original.id::text, true);
  return query
    update public.bookings
    set start_time = req.requested_start, end_time = req.requested_end
    where id = original.id
    returning *;
end;
$$;

-- Members may withdraw their own pending request (not while an admin is reviewing it).
create or replace function public.cancel_my_reschedule(p_request_id uuid)
returns setof public.booking_reschedule_requests
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.app_current_user_id() is null or not public.is_active_member() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    update public.booking_reschedule_requests
    set status = 'cancelled'
    where id = p_request_id
      and requested_by = public.app_current_user_id()
      and status = 'pending'
      and (review_locked_at is null or review_locked_at < now() - interval '2 minutes')
    returning *;
end;
$$;

-- ---------------------------------------------------------------------------
-- Availability: busy ranges now include slots held by pending reschedules.
-- p_exclude_reschedule lets the final approval check ignore the request's own hold.
-- ---------------------------------------------------------------------------
drop function if exists public.get_room_busy_ranges(uuid, timestamptz, timestamptz);
create or replace function public.get_room_busy_ranges(p_room_id uuid, p_from timestamptz, p_to timestamptz, p_exclude_reschedule uuid default null)
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
    where b.room_id = p_room_id and b.status in ('pending', 'approved') and b.start_time < p_to and b.end_time > p_from
    union all
    select r.requested_start, r.requested_end
    from public.booking_reschedule_requests r
    where r.room_id = p_room_id and r.status = 'pending'
      and (p_exclude_reschedule is null or r.id <> p_exclude_reschedule)
      and r.requested_start < p_to and r.requested_end > p_from
    order by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.booking_reschedule_requests enable row level security;
revoke all on public.booking_reschedule_requests from public;

grant select on public.booking_reschedule_requests to app_member;
grant insert (booking_id, requested_start, requested_end) on public.booking_reschedule_requests to app_member;
grant update (status, denial_reason, reviewed_by, reviewed_at, review_locked_at, review_locked_by, notification_error)
  on public.booking_reschedule_requests to app_member;

create policy "Members read their own reschedule requests"
  on public.booking_reschedule_requests for select to app_member
  using (requested_by = public.app_current_user_id() and (select public.is_active_member()));

create policy "Admins read all reschedule requests"
  on public.booking_reschedule_requests for select to app_member
  using ((select public.is_admin()));

create policy "Active members request reschedules of their own bookings"
  on public.booking_reschedule_requests for insert to app_member
  with check (requested_by = public.app_current_user_id() and (select public.is_active_member()) and status = 'pending');

create policy "Admins review reschedule requests"
  on public.booking_reschedule_requests for update to app_member
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke execute on function public.admin_apply_reschedule(uuid) from public;
revoke execute on function public.cancel_my_reschedule(uuid) from public;
revoke execute on function public.get_room_busy_ranges(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.admin_apply_reschedule(uuid) to app_member;
grant execute on function public.cancel_my_reschedule(uuid) to app_member;
grant execute on function public.get_room_busy_ranges(uuid, timestamptz, timestamptz, uuid) to app_member;
