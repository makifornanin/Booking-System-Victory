-- Core schema: profiles, rooms, bookings, announcements.
-- Booking overlap protection is enforced by an exclusion constraint so concurrent
-- inserts cannot both succeed for the same room/time.
--
-- Users live in Neon Auth (neon_auth.user). profiles.id is that user's id; the app
-- creates the profile on first sign-in and the role always starts as 'user'.

create extension if not exists btree_gist;

create type public.app_role as enum ('user', 'admin');
create type public.booking_status as enum ('pending', 'approved', 'denied', 'cancelled');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- The signed-in user for the current transaction. The app sets it with
-- set_config('app.user_id', <id>, true) after verifying the Neon Auth session.
create or replace function public.app_current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text not null default '',
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_idx on public.profiles (lower(email)) where email <> '';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Security definer so policies on profiles can call it without recursion.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = public.app_current_user_id() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  short_description text not null default '',
  full_description text not null default '',
  capacity integer not null check (capacity between 1 and 1000),
  best_for text[] not null default '{}',
  location_label text not null default '',
  image_path text,
  map_image_path text,
  ghl_calendar_id text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rooms_active_order_idx on public.rooms (is_active, display_order);

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.app_current_user_id() references public.profiles (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete restrict,
  event_name text not null check (char_length(btrim(event_name)) between 2 and 120),
  event_type text not null check (
    event_type in (
      'sunday_school', 'youth', 'ministry_meeting', 'workshop',
      'small_group', 'church_activity', 'internal_event', 'other'
    )
  ),
  purpose text not null default '' check (char_length(purpose) <= 1000),
  attendee_count integer not null check (attendee_count between 1 and 1000),
  start_time timestamptz not null,
  end_time timestamptz not null,
  status public.booking_status not null default 'pending',
  denial_reason text check (denial_reason is null or char_length(denial_reason) <= 500),
  ghl_appointment_id text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  -- Short-lived claim taken while an admin approval talks to GHL, so two
  -- admins (or a double click) cannot create two calendar appointments.
  review_locked_at timestamptz,
  review_locked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bookings_time_order check (end_time > start_time),
  constraint bookings_max_duration check (end_time - start_time <= interval '8 hours'),
  constraint bookings_denial_requires_reason check (
    status <> 'denied'
    or (denial_reason is not null and char_length(btrim(denial_reason)) > 0)
  ),
  constraint bookings_review_timestamp check (
    status not in ('approved', 'denied') or reviewed_at is not null
  ),
  constraint bookings_no_overlap exclude using gist (
    room_id with =,
    tstzrange(start_time, end_time, '[)') with &&
  ) where (status in ('pending', 'approved'))
);

create index bookings_user_start_idx on public.bookings (user_id, start_time desc);
create index bookings_status_start_idx on public.bookings (status, start_time);
create index bookings_room_start_idx on public.bookings (room_id, start_time);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- Booking rules are enforced here as well as in the app, because members hold
-- INSERT rights and could call the API directly. Keep these values in sync with
-- src/lib/config.ts (TIME_ZONE, DAY_START_HOUR, DAY_END_HOUR, SLOT_MINUTES,
-- MAX_BOOKING_MINUTES, MAX_DAYS_AHEAD, MAX_PENDING_PER_USER).
create or replace function public.validate_booking_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms;
  local_start timestamp := new.start_time at time zone 'Asia/Manila';
  local_end timestamp := new.end_time at time zone 'Asia/Manila';
  open_requests integer;
begin
  select * into target from public.rooms where id = new.room_id;

  if not found or not target.is_active then
    raise exception 'Room is not available for booking' using errcode = 'check_violation';
  end if;

  if new.attendee_count > target.capacity then
    raise exception 'Attendee count exceeds room capacity' using errcode = 'check_violation';
  end if;

  if new.start_time <= now() then
    raise exception 'Booking must start in the future' using errcode = 'check_violation';
  end if;

  if new.start_time > now() + interval '91 days' then
    raise exception 'Bookings open up to 90 days ahead' using errcode = 'check_violation';
  end if;

  if local_end::date <> local_start::date
     or local_start::time < time '07:00'
     or local_end::time > time '22:00' then
    raise exception 'That time is outside bookable hours' using errcode = 'check_violation';
  end if;

  if extract(second from local_start) <> 0
     or extract(minute from local_start)::int % 30 <> 0
     or extract(epoch from (new.end_time - new.start_time))::int % 1800 <> 0 then
    raise exception 'Bookings use 30-minute steps' using errcode = 'check_violation';
  end if;

  -- Serialise inserts per member so the open-request cap can't be raced.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select count(*) into open_requests
  from public.bookings
  where user_id = new.user_id and status = 'pending' and end_time > now();

  if open_requests >= 10 then
    raise exception 'You have too many pending requests' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger bookings_validate_insert
  before insert on public.bookings
  for each row execute function public.validate_booking_insert();

create or replace function public.enforce_booking_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.room_id is distinct from old.room_id
     or new.start_time is distinct from old.start_time
     or new.end_time is distinct from old.end_time
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

create trigger bookings_enforce_update
  before update on public.bookings
  for each row execute function public.enforce_booking_update();

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  internal_title text not null check (char_length(btrim(internal_title)) between 1 and 120),
  image_path text not null,
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  is_published boolean not null default false,
  created_by uuid default public.app_current_user_id() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_expiry_after_publish check (expires_at is null or expires_at > publish_at)
);

create index announcements_visibility_idx on public.announcements (is_published, publish_at, expires_at);

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();
