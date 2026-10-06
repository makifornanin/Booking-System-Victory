-- Poster orientation chosen by the admin. Portrait posters are shown at 4:5,
-- landscape posters at 16:9. Existing posters were all designed as portrait.
alter table public.announcements
  add column if not exists orientation text not null default 'portrait'
  constraint announcements_orientation_check check (orientation in ('portrait', 'landscape'));
