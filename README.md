# Victory Rooms

Internal room booking for Victory Church:

- **Accounts:** people sign up with their mobile number, and the church office approves each account.
- **Bookings:** members request rooms, and admins approve or deny the requests.
- **Calendars:** approved bookings become confirmed appointments in the room's HighLevel (GHL) calendar, and GHL workflows email the requester. They are also added to the member's own Google Calendar.

**Stack:**

- Next.js 16 (App Router), TypeScript, Tailwind CSS 4
- Neon Postgres (Singapore), Neon Auth (Better Auth), Neon Object Storage
- GHL Calendars and Contacts API, Google Calendar API, ESV API
- Zod, date-fns, Sonner, Lucide

## Run locally

```bash
npm install
npm run db:migrate     # applies db/migrations and links room calendars from env
npm run storage:setup  # creates the private image bucket if it's missing
npm run dev
```

**Demo mode:** if `DATABASE_URL` and `NEON_AUTH_BASE_URL` are missing, the dev server starts in demo mode:

- data is kept in memory
- demo logins are used
- GHL and Google Calendar are simulated

Demo mode only works in development. Production never falls back to it.

| Demo account | Email | Password |
| --- | --- | --- |
| Member | `member@victory.test` | `victory-demo` |
| Admin | `admin@victory.test` | `victory-demo` |
| Awaiting approval | `pending@victory.test` | `victory-demo` |

To force demo mode while real credentials are configured, set `DEMO_MODE=true`. In PowerShell: `$env:DEMO_MODE="true"; npm run dev`.

## Setup

Copy `.env.example` to `.env.local` and fill it in. Never commit `.env.local`.

### Neon

1. Put `DATABASE_URL` (pooled) and `NEON_AUTH_BASE_URL` in `.env.local`.
2. Generate `NEON_AUTH_COOKIE_SECRET` with `openssl rand -base64 32`. Production requires it.
3. Run `npm run db:migrate`. It is safe to re-run. It creates:
   - the tables and the booking-overlap exclusion constraint
   - the booking rules (07:00–22:00, 30-minute steps, up to 8 h, up to 90 days ahead) and the per-member pending cap
   - row-level security and the restricted `app_member` role
   - account access, Google Calendar and verse tables
   - five rooms
4. **Admin:** sign up in the app with `ADMIN_EMAIL`, then run `npm run db:bootstrap-admin`. The script makes that account an active admin. The app never grants admin by itself.
5. **Production domain:** add it under **Neon Console → Auth → Configuration → Domains**. Neon Auth rejects sign-in from unlisted origins.

**How authorization works:** the server verifies the Neon Auth session first. It then sends each query as one HTTP transaction that:

- switches to the `app_member` role
- sets `app.user_id`
- runs the statement

The RLS policies, column grants and security-definer functions therefore apply even if application code has a bug. Members can't:

- read other people's data
- approve or deny bookings
- change roles or account access, including their own

Accounts that aren't `active` can't see rooms, bookings or announcements at the database level either.

### Accounts

New sign-ups are `pending`. They can sign in, but they only see the "awaiting approval" screen. Admins manage accounts under **Users**, which has tabs for Pending, Active, Denied and Revoked:

| From | Actions |
| --- | --- |
| Pending | Approve, Deny (reason required) |
| Active | Revoke (reason required) |
| Denied or revoked | Restore |

Accounts are never deleted. Every decision is kept in the access history.

The access decision is saved first. GHL is notified afterwards:

1. The contact is found or created, then its name, email and phone are updated.
2. For deny and revoke, the reason is written to the contact.
3. A tag is added: `booking-system-user-approved`, `-denied`, `-revoked` or `-restored`.

If the notification fails, the decision stays, and the user page shows a **Retry email** button.

### Object storage

1. Create storage credentials under **Neon Console → branch → Object storage**.
2. Set `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `S3_BUCKET_NAME` (default `booking-assets`).
3. Run `npm run storage:setup`. It creates the private bucket if it doesn't exist yet.

Uploads go under these prefixes: `announcements/`, `rooms/` (room photos) and `maps/` (room maps). For room images, upload the file, then put its key in `rooms.image_path` or `rooms.map_image_path`. Images are served through `/api/storage/...`. That route checks the session and redirects to a 5-minute signed URL, so the bucket stays private.

### GHL

- **Calendars:** one calendar per room, using a 30-minute slot interval and **at least one team member**. `npm run db:migrate` copies `GHL_CALENDAR_*` into `rooms.ghl_calendar_id`.
- **Keep the room calendars consistent:** give every room calendar the same minimum scheduling notice and staff hours. A calendar with a longer notice (for example 4 days instead of 4 hours) shows no times on nearby dates. `npm run diagnose:availability` lists any setting that differs.
- **One team member per room:** GHL blocks a team member's time across every calendar they belong to. If all room calendars share one person, a booking in one room also removes that time from the other rooms.
- **Staff assignment:** appointments are assigned to the calendar's primary (or first selected) team member. The app reads that member from the calendar and caches it for 10 minutes. If a calendar has no team member, approval stops with a clear message, and the booking stays pending.
- **Booking fields:** set the contact custom field IDs in `GHL_FIELD_BOOKING_*_ID`. If any are blank, the app looks them up by field key (`contact.booking_room`, …).
- **Account fields:** create a contact text field with key `contact.account_access_reason` and set `GHL_FIELD_ACCOUNT_ACCESS_REASON_ID`. A `contact.account_status` field (`GHL_FIELD_ACCOUNT_STATUS_ID`) is optional.
- **Workflows:**
  - Room Booking - Approved: appointment booked in each room calendar.
  - Room Booking - Denied: tag `room-booking-denied`.
  - Four account workflows, one per tag above.

**Approval order:**

1. Lock the request.
2. Re-check local conflicts.
3. Re-check GHL free slots.
4. Find or create the contact. Its ID is cached on the profile, so later approvals skip the search.
5. Write Room, Event, Date and Time.
6. Create a **confirmed** appointment with `assignedUserId`.
7. Store the appointment ID, then mark the booking approved.
8. Sync Google Calendar.

If any GHL step fails, the booking stays pending and the admin sees the error in the dialog.

**Denial:** the server writes the same fields plus Booking Denial Reason, then adds `GHL_DENIAL_TAG`, which starts the denial workflow. If the contact already has the tag, the server removes it first so the trigger fires again.

**Cancellation:** when an approved booking is cancelled, by the member or by an admin:

1. The GHL appointment is cancelled first.
2. The booking is released.
3. Only the Google event this app created is removed.

### Google Calendar

Members connect their Google Calendar once, before their first booking. The booking flow sends them to Google and then returns them to the same room and date.

When a booking is approved, an event is added to their primary calendar:

- **Title:** the event name
- **Description:** room and event
- **Location:** the room location
- **Time zone:** Asia/Manila

The event ID is derived from the booking, so retries never create duplicates. If Google fails, the booking stays approved, and both the member and admins get a **Retry calendar sync** button. Members can disconnect from the Account page.

**Setup in Google Cloud Console:**

1. Create a project, then enable the **Google Calendar API**.
2. Under **Google Auth Platform → Data access**, add only the scope `https://www.googleapis.com/auth/calendar.events.owned`. It covers only events on calendars the user owns, and the app only creates and deletes its own booking events.
3. Under **Google Auth Platform → Clients**, create an OAuth client ID (Web application) with these values:

   | Setting | Value |
   | --- | --- |
   | Authorized JavaScript origin | `<PRODUCTION_SITE_URL>` (also `http://localhost:3000` for development) |
   | Authorized redirect URI | `<PRODUCTION_SITE_URL>/api/google/callback` (also `http://localhost:3000/api/google/callback`) |

4. Under **Google Auth Platform → Branding**:

   | Setting | Value |
   | --- | --- |
   | App name | Victory Booking System |
   | App logo | `public/brand/victory-mark.png` |
   | Application home page | `<PRODUCTION_SITE_URL>` |
   | Application privacy policy link | `<PRODUCTION_SITE_URL>/privacy` |
   | Application terms of service link | `<PRODUCTION_SITE_URL>/terms` |
   | Authorized domain | the production domain, e.g. `victory-booking-system.vercel.app` |

5. Verify the production domain in [Google Search Console](https://search.google.com/search-console) as a URL-prefix property, using the HTML-tag method. Put the tag's `content` value in `GOOGLE_SITE_VERIFICATION` and redeploy. Google requires this check before it will publish an app with branding.
6. Under **Audience**, publish the app. While it's in Testing, only listed test users can connect.
7. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (`<SITE_URL>/api/google/callback`) and `GOOGLE_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`).

`<PRODUCTION_SITE_URL>` must equal `SITE_URL`. Members should use that exact domain, because the OAuth state cookie is set per domain.

**How tokens are stored:** refresh tokens are encrypted with AES-256-GCM and kept in a table that the app role can't read. They never reach the browser. The OAuth flow uses PKCE and a signed, short-lived state cookie.

Production requires all four Google values. In development without them, the Google step is skipped and bookings don't require a connection.

### Verse of the Day

Set `ESV_API_KEY` (from [api.esv.org](https://api.esv.org)). The dashboard picks a verse from a curated list of references, and the same date always gives the same verse. It fetches the text from the official ESV API on the server and caches it for the day, in memory and in Postgres. Without a key, or if the API is down, the dashboard shows the reference with a link to ESV.org. Verse text is never generated.

### Checks

```bash
npm run check:integrations   # read-only: Neon, RLS, Neon Auth, bucket, GHL calendars (interval, team member), contacts, fields, scopes, Google config, ESV
npm run check:bundle         # after `npm run build`: no secret values or server-only code in browser assets
npm run diagnose:availability -- --from 2026-10-07 --to 2026-10-14   # read-only: compares the five room calendars' settings, staff and free slots per Manila date
```

## WhatsApp booking assistant (n8n API)

n8n (with WhatsApp and OpenAI) calls a small tool API under `/api/bot/*`. The AI interprets messages; this app decides.

- **Tools:** verify-user, rooms, schedule, check-availability, suggest-alternatives, find-available-rooms, create-booking, my-bookings, booking-status.
- **Auth:** every request needs `Authorization: Bearer <N8N_BOOKING_API_KEY>`. The key is compared in constant time, and requests are rate-limited per sender and per instance. Without the key configured, every request is refused.
- **Identity:** the WhatsApp sender phone, passed by n8n from the trigger and never by the AI, is normalized to E.164 and matched to one **active** account. A number shared by several accounts is refused (`PHONE_AMBIGUOUS`).
- **Same engine as the website:** every call runs as that member under row-level security. Bookings go through the existing booking service (GHL availability, local conflicts, database overlap protection) and are always **pending**. Bot requests are stored with `source = whatsapp` and their WhatsApp message id, which is unique, so retries never duplicate a booking.
- **Privacy:** other people's bookings are returned only as anonymous "Reserved" times.
- **Status notifications (optional):** set `N8N_STATUS_WEBHOOK_URL` and `N8N_WEBHOOK_SIGNING_SECRET`. Approved, denied and cancelled WhatsApp bookings are then POSTed to n8n, signed with HMAC-SHA256. A failed delivery never affects the review; it's recorded and can be retried from the admin booking page.

**Docs for building the workflow:**

- [`docs/n8n-whatsapp-agent.md`](docs/n8n-whatsapp-agent.md): every tool, its inputs and outputs, error codes and the webhook.
- [`docs/n8n-tool-config.md`](docs/n8n-tool-config.md): copy-paste n8n tool settings.

## Public pages

`/` (homepage), `/privacy` and `/terms` are public and don't require sign-in. They are what Google's OAuth review looks at. Signed-in people go to their workspace through `/portal`, which sends them to `/admin`, `/dashboard` or `/pending`. Set `SUPPORT_EMAIL` so the privacy and terms pages show a contact address.

## Deploy (Vercel)

1. Import the GitHub repo into Vercel (framework: Next.js). `vercel.json` pins functions to `sin1` (Singapore), next to the Neon database.
2. Add every variable from `.env.example` to the **Production** environment, apart from `ADMIN_EMAIL`, which only the bootstrap script uses. Use the real values; never `DEMO_MODE`. `N8N_*` is only needed for the WhatsApp assistant.
3. Set `SITE_URL=https://<production domain>` and `GOOGLE_REDIRECT_URI=https://<production domain>/api/google/callback`, then redeploy.
4. Add the production domain under **Neon Console → Auth → Configuration → Domains**.
5. Add the Google values from [Google Calendar](#google-calendar).

## Performance notes

- **Database:** each query is a single Neon HTTP round trip (about 40 ms from Singapore), not three TCP round trips.
- **Request memoization:** the session, repository and counts use React `cache()`, so a layout and its page don't repeat queries.
- **Streaming:** slow sections (dashboard bulletin, room schedule) stream in through Suspense with skeletons.
- **GHL calls:**
  - Calendar metadata and the assigned staff are cached for 10 minutes.
  - Free slots for display are cached for 30 seconds. Approval always re-checks live.
  - Approval runs its independent checks in parallel.
  - GHL contact IDs are cached on the profile.
- **Mutations:** pages are refreshed with targeted `revalidatePath`. Buttons show busy labels such as "Approving reservation…", and success only appears after GHL confirms.

## Tests

```bash
npm run lint
npm run typecheck
npm test                         # unit tests + migrations/RLS on PGlite
npx playwright install chromium  # once
npm run test:e2e                 # Playwright against `next dev` in demo mode
npm run build && npm run check:bundle
```

## Layout

```
db/migrations        SQL schema, RLS, functions, seed
scripts/             migrate, bootstrap admin, storage setup, integration + bundle checks
src/app/             routes, server actions (src/app/actions), Google OAuth routes (src/app/api/google)
src/components/      UI
src/lib/auth/        Neon Auth provider and session helpers
src/lib/db/          Neon HTTP client, app_member transactions
src/lib/data/        repository interface + Postgres implementation, cached queries
src/lib/domain/      pure booking/availability/announcement/phone rules
src/lib/ghl/         GHL client, calendars, contacts, custom fields
src/lib/google/      OAuth, token encryption, Calendar API, gateway
src/lib/verse/       Verse of the Day (ESV)
src/lib/services/    use cases (bookings, accounts, calendar sync, announcements)
src/lib/storage/     upload validation, S3 (Neon Object Storage)
src/lib/bot/         n8n/WhatsApp tool API: auth, identity, rooms, tools, status webhook
src/lib/demo/        development-only in-memory adapter
```

Design references for each component are listed in `design-references.md`.
