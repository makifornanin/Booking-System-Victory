-- WhatsApp booking assistant (n8n) support.
--
-- * The sender's phone number identifies the user, so phone lookups are indexed.
--   Phones are NOT unique: the bot refuses to act when one number belongs to
--   several accounts instead of guessing.
-- * Bookings record where they came from. WhatsApp requests carry the WhatsApp
--   message id, unique across bookings, so a retried message never creates a
--   second booking.
-- * Status notifications to n8n (approved/denied/cancelled) are recorded so a
--   failed delivery is visible and can be retried. They never block a review.

create index if not exists profiles_phone_idx on public.profiles (phone) where phone is not null;

alter table public.bookings
  add column if not exists source text not null default 'web'
    constraint bookings_source_check check (source in ('web', 'whatsapp')),
  add column if not exists whatsapp_message_id text
    constraint bookings_whatsapp_message_id_length check (whatsapp_message_id is null or char_length(whatsapp_message_id) between 1 and 200),
  add column if not exists status_notification_status text,
  add column if not exists status_notification_error text,
  add column if not exists status_notified_at timestamptz;

alter table public.bookings
  drop constraint if exists bookings_whatsapp_source_check;
alter table public.bookings
  add constraint bookings_whatsapp_source_check check (whatsapp_message_id is null or source = 'whatsapp');

create unique index if not exists bookings_whatsapp_message_id_key
  on public.bookings (whatsapp_message_id) where whatsapp_message_id is not null;

-- Members insert their own requests; the source and message id are set by the
-- server when the request comes from the WhatsApp assistant.
grant insert (source, whatsapp_message_id) on public.bookings to app_member;
