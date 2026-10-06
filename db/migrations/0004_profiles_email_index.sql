-- Profiles mirror Neon Auth emails, which Neon Auth already keeps unique. A unique
-- index here could lock out a re-created account that reuses an old email, so use
-- a plain index for lookups instead.
drop index if exists public.profiles_email_idx;
create index if not exists profiles_email_lookup_idx on public.profiles (lower(email));
