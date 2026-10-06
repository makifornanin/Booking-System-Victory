// Read-only availability diagnostic for the five room calendars. Compares each
// calendar's GHL settings, its assigned staff, the raw free slots GHL returns for
// every Asia/Manila date, and the final slots after local bookings are subtracted.
// Creates nothing and prints no secrets.
// Usage: npm run diagnose:availability -- [--from 2026-10-06] [--to 2026-10-14] [--raw]
import { createClient } from "./db-client.mjs";

const GHL = "https://services.leadconnectorhq.com";
const TZ = "Asia/Manila";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila has no DST
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const SLOT_MINUTES = 30;
const env = process.env;

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const todayKey = new Date(Date.now() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const from = arg("from") ?? todayKey;
const to = arg("to") ?? addDays(from, 8);
const showRaw = args.includes("--raw");

/** Midnight at the start of a Manila date, as a UTC instant. */
const manilaMidnight = (key) => Date.parse(`${key}T00:00:00Z`) - MANILA_OFFSET_MS;
const manilaKey = (ms) => new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10);
const manilaTime = (ms) => new Date(ms + MANILA_OFFSET_MS).toISOString().slice(11, 16);
const short = (id) => (id ? `…${String(id).slice(-6)}` : "—");

async function ghl(path, version = "2021-04-15") {
  const response = await fetch(`${GHL}${path}`, {
    headers: { Authorization: `Bearer ${env.GHL_PRIVATE_INTEGRATION_TOKEN}`, Version: version, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path.split("?")[0]}: ${[].concat(body?.message ?? "").join("; ")}`);
  return body;
}

const minutes = (value, unit) => (!value ? null : unit === "hours" ? value * 60 : unit === "days" ? value * 1440 : value);
const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeOpenHours(openHours) {
  if (!Array.isArray(openHours) || openHours.length === 0) return "none (calendar uses staff availability)";
  return openHours
    .map((rule) => {
      const days = (rule.daysOfTheWeek ?? []).map((d) => DAYS[d] ?? d).join(",");
      const hours = (rule.hours ?? []).map((h) => `${hhmm(h.openHour, h.openMinute)}–${hhmm(h.closeHour, h.closeMinute)}`).join(" ");
      return `${days} ${hours}`;
    })
    .join(" | ");
}

/** Same rules as the app: 30-minute grid 07:00–22:00 Manila, covered by GHL, not booked, not past. */
function finalSlots(dateKey, slotStarts, slotDurationMinutes, busy, nowMs) {
  const free = slotStarts.map((iso) => Date.parse(iso)).filter(Number.isFinite).map((s) => ({ start: s, end: s + slotDurationMinutes * 60_000 }));
  free.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of free) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const dayStart = manilaMidnight(dateKey) + DAY_START_HOUR * 3_600_000;
  const count = ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_MINUTES;
  const result = { available: 0, reserved: 0, unavailable: 0, past: 0, first: null, last: null };
  for (let i = 0; i < count; i++) {
    const s = dayStart + i * SLOT_MINUTES * 60_000;
    const e = s + SLOT_MINUTES * 60_000;
    if (s < nowMs) result.past++;
    else if (busy.some((b) => s < b.end && b.start < e)) result.reserved++;
    else if (!merged.some((f) => f.start <= s && f.end >= e)) result.unavailable++;
    else {
      result.available++;
      result.first ??= manilaTime(s);
      result.last = manilaTime(e);
    }
  }
  return result;
}

// Settings that can make one calendar's availability differ from another's.
const IGNORED_KEYS = new Set(["id", "name", "description", "slug", "widgetSlug", "locationId", "groupId", "dateAdded", "dateUpdated", "teamMembers", "openHours", "availabilities", "calendarCoverImage", "formId", "notifications", "eventTitle", "eventColor", "meetingLocation", "pixelId", "stickyContact", "googleInvitationEmails", "lookBusyConfig", "guestType", "consentLabel", "calendarCoverImage", "widgetType", "shouldSendAlertEmailsToAssignedMember", "alertEmail"]);

const db = createClient();
await db.connect();
const nowMs = Date.now();

try {
  const location = await ghl(`/locations/${encodeURIComponent(env.GHL_LOCATION_ID)}`, "2021-07-28").catch((e) => ({ error: e.message }));
  console.log(`Location timezone: ${location?.location?.timezone ?? location?.error ?? "unknown"} | app timezone: ${TZ}`);
  console.log(`Range: ${from} → ${to} (Asia/Manila dates) | now: ${manilaKey(nowMs)} ${manilaTime(nowMs)} Manila\n`);

  const rooms = (await db.query("select id, name, slug, ghl_calendar_id from public.rooms where is_active order by display_order")).rows;
  const envBySlug = {
    "room-a": env.GHL_CALENDAR_ROOM_A,
    "room-b": env.GHL_CALENDAR_ROOM_B,
    "room-c": env.GHL_CALENDAR_ROOM_C,
    "room-d": env.GHL_CALENDAR_ROOM_D,
    "events-place-a": env.GHL_CALENDAR_EVENTS_PLACE_A,
  };

  // --- Mapping ---------------------------------------------------------------
  console.log("== Calendar mapping (database vs .env) ==");
  const ids = new Set();
  for (const room of rooms) {
    const fromEnv = envBySlug[room.slug]?.trim();
    const dup = ids.has(room.ghl_calendar_id);
    ids.add(room.ghl_calendar_id);
    console.log(`${room.name.padEnd(18)} db ${short(room.ghl_calendar_id)}  env ${short(fromEnv)}  ${fromEnv === room.ghl_calendar_id ? "match" : "MISMATCH"}${dup ? "  DUPLICATE ID" : ""}`);
  }

  // --- Settings --------------------------------------------------------------
  const calendars = [];
  for (const room of rooms) {
    const { calendar } = await ghl(`/calendars/${encodeURIComponent(room.ghl_calendar_id)}`);
    calendars.push({ room, calendar });
  }
  console.log("\n== Calendar settings ==");
  for (const { room, calendar: c } of calendars) {
    const members = (c.teamMembers ?? []).map((m) => `${short(m.userId)}${m.isPrimary ? " primary" : ""}${m.selected === false ? " unselected" : ""}`).join(", ") || "none";
    console.log(`\n${room.name} (${short(c.id)}) "${c.name}"`);
    console.log(`  type ${c.calendarType} / event ${c.eventType ?? "—"} | active ${c.isActive !== false}`);
    console.log(`  slot interval ${minutes(c.slotInterval, c.slotIntervalUnit)} min | slot duration ${minutes(c.slotDuration, c.slotDurationUnit)} min | buffer ${c.slotBuffer ?? 0} | pre-buffer ${c.preBuffer ?? 0} | per slot ${c.appoinmentPerSlot ?? "—"}`);
    console.log(`  minimum notice (allowBookingAfter) ${c.allowBookingAfter ?? 0} ${c.allowBookingAfterUnit ?? ""} | booking window (allowBookingFor) ${c.allowBookingFor ?? "—"} ${c.allowBookingForUnit ?? ""}`);
    console.log(`  availability type ${c.availabilityType ?? "—"} | open hours ${describeOpenHours(c.openHours)}`);
    console.log(`  date overrides ${Array.isArray(c.availabilities) ? c.availabilities.length : 0} | team ${members}`);
  }

  // Every other setting that differs between calendars.
  const keys = new Set(calendars.flatMap(({ calendar }) => Object.keys(calendar)));
  const differing = [...keys].filter((key) => !IGNORED_KEYS.has(key)).filter((key) => new Set(calendars.map(({ calendar }) => JSON.stringify(calendar[key] ?? null))).size > 1);
  console.log("\n== Settings that differ between the calendars ==");
  if (differing.length === 0) console.log("none (besides names/IDs)");
  for (const key of differing) {
    console.log(`  ${key}: ${calendars.map(({ room, calendar }) => `${room.name}=${JSON.stringify(calendar[key] ?? null)}`).join(" | ")}`);
  }
  const hoursDiffer = new Set(calendars.map(({ calendar }) => JSON.stringify(calendar.openHours ?? []))).size > 1;
  const teamDiffer = new Set(calendars.map(({ calendar }) => JSON.stringify((calendar.teamMembers ?? []).map((m) => m.userId).sort()))).size > 1;
  console.log(`  openHours differ: ${hoursDiffer} | team members differ: ${teamDiffer}`);

  // Service calendars block a staff member's time across every calendar they belong to.
  const staffRooms = new Map();
  for (const { room, calendar } of calendars) for (const m of calendar.teamMembers ?? []) if (m.userId) staffRooms.set(m.userId, [...(staffRooms.get(m.userId) ?? []), room.name]);
  const shared = [...staffRooms].filter(([, names]) => names.length > 1);
  console.log("\n== Shared staff ==");
  if (shared.length === 0) console.log("none: each room calendar has its own team member");
  for (const [userId, names] of shared) {
    console.log(`  WARNING team member ${short(userId)} is assigned to ${names.join(", ")}.`);
    console.log("  GHL treats an appointment in any of these calendars as that person being busy, so booking one room removes the same time (plus buffer) from the others.");
  }
  const sharedRooms = new Set(shared.flatMap(([, names]) => names));

  // --- Free slots ------------------------------------------------------------
  console.log("\n== Free slots per Asia/Manila date (raw GHL → final after local bookings) ==");
  const dates = [];
  for (let key = from; key <= to; key = addDays(key, 1)) dates.push(key);
  for (const { room, calendar: c } of calendars) {
    console.log(`\n${room.name}`);
    const duration = minutes(c.slotDuration, c.slotDurationUnit) ?? SLOT_MINUTES;
    for (const key of dates) {
      const start = manilaMidnight(key);
      const end = start + 86_400_000;
      const payload = await ghl(`/calendars/${encodeURIComponent(c.id)}/free-slots?startDate=${start}&endDate=${end}&timezone=${encodeURIComponent(TZ)}`);
      const dayKeys = Object.keys(payload).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
      const slots = dayKeys.flatMap((k) => payload[k]?.slots ?? []);
      const onDate = slots.filter((iso) => manilaKey(Date.parse(iso)) === key);
      const busy = (
        await db.query(
          "select lower(tstzrange(start_time, end_time)) as s, upper(tstzrange(start_time, end_time)) as e from public.bookings where room_id = $1 and status in ('pending','approved') and start_time < $3 and end_time > $2",
          [room.id, new Date(start), new Date(end)],
        )
      ).rows.map((r) => ({ start: new Date(r.s).getTime(), end: new Date(r.e).getTime() }));
      const final = finalSlots(key, slots, duration, busy, nowMs);
      const raw = onDate.length ? `${onDate.length} starts ${manilaTime(Date.parse(onDate[0]))}–${manilaTime(Date.parse(onDate[onDate.length - 1]))}` : "0 starts";
      const keysNote = dayKeys.length && dayKeys.some((k) => k !== key) ? ` (response date keys: ${dayKeys.join(",")})` : "";
      const finalNote = final.available ? `${final.available} bookable ${final.first}–${final.last}` : "none bookable";
      const others = sharedRooms.has(room.name)
        ? (
            await db.query(
              "select r.name, b.start_time, b.end_time from public.bookings b join public.rooms r on r.id = b.room_id where b.room_id <> $1 and b.status = 'approved' and b.ghl_appointment_id is not null and b.start_time < $3 and b.end_time > $2 order by b.start_time",
              [room.id, new Date(start), new Date(end)],
            )
          ).rows.filter((r) => sharedRooms.has(r.name))
        : [];
      const othersNote = others.length ? ` [blocked by shared staff: ${others.map((r) => `${r.name} ${manilaTime(new Date(r.start_time).getTime())}–${manilaTime(new Date(r.end_time).getTime())}`).join(", ")}]` : "";
      console.log(`  ${key} ${DAYS[new Date(`${key}T00:00:00Z`).getUTCDay()]}  GHL ${raw.padEnd(22)} → ${finalNote}${final.reserved ? `, ${final.reserved} reserved` : ""}${final.past ? `, ${final.past} past` : ""}${keysNote}${othersNote}`);
      if (showRaw) console.log(`      raw: ${JSON.stringify(onDate.slice(0, 6))}${onDate.length > 6 ? " …" : ""}`);
    }
  }
} finally {
  await db.end();
}
