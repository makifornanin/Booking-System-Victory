-- Placeholder room content. Edit descriptions, capacity and photos with SQL or the
-- Neon console. GHL calendar IDs are synced from env by `npm run db:migrate`
-- (GHL_CALENDAR_ROOM_A … GHL_CALENDAR_EVENTS_PLACE_A), never stored in this file.

insert into public.rooms
  (name, slug, short_description, full_description, capacity, best_for, location_label, display_order)
values
  (
    'Room A', 'room-a',
    'Large classroom for Sunday school and workshops.',
    'Room A is the largest classroom on the floor, set up with movable tables and chairs. Replace this text with the actual room description.',
    40, array['Sunday school', 'Workshops', 'Training'], '2nd floor, east wing', 1
  ),
  (
    'Room B', 'room-b',
    'Flexible room for youth and teen activities.',
    'Room B has open floor space suited to youth and teen programs. Replace this text with the actual room description.',
    30, array['Youth activities', 'Teen gatherings', 'Games'], '2nd floor, east wing', 2
  ),
  (
    'Room C', 'room-c',
    'Meeting room for ministry teams.',
    'Room C has a central table and a display screen for ministry meetings. Replace this text with the actual room description.',
    16, array['Ministry meetings', 'Planning sessions'], '2nd floor, west wing', 3
  ),
  (
    'Room D', 'room-d',
    'Comfortable room for small groups.',
    'Room D is a smaller, quieter room arranged for discussion. Replace this text with the actual room description.',
    12, array['Small groups', 'Prayer meetings', 'Mentoring'], '2nd floor, west wing', 4
  ),
  (
    'Event''s Place - A', 'events-place-a',
    'Multipurpose space for church activities and events.',
    'Event''s Place - A is a multipurpose space for internal events and church activities. Replace this text with the actual room description.',
    50, array['Church activities', 'Internal events', 'Rehearsals'], 'Ground floor, beside the lobby', 5
  )
on conflict (slug) do nothing;
