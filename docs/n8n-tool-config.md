# n8n tool configuration (copy-paste)

These are the HTTP Request Tool settings for the n8n AI Agent, one block per tool. Full request and response details are in [n8n-whatsapp-agent.md](n8n-whatsapp-agent.md).

## Shared settings

- **Method:** POST for every tool.
- **Headers** for every tool:
  ```
  Authorization: Bearer {{$env.N8N_BOOKING_API_KEY}}
  Content-Type: application/json
  ```
  If your n8n blocks `$env`, create a **Header Auth** credential instead (name `Authorization`, value `Bearer <key>`) and select it on every tool.
- **Body:** "Send Body" on, Body Content Type **JSON**, "Specify Body: Using JSON".
- **Never let the AI fill these fields.** Set them from the WhatsApp Trigger:
  - `phone` = `{{ $('WhatsApp Trigger').item.json.messages[0].from }}`
  - `whatsappMessageId` = `{{ $('WhatsApp Trigger').item.json.messages[0].id }}`
- **AI-filled fields** use `$fromAI(...)`, as below.
- **Date and time format:** dates `YYYY-MM-DD`, times 24-hour `HH:mm` on :00 or :30, all in Asia/Manila.

---

## Verify User

**Description:**
Checks that the WhatsApp sender has an active Victory Booking System account and returns their first name. Call this first in every conversation. If ok is false, explain the code (USER_NOT_FOUND, ACCOUNT_PENDING, ACCOUNT_DENIED, ACCOUNT_REVOKED, PHONE_AMBIGUOUS) and do not use the other tools.

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/verify-user

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}"
}
```

---

## Get Rooms

**Description:**
Lists the Victory rooms that can be booked, with capacity, location and what each room is best for. Use it when the member asks which rooms exist, or to find a valid room name.

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/rooms

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}"
}
```

---

## Get Room Schedule

**Description:**
Shows one room's schedule for one date: available periods, reserved periods and times that are not available. Other people's reservations only show times labelled "Reserved"; never say who booked them. The member's own bookings are labelled "Your booking". Use it for questions like "What's Room A's schedule today?".

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/schedule

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}",
  "room": "{{ $fromAI('room', 'Room name as the member said it, e.g. Room A, B, Events Place A', 'string') }}",
  "date": "{{ $fromAI('date', 'Date in YYYY-MM-DD, Asia/Manila. Resolve today/tomorrow/weekday names first.', 'string') }}"
}
```

---

## Check Room Availability

**Description:**
Checks whether a specific Victory room is actually available for an explicit date and time. Always use this before offering availability to the user. Returns available true/false; when false, conflicts lists the blocking periods (times only).

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/check-availability

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}",
  "room": "{{ $fromAI('room', 'Room name as the member said it, e.g. Room A', 'string') }}",
  "date": "{{ $fromAI('date', 'Date in YYYY-MM-DD, Asia/Manila', 'string') }}",
  "startTime": "{{ $fromAI('startTime', 'Start time, 24-hour HH:mm on :00 or :30, e.g. 13:00', 'string') }}",
  "endTime": "{{ $fromAI('endTime', 'End time, 24-hour HH:mm on :00 or :30, e.g. 16:00', 'string') }}"
}
```

---

## Suggest Alternative Times

**Description:**
When a requested time is not available, returns up to 3 real free times in the same room on the same day, keeping the requested length when possible. Never invent times; offer only what this tool returns. An empty alternatives list (code NO_ALTERNATIVES) means the room has no suitable free time that day; then try Find Available Rooms or another date.

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/suggest-alternatives

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}",
  "room": "{{ $fromAI('room', 'Room name as the member said it', 'string') }}",
  "date": "{{ $fromAI('date', 'Date in YYYY-MM-DD, Asia/Manila', 'string') }}",
  "startTime": "{{ $fromAI('startTime', 'Requested start, HH:mm', 'string') }}",
  "endTime": "{{ $fromAI('endTime', 'Requested end, HH:mm', 'string') }}"
}
```

---

## Find Available Rooms

**Description:**
Finds every Victory room that is actually free for an explicit date and time, optionally only rooms big enough for attendeeCount. Use it for questions like "Which rooms are free Monday 3 to 5 PM?". Offer only rooms listed in availableRooms.

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/find-available-rooms

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}",
  "date": "{{ $fromAI('date', 'Date in YYYY-MM-DD, Asia/Manila', 'string') }}",
  "startTime": "{{ $fromAI('startTime', 'Start time, HH:mm', 'string') }}",
  "endTime": "{{ $fromAI('endTime', 'End time, HH:mm', 'string') }}",
  "attendeeCount": {{ $fromAI('attendeeCount', 'Number of people if the member said it, otherwise 1', 'number') }}
}
```

---

## Create Booking Request

**Description:**
Submits a booking request for the member. It becomes a PENDING request that the church office must approve; it is never approved automatically. The system re-checks availability before saving. Only call it after the member has confirmed the room, date, start and end time, event name, event type, purpose and number of people. eventType must be one of: Sunday school, Youth / teen activity, Ministry meeting, Workshop, Small group, Church activity, Internal event, Other. If the result has alternatives, offer those. If the code is GOOGLE_CALENDAR_REQUIRED, send the member the connectUrl.

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/create-booking

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}",
  "whatsappMessageId": "{{ $('WhatsApp Trigger').item.json.messages[0].id }}",
  "room": "{{ $fromAI('room', 'Confirmed room name', 'string') }}",
  "date": "{{ $fromAI('date', 'Confirmed date, YYYY-MM-DD, Asia/Manila', 'string') }}",
  "startTime": "{{ $fromAI('startTime', 'Confirmed start time, HH:mm', 'string') }}",
  "endTime": "{{ $fromAI('endTime', 'Confirmed end time, HH:mm', 'string') }}",
  "eventName": "{{ $fromAI('eventName', 'Short event name, e.g. Youth Service', 'string') }}",
  "eventType": "{{ $fromAI('eventType', 'One of: Sunday school, Youth / teen activity, Ministry meeting, Workshop, Small group, Church activity, Internal event, Other', 'string') }}",
  "purpose": "{{ $fromAI('purpose', 'One sentence about what the gathering is for', 'string') }}",
  "attendeeCount": {{ $fromAI('attendeeCount', 'Expected number of people', 'number') }}
}
```

---

## Get My Bookings

**Description:**
Lists the member's own booking requests (upcoming first) with room, event, date, time, status (pending, approved, denied, cancelled) and source. Use it for "What are my bookings?". It never shows anyone else's bookings.

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/my-bookings

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}",
  "includePast": {{ $fromAI('includePast', 'true only if the member asks about past bookings', 'boolean') }}
}
```

---

## Get Booking Status

**Description:**
Gets the status of one of the member's own bookings: pending, approved, denied (with denialReason) or cancelled. Look it up by bookingId if known, otherwise by room and/or date (YYYY-MM-DD). Use it for "What's the status of my Room A booking?".

**Method:** POST

**URL:** https://victory-booking-system.vercel.app/api/bot/booking-status

**Headers:** see Shared settings

**Body:**
```json
{
  "phone": "{{ $('WhatsApp Trigger').item.json.messages[0].from }}",
  "room": "{{ $fromAI('room', 'Room name if the member mentioned one, otherwise empty', 'string') }}",
  "date": "{{ $fromAI('date', 'Date YYYY-MM-DD if mentioned, otherwise empty', 'string') }}",
  "bookingId": "{{ $fromAI('bookingId', 'Booking id if known from an earlier tool result, otherwise empty', 'string') }}"
}
```

---

## Status webhook (optional, a separate n8n workflow)

- **Trigger:** a Webhook node (POST, Raw Body on) whose URL you put in `N8N_STATUS_WEBHOOK_URL` on Vercel.
- **Verify:** check `X-Victory-Signature` with `N8N_WEBHOOK_SIGNING_SECRET`. The Code node snippet is in [n8n-whatsapp-agent.md §5](n8n-whatsapp-agent.md#5-status-notifications-optional).
- **Ignore duplicates** by `X-Victory-Event-Id`.
- **Send** a WhatsApp message to `phone` about `event` (`booking.approved`, `booking.denied` with `denialReason`, or `booking.cancelled`).
