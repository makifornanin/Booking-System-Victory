# WhatsApp booking assistant: n8n tool reference

This document is for whoever builds the n8n workflow. It describes the booking-system API that the n8n AI Agent calls.

**The rule: the AI interprets, the booking engine decides.** OpenAI turns a member's message into explicit values (room, date, start and end time). The booking system then decides: who the member is, whether the time is free, and whether a request is created. The AI never invents availability, room IDs, user IDs or phone numbers.

```
WhatsApp Trigger ──► AI Agent (OpenAI) ──► HTTP Request tools ──► Victory Booking System /api/bot/*
        │                    ▲                                               │
        └── sender phone ────┘ (passed by n8n, never by the AI)              ▼
                                                    GHL availability + local bookings + database rules
```

Base URL (production): `https://victory-booking-system.vercel.app`

---

## 1. Authentication

Every request must carry the shared key:

```
Authorization: Bearer <N8N_BOOKING_API_KEY>
Content-Type: application/json
```

- Store the key as an n8n credential or environment variable. Never put it in a prompt or a message.
- If the key is missing or wrong, the API responds **HTTP 401** with `{"ok": false, "code": "UNAUTHORIZED_BOT"}`.
- Repeated bad keys from one IP are throttled (**HTTP 429**).

## 2. Identity: the WhatsApp sender phone

Every tool takes `phone`: the WhatsApp **sender** number from the WhatsApp Trigger metadata.

- **Phone expression:** `{{ $('WhatsApp Trigger').item.json.messages[0].from }}`. WhatsApp sends the number without a `+`, e.g. `639171234567`. That's fine.
- **Never** let the AI fill `phone`. In each HTTP Request Tool, set `phone` to the expression above, not to `$fromAI(...)`. This stops a member from saying "I'm +63…" and acting as someone else.
- **Normalisation:** the API turns `09171234567`, `639171234567` and `+639171234567` into `+639171234567`. It matches that against the phone on the member's website account.
- **Who can use the tools:** only accounts with access status **active**. Other results are `USER_NOT_FOUND`, `ACCOUNT_PENDING`, `ACCOUNT_DENIED`, `ACCOUNT_REVOKED`, or `PHONE_AMBIGUOUS` (the number belongs to more than one account; the API refuses to guess).
- **No user IDs:** the API never accepts a `userId`. Extra fields such as `userId` or `status` are ignored.

## 3. Conventions

| Topic | Rule |
| --- | --- |
| Method | `POST` with a JSON object body, for every tool |
| Time zone | Asia/Manila for all dates and times |
| Dates | `YYYY-MM-DD`. The AI must resolve "today", "Monday" or "next Friday" first. Anything else returns `AMBIGUOUS_DATE` with `requiresClarification: true` |
| Times | 24-hour `HH:mm` on `:00` or `:30`, e.g. `"13:00"`, `"16:30"` |
| Bookable window | 07:00–22:00. Each room's GHL calendar may open later or close earlier (currently 08:00–20:00) |
| Length | 30 minutes up to 8 hours |
| How far ahead | From today up to 90 days |
| Responses | Business outcomes always come back as **HTTP 200**: `ok: true`, or `ok: false` with a `code`. Other statuses are 401 (bad key), 429 (rate limit, see `retryAfterSeconds`), 400 (body isn't JSON) and 500 (unexpected error; safe to retry) |
| `message` | Plain-English context for the AI. Don't send it to the member word for word; write a friendly reply instead |
| `requiresClarification: true` | Ask the member a follow-up question (which room, which date, a valid time) |
| `retryable: true` | A temporary problem, e.g. the church calendar couldn't be reached. Try again later |
| Privacy | Other people's bookings only appear as `{"start", "end", "label": "Reserved"}`. Never say who booked a room |

### Error and result codes

| Code | Meaning |
| --- | --- |
| `UNAUTHORIZED_BOT` | Missing or wrong API key (HTTP 401) |
| `RATE_LIMITED` | Too many requests. Wait `retryAfterSeconds` (HTTP 429) |
| `INVALID_REQUEST` | Body isn't a JSON object (HTTP 400) |
| `INVALID_INPUT` | A field is missing or invalid. See `fields`; for event types, see `choices` |
| `INVALID_PHONE` | `phone` is missing or not a phone number |
| `USER_NOT_FOUND` | No account uses this WhatsApp number. Sign-up link in `signUpUrl` |
| `ACCOUNT_PENDING` / `ACCOUNT_DENIED` / `ACCOUNT_REVOKED` | The account can't book |
| `PHONE_AMBIGUOUS` | Several accounts share this number. The member should contact the church office |
| `ROOM_NOT_FOUND` / `ROOM_AMBIGUOUS` | Ask which room. Valid names are in `choices` |
| `ROOM_UNAVAILABLE` | The room isn't open for online booking |
| `AMBIGUOUS_DATE` / `INVALID_DATE` | The date was vague, impossible or in the past |
| `INVALID_TIME` | Not `HH:mm`, not on :00/:30, or already passed today |
| `OUTSIDE_BOOKING_HOURS` | Outside 07:00–22:00 |
| `BOOKING_TOO_FAR_AHEAD` | More than 90 days ahead |
| `INVALID_DURATION` | The end isn't after the start, or the booking is longer than 8 hours |
| `ATTENDEES_EXCEED_CAPACITY` | More people than the room holds (`capacity`) |
| `TIME_UNAVAILABLE` | That time isn't free (with `conflicts` or `alternatives`) |
| `BOOKING_CONFLICT` | Someone took the time a moment ago (with `alternatives`) |
| `NO_ALTERNATIVES` | No free time left in that room that day (`alternatives: []`) |
| `TOO_MANY_PENDING` | The member already has 10 requests waiting for review |
| `GOOGLE_CALENDAR_REQUIRED` | The member must connect Google Calendar once on the website before their first booking (`connectUrl`) |
| `DUPLICATE_MESSAGE` | This WhatsApp message already created a booking. With `ok: true`, the existing `booking` is returned |
| `BOOKING_CREATED` | A new pending request was created |
| `BOOKING_NOT_FOUND` | No such booking among this member's own bookings |
| `GHL_UNAVAILABLE` | The church calendar couldn't be reached (`retryable: true`) |
| `INTERNAL_ERROR` | Unexpected error (HTTP 500; `retryable: true`) |

### Rate limits

Limits are per server instance:

- 40 calls per minute per sender;
- 6 booking requests per minute per sender;
- 600 calls per minute overall;
- 20 bad-key attempts per minute per IP.

---

## 4. Tools

Every example uses:

```bash
BASE=https://victory-booking-system.vercel.app
KEY=...   # N8N_BOOKING_API_KEY
```

### 4.1 Verify User

**Purpose:** confirm the WhatsApp sender has an active account, and get their first name for greetings. Call it at the start of a conversation.

- **Endpoint:** `POST /api/bot/verify-user`
- **Authorization:** `Bearer <N8N_BOOKING_API_KEY>`

**Input**
```json
{ "phone": "639171234567" }
```

**Output (active)**
```json
{ "ok": true, "user": { "firstName": "Mark", "phone": "+639171234567", "accessStatus": "active" } }
```

**Output (not allowed)**
```json
{ "ok": false, "code": "ACCOUNT_PENDING", "message": "This account is waiting for the church office to approve it." }
```

**Errors:** `INVALID_PHONE`, `USER_NOT_FOUND` (includes `signUpUrl`), `ACCOUNT_PENDING`, `ACCOUNT_DENIED`, `ACCOUNT_REVOKED`, `PHONE_AMBIGUOUS`

**Example**
```bash
curl -s -X POST "$BASE/api/bot/verify-user" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"phone":"639171234567"}'
```

### 4.2 Get Rooms

**Purpose:** list the bookable rooms with capacity and location. Use it when the member asks what rooms exist, or to show valid names.

- **Endpoint:** `POST /api/bot/rooms`

**Input**
```json
{ "phone": "639171234567" }
```

**Output**
```json
{
  "ok": true,
  "timezone": "Asia/Manila",
  "rooms": [
    { "name": "Room A", "capacity": 40, "location": "2nd floor, east wing", "description": "Large classroom for Sunday school and workshops.", "bestFor": ["Sunday school", "Workshops", "Training"] }
  ]
}
```

**Errors:** the identity codes (see 4.1)

### 4.3 Get Room Schedule

**Purpose:** show what's free and what's reserved in one room on one date. Reservations by other people show only times and the label "Reserved". The member's own bookings show their event and status.

- **Endpoint:** `POST /api/bot/schedule`

**Input**
```json
{ "phone": "639171234567", "room": "Room A", "date": "2026-10-12" }
```

`room` accepts what the member said: `Room A`, `room a`, `A`, `Events Place A`, `Event Place A`, …

**Output**
```json
{
  "ok": true,
  "room": "Room A",
  "date": "2026-10-12",
  "displayDate": "Monday, October 12",
  "timezone": "Asia/Manila",
  "bookableHours": { "opens": "07:00", "closes": "22:00" },
  "available": [ { "start": "08:00", "end": "12:00" }, { "start": "14:00", "end": "20:00" } ],
  "reserved": [
    { "start": "12:00", "end": "14:00", "label": "Reserved" },
    { "start": "16:00", "end": "17:00", "label": "Your booking", "yours": true, "event": "Choir practice", "status": "pending", "bookingId": "…" }
  ],
  "notAvailable": [ { "start": "07:00", "end": "08:00", "label": "Not available" }, { "start": "20:00", "end": "22:00", "label": "Not available" } ]
}
```

`notAvailable` covers times the church calendar doesn't open, or times that have already passed today.

**Errors:** identity codes, `ROOM_NOT_FOUND`, `ROOM_AMBIGUOUS`, `ROOM_UNAVAILABLE`, `AMBIGUOUS_DATE`, `INVALID_DATE`, `BOOKING_TOO_FAR_AHEAD`, `GHL_UNAVAILABLE`

**Example**
```bash
curl -s -X POST "$BASE/api/bot/schedule" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"phone":"639171234567","room":"Room B","date":"2026-10-12"}'
```

### 4.4 Check Room Availability

**Purpose:** decide whether an exact room, date and time is free right now. It uses the same checks as the website: GHL availability, pending and approved bookings, hours, 30-minute steps and length. **Always use it before telling a member a time is free.**

- **Endpoint:** `POST /api/bot/check-availability`

**Input**
```json
{ "phone": "639171234567", "room": "Room A", "date": "2026-10-12", "startTime": "13:00", "endTime": "16:00" }
```

**Output (free)**
```json
{
  "ok": true, "available": true,
  "room": "Room A", "date": "2026-10-12", "displayDate": "Monday, October 12",
  "startTime": "13:00", "endTime": "16:00", "displayTime": "1:00 PM - 4:00 PM", "durationMinutes": 180
}
```

**Output (taken)**
```json
{
  "ok": true, "available": false, "code": "TIME_UNAVAILABLE",
  "room": "Room A", "date": "2026-10-12", "displayDate": "Monday, October 12",
  "startTime": "13:00", "endTime": "16:00", "displayTime": "1:00 PM - 4:00 PM", "durationMinutes": 180,
  "conflicts": [ { "start": "12:00", "end": "14:00", "label": "Reserved" } ]
}
```

A conflict `label` is one of `Reserved` (another booking), `Not available` (the church calendar is closed or blocked) or `Passed`.

**Errors:** identity codes, room codes, `AMBIGUOUS_DATE`, `INVALID_DATE`, `INVALID_TIME`, `OUTSIDE_BOOKING_HOURS`, `BOOKING_TOO_FAR_AHEAD`, `INVALID_DURATION`, `GHL_UNAVAILABLE`

### 4.5 Suggest Alternative Times

**Purpose:** when a time is taken, get up to 3 real free times in the **same room and day**, calculated by the booking engine. Never let the AI invent times.

The order is:

1. the nearest later start;
2. the nearest earlier start;
3. another same-day option that doesn't overlap the first two.

The requested length is kept when possible. If no window that long exists, shorter windows come back with `preservesDuration: false`.

- **Endpoint:** `POST /api/bot/suggest-alternatives`

**Input:** the same as Check Room Availability.

**Output**
```json
{
  "ok": true, "available": false, "code": "TIME_UNAVAILABLE",
  "room": "Room A", "date": "2026-10-12", "displayDate": "Monday, October 12",
  "startTime": "13:00", "endTime": "16:00", "displayTime": "1:00 PM - 4:00 PM", "durationMinutes": 180,
  "alternatives": [
    { "startTime": "14:00", "endTime": "17:00", "displayTime": "2:00 PM - 5:00 PM", "durationMinutes": 180, "preservesDuration": true },
    { "startTime": "09:00", "endTime": "12:00", "displayTime": "9:00 AM - 12:00 PM", "durationMinutes": 180, "preservesDuration": true }
  ]
}
```

- With no free time left, you get `"code": "NO_ALTERNATIVES"` and `"alternatives": []`.
- If the requested time is actually free, you get `"available": true` and `"alternatives": []`.

**Errors:** as for Check Room Availability

### 4.6 Find Available Rooms

**Purpose:** "Which rooms are free Monday 3–5 PM?" It checks **every** active room with the real engine and returns only the free ones. Pass `attendeeCount` (optional) to keep only rooms big enough.

- **Endpoint:** `POST /api/bot/find-available-rooms`

**Input**
```json
{ "phone": "639171234567", "date": "2026-10-12", "startTime": "15:00", "endTime": "17:00", "attendeeCount": 20 }
```

**Output**
```json
{
  "ok": true,
  "date": "2026-10-12", "displayDate": "Monday, October 12",
  "startTime": "15:00", "endTime": "17:00", "displayTime": "3:00 PM - 5:00 PM",
  "availableRooms": [ { "name": "Room B", "capacity": 30, "location": "2nd floor, east wing", "description": "…", "bestFor": ["…"] } ],
  "unavailableRooms": ["Room A"],
  "roomsNotChecked": []
}
```

- If no room is free, the response also has `"code": "TIME_UNAVAILABLE"`.
- `roomsNotChecked` lists rooms whose calendar couldn't be reached.

**Errors:** identity codes, date/time codes, `INVALID_INPUT`

### 4.7 Create Booking Request

**Purpose:** submit a real booking request for the member. It goes into the **same pending queue** as website requests, and the church office approves or denies it as usual. It is **never** approved automatically.

The booking system re-checks everything right before saving: the member, the room, the hours, GHL availability, existing bookings and the database's overlap protection. A previous Check Room Availability result is never trusted.

Only call it after the member has confirmed the room, date, time and event details.

- **Endpoint:** `POST /api/bot/create-booking`

**Input**
```json
{
  "phone": "639171234567",
  "room": "Room A",
  "date": "2026-10-12",
  "startTime": "13:00",
  "endTime": "16:00",
  "eventName": "Youth Service",
  "eventType": "Youth / teen activity",
  "purpose": "Youth service practice",
  "attendeeCount": 25,
  "whatsappMessageId": "wamid.HBgM…"
}
```

- **`eventType`** must be one of: `Sunday school`, `Youth / teen activity`, `Ministry meeting`, `Workshop`, `Small group`, `Church activity`, `Internal event`, `Other`. These are case-insensitive.
- **`whatsappMessageId`** is required. Set it from the trigger, not the AI: `{{ $('WhatsApp Trigger').item.json.messages[0].id }}`. If n8n retries the same message, the API returns the booking that message already created instead of making a second one.

**Output (created)**
```json
{
  "ok": true,
  "code": "BOOKING_CREATED",
  "booking": {
    "id": "8d1c…", "status": "pending", "room": "Room A", "event": "Youth Service", "eventType": "Youth / teen activity",
    "date": "2026-10-12", "displayDate": "Monday, October 12",
    "startTime": "13:00", "endTime": "16:00", "displayTime": "1:00 PM - 4:00 PM", "source": "whatsapp"
  }
}
```

**Output (same message retried)**
```json
{ "ok": true, "code": "DUPLICATE_MESSAGE", "duplicate": true, "booking": { "id": "8d1c…", "status": "pending", "…": "…" } }
```

**Output (time taken)**
```json
{
  "ok": false, "code": "TIME_UNAVAILABLE", "message": "That time isn't available for this room.",
  "room": "Room A", "date": "2026-10-12", "startTime": "13:00", "endTime": "16:00", "durationMinutes": 180,
  "alternatives": [ { "startTime": "14:00", "endTime": "17:00", "displayTime": "2:00 PM - 5:00 PM", "durationMinutes": 180, "preservesDuration": true } ]
}
```

**Errors:** identity codes, room codes, date/time codes, `INVALID_INPUT` (see `fields` / `choices`), `ATTENDEES_EXCEED_CAPACITY`, `TIME_UNAVAILABLE`, `BOOKING_CONFLICT`, `TOO_MANY_PENDING`, `GOOGLE_CALENDAR_REQUIRED` (with `connectUrl`), `GHL_UNAVAILABLE`, `DUPLICATE_MESSAGE`

**Example**
```bash
curl -s -X POST "$BASE/api/bot/create-booking" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"phone":"639171234567","room":"Room A","date":"2026-10-12","startTime":"13:00","endTime":"16:00","eventName":"Youth Service","eventType":"Youth / teen activity","purpose":"Youth service practice","attendeeCount":25,"whatsappMessageId":"wamid.TEST123"}'
```

### 4.8 Get My Bookings

**Purpose:** "What are my bookings?" It returns only the sender's own requests, upcoming first.

- **Endpoint:** `POST /api/bot/my-bookings`

**Input**
```json
{ "phone": "639171234567", "status": "pending", "includePast": false, "limit": 10 }
```

Everything except `phone` is optional:

- `status` is one of `pending`, `approved`, `denied`, `cancelled`;
- `includePast` defaults to `false`;
- `limit` defaults to 10 (maximum 25).

**Output**
```json
{
  "ok": true, "timezone": "Asia/Manila", "count": 1, "upcomingCount": 1,
  "bookings": [
    { "id": "8d1c…", "status": "approved", "room": "Room A", "event": "Youth Service", "eventType": "Youth / teen activity",
      "date": "2026-10-12", "displayDate": "Monday, October 12", "startTime": "13:00", "endTime": "16:00",
      "displayTime": "1:00 PM - 4:00 PM", "source": "whatsapp" }
  ]
}
```

Denied bookings also include `denialReason`.

**Errors:** identity codes, `INVALID_INPUT`

### 4.9 Get Booking Status

**Purpose:** "What's the status of my Room A booking?" Look up one of the sender's bookings by `bookingId`, or by `room` and/or `date`. It only ever searches the sender's own bookings. The best match is the nearest upcoming booking, otherwise the most recent one; other matches come back in `otherMatches`.

- **Endpoint:** `POST /api/bot/booking-status`

**Input**
```json
{ "phone": "639171234567", "room": "Room A", "date": "2026-10-12" }
```

or

```json
{ "phone": "639171234567", "bookingId": "8d1c…" }
```

**Output**
```json
{
  "ok": true,
  "booking": { "id": "8d1c…", "status": "denied", "room": "Room A", "event": "Youth Service", "date": "2026-10-12",
               "displayDate": "Monday, October 12", "startTime": "13:00", "endTime": "16:00",
               "displayTime": "1:00 PM - 4:00 PM", "source": "whatsapp", "denialReason": "Room A is closed that afternoon." },
  "otherMatches": []
}
```

`status` is one of `pending`, `approved`, `denied` or `cancelled`.

**Errors:** identity codes, `BOOKING_NOT_FOUND`, `ROOM_NOT_FOUND`, `ROOM_AMBIGUOUS`, `AMBIGUOUS_DATE`

---

## 5. Status notifications (optional)

When a **WhatsApp** booking is approved, denied or cancelled, the booking system can POST to an n8n Webhook so the bot can message the member. Website bookings never send notifications.

**Setup:** set `N8N_STATUS_WEBHOOK_URL` and `N8N_WEBHOOK_SIGNING_SECRET` on Vercel.

**Payload**
```json
{
  "event": "booking.denied",
  "eventId": "8d1c….denied",
  "occurredAt": "2026-10-08T03:15:00.000Z",
  "bookingId": "8d1c…",
  "phone": "+639171234567",
  "room": "Room A",
  "eventName": "Youth Service",
  "date": "2026-10-12",
  "startTime": "13:00",
  "endTime": "16:00",
  "status": "denied",
  "denialReason": "Room A is closed that afternoon."
}
```

`event` is one of `booking.approved`, `booking.denied` or `booking.cancelled`. `denialReason` is only present for denials.

**Headers**

```
X-Victory-Event: booking.denied
X-Victory-Event-Id: <bookingId>.<status>      (the same on every retry, so use it to ignore duplicates)
X-Victory-Timestamp: <unix seconds>
X-Victory-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" using N8N_WEBHOOK_SIGNING_SECRET>
```

**Verify the signature** in an n8n Code node before sending anything. Turn on "Raw body" in the Webhook node so the exact bytes are available:

```js
const crypto = require('crypto');
const secret = $env.N8N_WEBHOOK_SIGNING_SECRET;
const ts = $json.headers['x-victory-timestamp'];
const sig = ($json.headers['x-victory-signature'] || '').replace('sha256=', '');
const raw = Buffer.from($binary.data.data, 'base64').toString('utf8'); // raw body
const expected = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
if (!fresh || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
  throw new Error('Invalid signature');
}
return [{ json: JSON.parse(raw) }];
```

**Delivery behaviour**

- **Respond fast:** reply 2xx within 8 seconds.
- **Retries:** the booking system retries network errors, 429 and 5xx twice. It doesn't retry other 4xx responses.
- **Never blocks a review:** a failed delivery never undoes or delays the approval, denial or cancellation.
- **Visible failures:** a failure is recorded, and the admin booking page shows **Retry WhatsApp notification**.

---

## 6. Suggested AI Agent instructions

Add something like this to the agent's system prompt:

- At the start of a conversation, call **Verify User**. If it isn't `ok`, explain kindly using the code, and don't call the other tools.
- Convert every date to `YYYY-MM-DD` and every time to 24-hour `HH:mm` in Asia/Manila before calling a tool. If unsure, ask the member.
- Never say a room is free without **Check Room Availability** or **Find Available Rooms**. Never invent alternative times; use **Suggest Alternative Times**.
- Never reveal who booked a room. Say only "reserved" with the times.
- Before **Create Booking Request**, read back the room, date, time, event name, type, purpose and number of people, and wait for a yes.
- After a booking is created, say it's **pending** until the church office approves it. The bot can't approve, deny or cancel bookings.
- When a result has `requiresClarification: true`, ask a follow-up question. When it has `retryable: true`, suggest trying again shortly.
- For `GOOGLE_CALENDAR_REQUIRED`, send the member the `connectUrl` so they can connect Google Calendar once on the website.

## 7. What the API can't do (by design)

- **Admin actions:** approve, deny or cancel bookings; change roles or account access. Bot tools only call member-level operations, as the member, under database row-level security.
- **Other people's data:** read anyone else's bookings or personal details.
- **Calendars:** bypass GHL availability or the database overlap protection, or touch Google Calendar or GHL appointments directly.
- **Tokens:** expose Google or GHL tokens.
