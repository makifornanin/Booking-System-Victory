import { z } from "zod";
import { DAY_END_HOUR, DAY_START_HOUR, EVENT_TYPES, TIME_ZONE, eventTypeLabel } from "@/lib/config";
import type { SessionUser } from "@/lib/auth/provider";
import { PENDING_LIMIT_MESSAGE, type Repository } from "@/lib/data/repository";
import type { AccessStatus, BookingWithRoom, Role, Room } from "@/lib/data/types";
import { groupIntoSegments, isRangeBookable, rangesOverlap, type DaySlot } from "@/lib/domain/availability";
import { isBlockingStatus } from "@/lib/domain/booking-rules";
import { dateKeyInZone, formatDate, formatDateKey, formatTime, timeKeyInZone, zonedDayRange } from "@/lib/domain/time";
import type { CalendarGateway } from "@/lib/ghl/gateway";
import type { GoogleCalendarGateway } from "@/lib/google/gateway";
import { findAlternativeWindows } from "@/lib/bot/alternatives";
import { botError, type BotFailure, type BotResponse } from "@/lib/bot/errors";
import { normalizeSenderPhone, parseBotDate, parseBotWindow, type BotWindow } from "@/lib/bot/input";
import { resolveRoom } from "@/lib/bot/rooms";
import { getRoomDayAvailability, type RoomDayAvailability } from "@/lib/services/availability";
import { BOOKING_RACE_MESSAGE, createBookingRequest } from "@/lib/services/bookings";

/** What the bot knows about the person behind a WhatsApp number. Never returned as-is. */
export interface BotProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  accessStatus: AccessStatus;
  accessReason: string | null;
}

export interface BotDeps {
  /** Exact match on the stored E.164 phone. Returns every account using that number. */
  findProfilesByPhone(phone: string): Promise<BotProfile[]>;
  /** Repository acting as that user: row-level security applies to every call. */
  repoFor(userId: string): Repository;
  calendar: CalendarGateway;
  google: GoogleCalendarGateway;
  now: () => Date;
  siteUrl: string;
}

// --- Identity ----------------------------------------------------------------

const ACCESS_CODES = {
  pending: ["ACCOUNT_PENDING", "This account is waiting for the church office to approve it."],
  denied: ["ACCOUNT_DENIED", "This account was not approved for booking."],
  revoked: ["ACCOUNT_REVOKED", "Booking access for this account has been revoked."],
} as const;

/**
 * Resolves the WhatsApp sender to exactly one active account. The phone comes
 * from WhatsApp metadata (via n8n), never from the AI. A number shared by more
 * than one account is refused rather than guessed.
 */
export async function resolveBotUser(rawPhone: unknown, deps: BotDeps): Promise<{ ok: true; user: BotProfile } | BotFailure> {
  const phone = normalizeSenderPhone(rawPhone);
  if (!phone) return botError("INVALID_PHONE", "The sender phone number is missing or not a valid phone number.");

  const matches = await deps.findProfilesByPhone(phone);
  if (matches.length === 0) {
    return botError("USER_NOT_FOUND", "No Victory Booking System account uses this WhatsApp number. The member can sign up on the website.", {
      signUpUrl: `${deps.siteUrl}/login?mode=signup`,
    });
  }
  if (matches.length > 1) {
    console.warn(`[bot] phone ending ${phone.slice(-4)} belongs to ${matches.length} accounts; refusing to choose`);
    return botError("PHONE_AMBIGUOUS", "This WhatsApp number is linked to more than one account. The member should contact the church office.");
  }
  const [user] = matches;
  if (user.accessStatus !== "active") {
    const [code, message] = ACCESS_CODES[user.accessStatus];
    return botError(code, message);
  }
  return { ok: true, user };
}

function sessionFor(user: BotProfile): SessionUser {
  return { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, role: user.role, accessStatus: user.accessStatus, accessReason: user.accessReason };
}

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? "";

// --- Shared formatting ------------------------------------------------------

const displayTime = (start: Date | string | number, end: Date | string | number) => `${formatTime(start)} - ${formatTime(end)}`;

/** 24-hour "HH:mm" in Asia/Manila. */
const timeKey = (value: Date | string | number) => timeKeyInZone(value);

function bookingSummary(booking: BookingWithRoom) {
  return {
    id: booking.id,
    status: booking.status,
    room: booking.room.name,
    event: booking.eventName,
    eventType: eventTypeLabel(booking.eventType),
    date: dateKeyInZone(booking.startTime),
    displayDate: formatDate(booking.startTime, "EEEE, MMMM d"),
    startTime: timeKey(booking.startTime),
    endTime: timeKey(booking.endTime),
    displayTime: displayTime(booking.startTime, booking.endTime),
    source: booking.source,
    ...(booking.status === "denied" ? { denialReason: booking.denialReason } : {}),
  };
}

const roomSummary = (room: Room) => ({
  name: room.name,
  capacity: room.capacity,
  location: room.locationLabel,
  description: room.shortDescription,
  bestFor: room.bestFor,
});

const periodLabel: Record<DaySlot["status"], string> = {
  available: "Available",
  reserved: "Reserved",
  unavailable: "Not available",
  past: "Passed",
};

// --- Input schemas (unknown keys such as userId are ignored, never trusted) --

const phoneOnly = z.object({ phone: z.unknown() });
const scheduleInput = z.object({ phone: z.unknown(), room: z.unknown(), date: z.unknown() });
const windowInput = z.object({ phone: z.unknown(), room: z.unknown(), date: z.unknown(), startTime: z.unknown(), endTime: z.unknown() });
const findRoomsInput = z.object({
  phone: z.unknown(),
  date: z.unknown(),
  startTime: z.unknown(),
  endTime: z.unknown(),
  attendeeCount: z.coerce.number().int().min(1).max(1000).optional(),
});
const createInput = z.object({
  phone: z.unknown(),
  room: z.unknown(),
  date: z.unknown(),
  startTime: z.unknown(),
  endTime: z.unknown(),
  eventName: z.string().trim().min(2).max(120),
  eventType: z.string().trim().min(1).max(60),
  purpose: z.string().trim().min(3).max(1000),
  attendeeCount: z.coerce.number().int().min(1).max(1000),
  whatsappMessageId: z.string().trim().min(1).max(200),
});
const myBookingsInput = z.object({
  phone: z.unknown(),
  status: z.enum(["pending", "approved", "denied", "cancelled"]).optional(),
  includePast: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});
const statusInput = z.object({ phone: z.unknown(), bookingId: z.string().trim().optional(), room: z.unknown().optional(), date: z.unknown().optional() });

function invalidInput(error: z.ZodError): BotFailure {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? "body")] ??= issue.message;
  return botError("INVALID_INPUT", "Some fields are missing or invalid.", { requiresClarification: true, fields });
}

// --- Availability helpers ---------------------------------------------------

async function roomContext(user: BotProfile, roomQuery: unknown, deps: BotDeps) {
  const repo = deps.repoFor(user.id);
  const rooms = await repo.listActiveRooms();
  const resolved = resolveRoom(roomQuery, rooms);
  return { repo, resolved };
}

function availabilityProblem(availability: RoomDayAvailability, room: Room): BotFailure | null {
  if (!availability.problem) return null;
  if (availability.problem === "calendar_unavailable") {
    return botError("GHL_UNAVAILABLE", `The church calendar for ${room.name} couldn't be reached. Try again in a few minutes.`, { retryable: true });
  }
  if (availability.problem === "calendar_not_configured") {
    return botError("ROOM_UNAVAILABLE", `${room.name} isn't open for online booking right now.`);
  }
  return botError("BOOKING_TOO_FAR_AHEAD", availability.problemMessage ?? "That date can't be booked.");
}

/** The production availability engine: GHL free slots minus local pending/approved bookings. */
function dayAvailability(repo: Repository, room: Room, dateKey: string, deps: BotDeps) {
  return getRoomDayAvailability(room, dateKey, { repo, calendar: deps.calendar, now: deps.now }, { forDisplay: true });
}

function conflictsWithin(slots: DaySlot[], window: Pick<BotWindow, "start" | "end">) {
  const range = { start: window.start.getTime(), end: window.end.getTime() };
  return groupIntoSegments(slots)
    .filter((segment) => segment.status !== "available")
    .filter((segment) => rangesOverlap({ start: new Date(segment.start).getTime(), end: new Date(segment.end).getTime() }, range))
    .map((segment) => ({ start: timeKey(segment.start), end: timeKey(segment.end), label: periodLabel[segment.status] }));
}

function alternativesFor(slots: DaySlot[], window: BotWindow) {
  return findAlternativeWindows(slots, window.start.getTime(), window.durationMinutes).map((alt) => ({
    startTime: timeKey(alt.start),
    endTime: timeKey(alt.end),
    displayTime: displayTime(alt.start, alt.end),
    durationMinutes: (alt.end - alt.start) / 60_000,
    preservesDuration: alt.preservesDuration,
  }));
}

const windowEcho = (room: Room, window: BotWindow) => ({
  room: room.name,
  date: window.dateKey,
  displayDate: formatDateKey(window.dateKey),
  startTime: window.startTime,
  endTime: window.endTime,
  displayTime: displayTime(window.start, window.end),
  durationMinutes: window.durationMinutes,
});

// --- Tools ------------------------------------------------------------------

/** Verify User: is this WhatsApp sender an active member? */
export async function verifyUser(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = phoneOnly.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  return { ok: true, user: { firstName: firstName(resolved.user.fullName), phone: resolved.user.phone, accessStatus: resolved.user.accessStatus } };
}

/** Get Rooms: the bookable rooms, by name. */
export async function listRooms(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = phoneOnly.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  const rooms = await deps.repoFor(resolved.user.id).listActiveRooms();
  return { ok: true, timezone: TIME_ZONE, rooms: rooms.map(roomSummary) };
}

/** Get Room Schedule: free and reserved periods for one room and date. Other people's bookings are anonymous. */
export async function getSchedule(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = scheduleInput.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  const user = resolved.user;
  const date = parseBotDate(input.data.date, deps.now());
  if (!date.ok) return date;
  const { repo, resolved: roomResult } = await roomContext(user, input.data.room, deps);
  if (!roomResult.ok) return roomResult;
  const room = roomResult.room;

  const { start: dayStart, end: dayEnd } = zonedDayRange(date.dateKey);
  const [availability, busy, own] = await Promise.all([
    dayAvailability(repo, room, date.dateKey, deps),
    repo.getBusyRanges(room.id, dayStart, dayEnd),
    repo.listBookingsForUser(user.id),
  ]);
  const problem = availabilityProblem(availability, room);
  if (problem) return problem;

  const mine = own.filter((b) => b.userId === user.id && b.roomId === room.id && isBlockingStatus(b.status));
  const reserved = busy
    .map((range) => ({ start: Math.max(range.start, dayStart.getTime()), end: Math.min(range.end, dayEnd.getTime()) }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
    .map((range) => {
      const booking = mine.find((b) => new Date(b.startTime).getTime() === range.start && new Date(b.endTime).getTime() === range.end);
      return booking
        ? { start: timeKey(range.start), end: timeKey(range.end), label: "Your booking", yours: true, event: booking.eventName, status: booking.status, bookingId: booking.id }
        : { start: timeKey(range.start), end: timeKey(range.end), label: "Reserved" };
    });

  const segments = groupIntoSegments(availability.slots);
  return {
    ok: true,
    room: room.name,
    date: date.dateKey,
    displayDate: formatDateKey(date.dateKey),
    timezone: TIME_ZONE,
    bookableHours: { opens: `${String(DAY_START_HOUR).padStart(2, "0")}:00`, closes: `${String(DAY_END_HOUR).padStart(2, "0")}:00` },
    available: segments.filter((s) => s.status === "available").map((s) => ({ start: timeKey(s.start), end: timeKey(s.end) })),
    reserved,
    notAvailable: segments
      .filter((s) => s.status === "unavailable" || s.status === "past")
      .map((s) => ({ start: timeKey(s.start), end: timeKey(s.end), label: periodLabel[s.status] })),
  };
}

/** Check Room Availability: is this exact room/date/time bookable right now? */
export async function checkAvailability(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = windowInput.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  const window = parseBotWindow(input.data, deps.now());
  if (!window.ok) return window;
  const { repo, resolved: roomResult } = await roomContext(resolved.user, input.data.room, deps);
  if (!roomResult.ok) return roomResult;
  const room = roomResult.room;

  const availability = await dayAvailability(repo, room, window.dateKey, deps);
  const problem = availabilityProblem(availability, room);
  if (problem) return problem;

  if (isRangeBookable(availability.slots, { start: window.start.getTime(), end: window.end.getTime() })) {
    return { ok: true, available: true, ...windowEcho(room, window) };
  }
  return { ok: true, available: false, code: "TIME_UNAVAILABLE", ...windowEcho(room, window), conflicts: conflictsWithin(availability.slots, window) };
}

/** Suggest Alternative Times: real free windows in the same room and day, keeping the length when possible. */
export async function suggestAlternatives(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = windowInput.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  const window = parseBotWindow(input.data, deps.now());
  if (!window.ok) return window;
  const { repo, resolved: roomResult } = await roomContext(resolved.user, input.data.room, deps);
  if (!roomResult.ok) return roomResult;
  const room = roomResult.room;

  const availability = await dayAvailability(repo, room, window.dateKey, deps);
  const problem = availabilityProblem(availability, room);
  if (problem) return problem;

  const available = isRangeBookable(availability.slots, { start: window.start.getTime(), end: window.end.getTime() });
  const alternatives = available ? [] : alternativesFor(availability.slots, window);
  return {
    ok: true,
    available,
    ...(available ? {} : { code: alternatives.length ? "TIME_UNAVAILABLE" : "NO_ALTERNATIVES" }),
    ...windowEcho(room, window),
    alternatives,
  };
}

/** Find Available Rooms: every active room that is actually free for the window. */
export async function findAvailableRooms(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = findRoomsInput.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  const window = parseBotWindow(input.data, deps.now());
  if (!window.ok) return window;

  const repo = deps.repoFor(resolved.user.id);
  const rooms = (await repo.listActiveRooms()).filter((room) => !input.data.attendeeCount || room.capacity >= input.data.attendeeCount);
  const results = await Promise.all(
    rooms.map(async (room) => {
      const availability = await dayAvailability(repo, room, window.dateKey, deps);
      if (availability.problem) return { room, state: "unchecked" as const };
      const free = isRangeBookable(availability.slots, { start: window.start.getTime(), end: window.end.getTime() });
      return { room, state: free ? ("free" as const) : ("busy" as const) };
    }),
  );
  const free = results.filter((r) => r.state === "free").map((r) => roomSummary(r.room));
  return {
    ok: true,
    ...(free.length === 0 ? { code: "TIME_UNAVAILABLE" } : {}),
    date: window.dateKey,
    displayDate: formatDateKey(window.dateKey),
    startTime: window.startTime,
    endTime: window.endTime,
    displayTime: displayTime(window.start, window.end),
    availableRooms: free,
    unavailableRooms: results.filter((r) => r.state === "busy").map((r) => r.room.name),
    roomsNotChecked: results.filter((r) => r.state === "unchecked").map((r) => r.room.name),
  };
}

function resolveEventType(value: string): string | null {
  const text = value.trim().toLowerCase();
  return EVENT_TYPES.find((type) => type.value === text || type.label.toLowerCase() === text)?.value ?? null;
}

/**
 * Create Booking Request: submits a real pending request through the same
 * booking service as the website. Always re-checks availability; never approves.
 * The same WhatsApp message id never creates a second booking.
 */
export async function createBooking(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = createInput.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  const user = resolved.user;
  const repo = deps.repoFor(user.id);

  const duplicate = async (): Promise<BotResponse> => {
    const existing = await repo.findBookingByWhatsAppMessageId(input.data.whatsappMessageId);
    if (existing && existing.userId === user.id) {
      return { ok: true, code: "DUPLICATE_MESSAGE", duplicate: true, booking: bookingSummary(existing) };
    }
    return botError("DUPLICATE_MESSAGE", "This WhatsApp message was already used for a booking request.");
  };
  if (await repo.findBookingByWhatsAppMessageId(input.data.whatsappMessageId)) return duplicate();

  const window = parseBotWindow(input.data, deps.now());
  if (!window.ok) return window;
  const rooms = await repo.listActiveRooms();
  const roomResult = resolveRoom(input.data.room, rooms);
  if (!roomResult.ok) return roomResult;
  const room = roomResult.room;
  const eventType = resolveEventType(input.data.eventType);
  if (!eventType) {
    return botError("INVALID_INPUT", "Unknown event type.", { requiresClarification: true, fields: { eventType: "Unknown event type." }, choices: EVENT_TYPES.map((t) => t.label) });
  }
  if (input.data.attendeeCount > room.capacity) {
    return botError("ATTENDEES_EXCEED_CAPACITY", `${room.name} holds up to ${room.capacity} people.`, { requiresClarification: true, capacity: room.capacity });
  }

  const result = await createBookingRequest(
    {
      roomId: room.id,
      date: window.dateKey,
      startTime: window.startTime,
      endTime: window.endTime,
      eventName: input.data.eventName,
      eventType,
      purpose: input.data.purpose,
      attendeeCount: input.data.attendeeCount,
    },
    sessionFor(user),
    { repo, calendar: deps.calendar, google: deps.google, now: deps.now },
    { source: "whatsapp", whatsappMessageId: input.data.whatsappMessageId },
  );

  if (result.ok) {
    const booking = await repo.getBookingDetails(result.data.bookingId);
    if (!booking || booking.userId !== user.id) return botError("INTERNAL_ERROR", "The request was saved but couldn't be read back.");
    return { ok: true, code: "BOOKING_CREATED", booking: bookingSummary(booking) };
  }

  switch (result.code) {
    case "duplicate":
      return duplicate();
    case "calendar_required":
      return botError("GOOGLE_CALENDAR_REQUIRED", "The member must connect Google Calendar on the website once before their first booking.", {
        connectUrl: `${deps.siteUrl}/account`,
      });
    case "not_found":
      return botError("ROOM_NOT_FOUND", result.error, { choices: rooms.map((r) => r.name) });
    case "calendar_error":
      return botError("GHL_UNAVAILABLE", "The church calendar couldn't be checked right now. Try again in a few minutes.", { retryable: true });
    case "conflict": {
      const availability = await dayAvailability(repo, room, window.dateKey, deps);
      const alternatives = availability.problem ? [] : alternativesFor(availability.slots, window);
      const code = result.error === BOOKING_RACE_MESSAGE ? "BOOKING_CONFLICT" : "TIME_UNAVAILABLE";
      return botError(code, "That time isn't available for this room.", { ...windowEcho(room, window), alternatives });
    }
    case "invalid":
      if (result.error === PENDING_LIMIT_MESSAGE) return botError("TOO_MANY_PENDING", result.error);
      return botError("INVALID_INPUT", result.error, { requiresClarification: true, fields: result.fieldErrors ?? {} });
    case "access_required":
      return botError("ACCOUNT_PENDING", ACCESS_CODES.pending[1]);
    default:
      return botError("INTERNAL_ERROR", "The request couldn't be saved. Try again shortly.", { retryable: true });
  }
}

function sortForMember(bookings: BookingWithRoom[], now: Date) {
  const upcoming = bookings.filter((b) => new Date(b.endTime) > now).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const past = bookings.filter((b) => new Date(b.endTime) <= now).sort((a, b) => b.startTime.localeCompare(a.startTime));
  return { upcoming, past };
}

/** Get My Bookings: only the sender's own requests, upcoming first. */
export async function myBookings(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = myBookingsInput.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  const user = resolved.user;
  const now = deps.now();

  const all = (await deps.repoFor(user.id).listBookingsForUser(user.id)).filter((b) => b.userId === user.id);
  const filtered = input.data.status ? all.filter((b) => b.status === input.data.status) : all;
  const { upcoming, past } = sortForMember(filtered, now);
  const list = [...upcoming, ...(input.data.includePast ? past : [])].slice(0, input.data.limit ?? 10);
  return { ok: true, timezone: TIME_ZONE, count: list.length, upcomingCount: upcoming.length, bookings: list.map(bookingSummary) };
}

/** Get Booking Status: one of the sender's bookings, by id or by room/date. */
export async function bookingStatus(body: unknown, deps: BotDeps): Promise<BotResponse> {
  const input = statusInput.safeParse(body);
  if (!input.success) return invalidInput(input.error);
  const resolved = await resolveBotUser(input.data.phone, deps);
  if (!resolved.ok) return resolved;
  const user = resolved.user;
  const repo = deps.repoFor(user.id);
  const now = deps.now();

  // Ownership is checked in code as well as by row-level security.
  const own = (await repo.listBookingsForUser(user.id)).filter((b) => b.userId === user.id);

  if (input.data.bookingId) {
    const booking = own.find((b) => b.id === input.data.bookingId);
    return booking ? { ok: true, booking: bookingSummary(booking) } : botError("BOOKING_NOT_FOUND", "No booking with that id belongs to this member.");
  }

  let candidates = own;
  if (input.data.room !== undefined && input.data.room !== null && input.data.room !== "") {
    const roomResult = resolveRoom(input.data.room, await repo.listActiveRooms());
    if (!roomResult.ok) return roomResult;
    candidates = candidates.filter((b) => b.roomId === roomResult.room.id);
  }
  if (input.data.date !== undefined && input.data.date !== null && input.data.date !== "") {
    const dateKey = typeof input.data.date === "string" ? input.data.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return botError("AMBIGUOUS_DATE", "Send the date as YYYY-MM-DD in Asia/Manila time.", { requiresClarification: true });
    }
    candidates = candidates.filter((b) => dateKeyInZone(b.startTime) === dateKey);
  }

  const { upcoming, past } = sortForMember(candidates, now);
  const ordered = [...upcoming, ...past];
  if (ordered.length === 0) return botError("BOOKING_NOT_FOUND", "No matching booking for this member.");
  return { ok: true, booking: bookingSummary(ordered[0]), otherMatches: ordered.slice(1, 4).map(bookingSummary) };
}

export const BOT_TOOLS = {
  "verify-user": verifyUser,
  rooms: listRooms,
  schedule: getSchedule,
  "check-availability": checkAvailability,
  "suggest-alternatives": suggestAlternatives,
  "find-available-rooms": findAvailableRooms,
  "create-booking": createBooking,
  "my-bookings": myBookings,
  "booking-status": bookingStatus,
} as const;

export type BotToolName = keyof typeof BOT_TOOLS;

