-- Audit trail of account access decisions. Each change records who made it, why,
-- and whether the GHL email notification went out (so it can be retried).

create type public.access_change as enum ('approved', 'denied', 'revoked', 'restored');

create table public.account_access_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  change public.access_change not null,
  reason text,
  actor_id uuid references public.profiles (id) on delete set null,
  notification_error text,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create index account_access_events_user_idx on public.account_access_events (user_id, created_at desc);

alter table public.account_access_events enable row level security;
revoke all on public.account_access_events from public;
grant select on public.account_access_events to app_member;

create policy "Admins read access history"
  on public.account_access_events for select to app_member
  using ((select public.is_admin()));

create or replace function public.admin_set_user_access(p_user_id uuid, p_status public.access_status, p_reason text)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.access_status;
  change public.access_change;
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

  change := case
    when current_status = 'pending' and p_status = 'active' then 'approved'
    when current_status = 'pending' and p_status = 'denied' then 'denied'
    when current_status = 'active' and p_status = 'revoked' then 'revoked'
    when current_status in ('denied', 'revoked') and p_status = 'active' then 'restored'
  end::public.access_change;

  if change is null then
    raise exception 'Invalid access change from % to %', current_status, p_status using errcode = 'check_violation';
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

-- Records the outcome of the latest access notification on both the event and the profile.
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
    select id from public.account_access_events where user_id = p_user_id order by created_at desc limit 1
  );
end;
$$;
