import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findAlternativeWindows } from "@/lib/bot/alternatives";
import { normalizeSenderPhone, parseBotWindow } from "@/lib/bot/input";
import { resolveRoom } from "@/lib/bot/rooms";
import { buildStatusPayload, createStatusNotifier, deliverStatusWebhook } from "@/lib/bot/status-webhook";
import {
  bookingStatus,
  checkAvailability,
  createBooking,
  findAvailableRooms,
  getSchedule,
  myBookings,
  suggestAlternatives,
  verifyUser,
  type BotDeps,
} from "@/lib/bot/tools";
import type { BookingDetails } from "@/lib/data/types";
import { createDemoRepository } from "@/lib/demo/repository";
import { getDemoState } from "@/lib/demo/store";
import { buildDaySlots } from "@/lib/domain/availability";
import { addDaysToKey, dateKeyInZone, zonedDateTime } from "@/lib/domain/time";
import { GhlError } from "@/lib/ghl/errors";
import type { CalendarGateway } from "@/lib/ghl/gateway";
import { approveBooking, createBookingRequest, denyBooking } from "@/lib/services/bookings";
import { retryStatusNotification } from "@/lib/services/status-notifications";
import { admin, fakeGhl, fakeGoogle, member, otherMember, ROOM_A } from "./fakes";

vi.mock("@/lib/bot/deps", () => ({ getBotDeps: async () => ({}) }));

/** Test-only typed view of a tool response. */
const view = <T>(value: unknown) => value as T;

const DAY = addDaysToKey(dateKeyInZone(new Date()), 10);
const MEMBER_PHONE = "+639170000002";
const OTHER_PHONE = "+639170000003";
const PENDING_PHONE = "+639170000004";

function deps(overrides: Partial<BotDeps> & { blocked?: { from: string; to: string }[] } = {}): BotDeps {
  const { blocked, ...rest } = overrides;
  return {
    findProfilesByPhone: async (phone) =>
      getDemoState()
        .users.filter((u) => u.phone === phone)
        .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, accessStatus: u.accessStatus, accessReason: u.accessReason })),
    repoFor: (userId) => createDemoRepository(userId),
    calendar: fakeGhl({ day: DAY, blocked }).gateway,
    google: fakeGoogle().gateway,
    now: () => new Date(),
    siteUrl: "https://booking.example.test",
    ...rest,
  };
}

/** A web booking by someone else, straight through the production booking service. */
async function bookAs(actor: typeof member, from: string, to: string, extra: Record<string, unknown> = {}) {
  const result = await createBookingRequest(
    { roomId: ROOM_A, date: DAY, startTime: from, endTime: to, eventName: "Secret Planning", eventType: "ministry_meeting", attendeeCount: 8, purpose: "Private purpose text", ...extra },
    actor,
    { repo: createDemoRepository(actor.id), calendar: fakeGhl({ day: DAY }).gateway, google: fakeGoogle().gateway, now: () => new Date() },
  );
  if (!result.ok) throw new Error(result.error);
  return result.data.bookingId;
}

const createBody = (extra: Record<string, unknown> = {}) => ({
  phone: MEMBER_PHONE,
  room: "Room A",
  date: DAY,
  startTime: "13:00",
  endTime: "16:00",
  eventName: "Youth Service",
  eventType: "Youth / teen activity",
  purpose: "Youth service practice",
  attendeeCount: 25,
  whatsappMessageId: `wamid.${Math.random().toString(36).slice(2)}`,
  ...extra,
});

beforeEach(() => {
  view<{ __victoryDemoState?: unknown }>(globalThis).__victoryDemoState = undefined;
});

// ---------------------------------------------------------------------------

describe("bot auth", () => {
  const KEY = "k".repeat(40);
  let ip = 0;
  const call = async (headers: Record<string, string>, body: unknown = { phone: MEMBER_PHONE }) => {
    const { botRoute } = await import("@/lib/bot/http");
    const route = botRoute("test", async () => ({ ok: true, reached: true }));
    return route(new Request("http://localhost/api/bot/test", { method: "POST", headers: { "x-real-ip": `10.0.0.${++ip}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  };

  beforeEach(() => vi.stubEnv("N8N_BOOKING_API_KEY", KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a missing API key", async () => {
    const response = await call({});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED_BOT" });
  });

  it("rejects a wrong API key", async () => {
    expect((await call({ authorization: `Bearer ${"x".repeat(40)}` })).status).toBe(401);
    expect((await call({ authorization: KEY })).status).toBe(401); // no Bearer scheme
  });

  it("refuses everything when no key is configured", async () => {
    vi.stubEnv("N8N_BOOKING_API_KEY", "");
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    vi.stubEnv("N8N_BOOKING_API_KEY", "too-short");
    expect((await call({ authorization: "Bearer too-short" })).status).toBe(401);
  });

  it("accepts the right key", async () => {
    const response = await call({ authorization: `Bearer ${KEY}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, reached: true });
  });

  it("rejects malformed JSON and rate-limits repeated bad keys", async () => {
    expect((await call({ authorization: `Bearer ${KEY}` }, "{not json")).status).toBe(400);
    const { botRoute } = await import("@/lib/bot/http");
    const route = botRoute("test", async () => ({ ok: true }));
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const response = await route(new Request("http://localhost/api/bot/test", { method: "POST", headers: { "x-real-ip": "10.9.9.9", authorization: "Bearer nope" }, body: "{}" }));
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("phone identity", () => {
  it("normalizes Philippine and WhatsApp formats to E.164", () => {
    for (const input of ["09171234567", "639171234567", "+639171234567", "+63 917 123 4567", "0917-123-4567"]) {
      expect(normalizeSenderPhone(input)).toBe("+639171234567");
    }
    expect(normalizeSenderPhone("15551234567")).toBe("+15551234567");
    expect(normalizeSenderPhone("not a phone")).toBeNull();
    expect(normalizeSenderPhone("")).toBeNull();
    expect(normalizeSenderPhone(undefined)).toBeNull();
  });

  it("answers for an active member without exposing account internals", async () => {
    const result = await verifyUser({ phone: "639170000002" }, deps());
    expect(result).toEqual({ ok: true, user: { firstName: "Jamie", phone: MEMBER_PHONE, accessStatus: "active" } });
  });

  it("returns specific codes for unknown, pending, denied and revoked accounts", async () => {
    expect(await verifyUser({ phone: "+639999999999" }, deps())).toMatchObject({ ok: false, code: "USER_NOT_FOUND" });
    expect(await verifyUser({ phone: PENDING_PHONE }, deps())).toMatchObject({ ok: false, code: "ACCOUNT_PENDING" });
    const other = getDemoState().users.find((u) => u.phone === OTHER_PHONE)!;
    other.accessStatus = "denied";
    expect(await verifyUser({ phone: OTHER_PHONE }, deps())).toMatchObject({ ok: false, code: "ACCOUNT_DENIED" });
    other.accessStatus = "revoked";
    expect(await verifyUser({ phone: OTHER_PHONE }, deps())).toMatchObject({ ok: false, code: "ACCOUNT_REVOKED" });
    expect(await verifyUser({ phone: "nonsense" }, deps())).toMatchObject({ ok: false, code: "INVALID_PHONE" });
  });

  it("refuses to choose between accounts that share a number", async () => {
    const state = getDemoState();
    state.users.push({ ...state.users.find((u) => u.phone === MEMBER_PHONE)!, id: "8f3c1a52-1b7e-4c1a-9a51-0a00000000ff", email: "twin@victory.test" });
    expect(await verifyUser({ phone: MEMBER_PHONE }, deps())).toMatchObject({ ok: false, code: "PHONE_AMBIGUOUS" });
    expect(await createBooking(createBody(), deps())).toMatchObject({ ok: false, code: "PHONE_AMBIGUOUS" });
  });

  it("blocks inactive accounts from every booking tool", async () => {
    const body = { ...createBody(), phone: PENDING_PHONE };
    for (const tool of [checkAvailability, getSchedule, myBookings, createBooking]) {
      expect(await tool(body, deps())).toMatchObject({ ok: false, code: "ACCOUNT_PENDING" });
    }
  });
});

describe("room resolution", () => {
  const rooms = () => getDemoState().rooms.filter((r) => r.isActive);
  const name = (query: string) => {
    const result = resolveRoom(query, rooms());
    return result.ok ? result.room.name : result.code;
  };

  it("resolves names and aliases", () => {
    for (const query of ["Room A", "room a", "A", "a", "ROOM-A", "book room a please"]) expect(name(query)).toBe("Room A");
    expect(name("B")).toBe("Room B");
    expect(name("room c")).toBe("Room C");
    expect(name("D")).toBe("Room D");
    for (const query of ["Event's Place - A", "Events Place A", "Event Place A", "events place", "event place"]) expect(name(query)).toBe("Event's Place - A");
  });

  it("returns ROOM_NOT_FOUND or ROOM_AMBIGUOUS instead of guessing", () => {
    const missing = resolveRoom("Room Z", rooms());
    expect(missing).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
    expect(view<{ choices: string[] }>(missing).choices).toContain("Room A");
    expect(resolveRoom("room", rooms())).toMatchObject({ ok: false, code: "ROOM_AMBIGUOUS" });
    expect(resolveRoom("room a or room b", rooms())).toMatchObject({ ok: false, code: "ROOM_AMBIGUOUS" });
    expect(name("a room please")).not.toBe("Room A");
    expect(resolveRoom("", rooms())).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
  });
});

describe("dates and times (Asia/Manila)", () => {
  const now = new Date();
  it("keeps the requested Manila date and rejects vague or invalid input", () => {
    const window = parseBotWindow({ date: DAY, startTime: "13:00", endTime: "16:00" }, now);
    expect(window).toMatchObject({ ok: true, dateKey: DAY, durationMinutes: 180 });
    if (window.ok) {
      expect(dateKeyInZone(window.start)).toBe(DAY);
      expect(window.start.toISOString()).toBe(zonedDateTime(DAY, "13:00").toISOString());
    }
    expect(parseBotWindow({ date: "Monday", startTime: "13:00", endTime: "16:00" }, now)).toMatchObject({ code: "AMBIGUOUS_DATE", requiresClarification: true });
    expect(parseBotWindow({ date: "10/12/2026", startTime: "13:00", endTime: "16:00" }, now)).toMatchObject({ code: "AMBIGUOUS_DATE" });
    expect(parseBotWindow({ date: "2026-02-30", startTime: "13:00", endTime: "16:00" }, now)).toMatchObject({ code: "INVALID_DATE" });
    expect(parseBotWindow({ date: addDaysToKey(dateKeyInZone(now), -1), startTime: "13:00", endTime: "16:00" }, now)).toMatchObject({ code: "INVALID_DATE" });
    expect(parseBotWindow({ date: addDaysToKey(dateKeyInZone(now), 120), startTime: "13:00", endTime: "16:00" }, now)).toMatchObject({ code: "BOOKING_TOO_FAR_AHEAD" });
    expect(parseBotWindow({ date: DAY, startTime: "1 PM", endTime: "16:00" }, now)).toMatchObject({ code: "INVALID_TIME" });
    expect(parseBotWindow({ date: DAY, startTime: "13:15", endTime: "16:00" }, now)).toMatchObject({ code: "INVALID_TIME" });
    expect(parseBotWindow({ date: DAY, startTime: "06:00", endTime: "08:00" }, now)).toMatchObject({ code: "OUTSIDE_BOOKING_HOURS" });
    expect(parseBotWindow({ date: DAY, startTime: "20:00", endTime: "23:00" }, now)).toMatchObject({ code: "OUTSIDE_BOOKING_HOURS" });
    expect(parseBotWindow({ date: DAY, startTime: "16:00", endTime: "13:00" }, now)).toMatchObject({ code: "INVALID_DURATION" });
    expect(parseBotWindow({ date: DAY, startTime: "08:00", endTime: "17:00" }, now)).toMatchObject({ code: "INVALID_DURATION" });
  });
});

describe("schedule privacy", () => {
  it("shows other people's bookings only as anonymous reserved periods", async () => {
    await bookAs(otherMember, "12:00", "14:00");
    await bookAs(member, "16:00", "17:00", { eventName: "My Choir Practice" });

    const result = await getSchedule({ phone: MEMBER_PHONE, room: "Room A", date: DAY }, deps());
    expect(result).toMatchObject({ ok: true, room: "Room A", date: DAY, timezone: "Asia/Manila" });
    const reserved = view<{ reserved: Record<string, unknown>[] }>(result).reserved;
    expect(reserved).toContainEqual({ start: "12:00", end: "14:00", label: "Reserved" });
    expect(reserved.find((r) => r.start === "16:00")).toMatchObject({ label: "Your booking", yours: true, event: "My Choir Practice" });

    const text = JSON.stringify(result);
    for (const secret of ["Secret Planning", "Private purpose", "Paolo", "paolo@victory.test", OTHER_PHONE, otherMember.id]) expect(text).not.toContain(secret);
  });
});

describe("availability", () => {
  it("confirms a free window with its duration", async () => {
    const result = await checkAvailability({ phone: MEMBER_PHONE, room: "Room A", date: DAY, startTime: "13:00", endTime: "16:00" }, deps());
    expect(result).toMatchObject({ ok: true, available: true, room: "Room A", date: DAY, startTime: "13:00", endTime: "16:00", durationMinutes: 180, displayTime: "1:00 PM - 4:00 PM" });
  });

  it("reports anonymous conflicts from local bookings", async () => {
    await bookAs(otherMember, "12:00", "14:00");
    const result = await checkAvailability({ phone: MEMBER_PHONE, room: "Room A", date: DAY, startTime: "13:00", endTime: "16:00" }, deps());
    expect(result).toMatchObject({ ok: true, available: false, code: "TIME_UNAVAILABLE", conflicts: [{ start: "12:00", end: "14:00", label: "Reserved" }] });
    expect(JSON.stringify(result)).not.toContain("Secret Planning");
  });

  it("respects GHL availability and reports a GHL outage", async () => {
    const blocked = await checkAvailability({ phone: MEMBER_PHONE, room: "Room A", date: DAY, startTime: "13:00", endTime: "16:00" }, deps({ blocked: [{ from: "15:00", to: "15:30" }] }));
    expect(blocked).toMatchObject({ available: false, conflicts: [{ start: "15:00", end: "15:30", label: "Not available" }] });

    const down: CalendarGateway = { ...fakeGhl({ day: DAY }).gateway, getFreeSlotStarts: async () => Promise.reject(new GhlError("unavailable", "GHL down")) };
    expect(await checkAvailability({ phone: MEMBER_PHONE, room: "Room A", date: DAY, startTime: "13:00", endTime: "16:00" }, deps({ calendar: down }))).toMatchObject({
      ok: false,
      code: "GHL_UNAVAILABLE",
      retryable: true,
    });
  });

  it("finds only rooms that are actually free", async () => {
    await bookAs(otherMember, "15:00", "17:00");
    const result = await findAvailableRooms({ phone: MEMBER_PHONE, date: DAY, startTime: "15:00", endTime: "17:00" }, deps());
    const names = view<{ availableRooms: { name: string }[] }>(result).availableRooms.map((r) => r.name);
    expect(names).not.toContain("Room A");
    expect(names).toContain("Room B");
    expect(view<{ unavailableRooms: string[] }>(result).unavailableRooms).toEqual(["Room A"]);

    const bigGroup = await findAvailableRooms({ phone: MEMBER_PHONE, date: DAY, startTime: "08:00", endTime: "09:00", attendeeCount: 45 }, deps());
    expect(view<{ availableRooms: { name: string; capacity: number }[] }>(bigGroup).availableRooms.every((r) => r.capacity >= 45)).toBe(true);
  });
});

describe("alternative times", () => {
  const slotsWith = (busy: [string, string][], free: [string, string] | null = null) =>
    buildDaySlots({
      dateKey: DAY,
      freeRanges: free ? [{ start: zonedDateTime(DAY, free[0]).getTime(), end: zonedDateTime(DAY, free[1]).getTime() }] : null,
      busy: busy.map(([a, b]) => ({ start: zonedDateTime(DAY, a).getTime(), end: zonedDateTime(DAY, b).getTime() })),
      now: new Date(0),
      slotMinutes: 30,
      dayStartHour: 7,
      dayEndHour: 22,
    });
  const hhmm = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(11, 16);
  const asTimes = (alts: { start: number; end: number }[]) => alts.map((a) => `${hhmm(a.start)}-${hhmm(a.end)}`);

  it("offers the nearest later, then the nearest earlier slot, keeping the duration", () => {
    const alts = findAlternativeWindows(slotsWith([["12:00", "14:00"]]), zonedDateTime(DAY, "13:00").getTime(), 180);
    expect(asTimes(alts)).toEqual(["14:00-17:00", "09:00-12:00", "17:00-20:00"]);
    expect(alts.every((a) => a.preservesDuration)).toBe(true);
  });

  it("falls back to the longest shorter windows when the full length never fits", () => {
    const alts = findAlternativeWindows(slotsWith([], ["08:00", "10:00"]), zonedDateTime(DAY, "13:00").getTime(), 180);
    expect(asTimes(alts)).toEqual(["08:00-10:00"]);
    expect(alts[0].preservesDuration).toBe(false);
  });

  it("returns nothing when the day is fully booked", () => {
    expect(findAlternativeWindows(slotsWith([["07:00", "22:00"]]), zonedDateTime(DAY, "13:00").getTime(), 60)).toEqual([]);
  });

  it("the tool reports NO_ALTERNATIVES with an empty list", async () => {
    await bookAs(otherMember, "07:00", "15:00");
    await bookAs(otherMember, "15:00", "22:00");
    const result = await suggestAlternatives({ phone: MEMBER_PHONE, room: "Room A", date: DAY, startTime: "13:00", endTime: "16:00" }, deps());
    expect(result).toMatchObject({ ok: true, available: false, code: "NO_ALTERNATIVES", alternatives: [] });
  });
});

describe("WhatsApp booking requests", () => {
  it("creates a pending WhatsApp booking for the phone's owner, never for a supplied userId", async () => {
    const body = createBody({ userId: otherMember.id, status: "approved" });
    const result = await createBooking(body, deps());
    expect(result).toMatchObject({
      ok: true,
      code: "BOOKING_CREATED",
      booking: { status: "pending", room: "Room A", event: "Youth Service", date: DAY, startTime: "13:00", endTime: "16:00", displayTime: "1:00 PM - 4:00 PM", source: "whatsapp" },
    });
    const id = view<{ booking: { id: string } }>(result).booking.id;
    const stored = getDemoState().bookings.find((b) => b.id === id)!;
    expect(stored).toMatchObject({ userId: member.id, status: "pending", source: "whatsapp", whatsappMessageId: body.whatsappMessageId, eventType: "youth" });
  });

  it("never creates a second booking for a retried WhatsApp message", async () => {
    const body = createBody();
    const first = await createBooking(body, deps());
    const before = getDemoState().bookings.length;
    const retry = await createBooking(body, deps());
    expect(retry).toMatchObject({ ok: true, code: "DUPLICATE_MESSAGE", duplicate: true });
    expect(view<{ booking: { id: string } }>(retry).booking.id).toBe(view<{ booking: { id: string } }>(first).booking.id);
    expect(getDemoState().bookings.length).toBe(before);
  });

  it("re-checks availability on the server even after a successful check", async () => {
    const check = await checkAvailability({ phone: MEMBER_PHONE, room: "Room A", date: DAY, startTime: "13:00", endTime: "16:00" }, deps());
    expect(check).toMatchObject({ available: true });
    await bookAs(otherMember, "12:00", "14:00"); // someone takes it in between

    const before = getDemoState().bookings.length;
    const result = await createBooking(createBody(), deps());
    expect(result).toMatchObject({ ok: false, code: "TIME_UNAVAILABLE" });
    expect(view<{ alternatives: unknown[] }>(result).alternatives.length).toBeGreaterThan(0);
    expect(getDemoState().bookings.length).toBe(before);
  });

  it("follows the website's rules: capacity, event type and Google Calendar", async () => {
    expect(await createBooking(createBody({ attendeeCount: 500 }), deps())).toMatchObject({ ok: false, code: "ATTENDEES_EXCEED_CAPACITY" });
    expect(await createBooking(createBody({ eventType: "rave" }), deps())).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createBooking(createBody({ whatsappMessageId: undefined }), deps())).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createBooking(createBody(), deps({ google: fakeGoogle({ connected: [] }).gateway }))).toMatchObject({
      ok: false,
      code: "GOOGLE_CALENDAR_REQUIRED",
      connectUrl: "https://booking.example.test/account",
    });
  });
});

describe("ownership", () => {
  it("my bookings returns only the sender's own requests", async () => {
    const theirs = await bookAs(otherMember, "08:00", "09:00");
    await createBooking(createBody(), deps());
    const result = await myBookings({ phone: MEMBER_PHONE }, deps());
    const ids = view<{ bookings: { id: string }[] }>(result).bookings.map((b) => b.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain(theirs);
    const mine = getDemoState().bookings.filter((b) => b.userId === member.id).map((b) => b.id);
    expect(ids.every((id) => mine.includes(id))).toBe(true);
  });

  it("booking status never reveals someone else's booking", async () => {
    const theirs = await bookAs(otherMember, "08:00", "09:00");
    expect(await bookingStatus({ phone: MEMBER_PHONE, bookingId: theirs }, deps())).toMatchObject({ ok: false, code: "BOOKING_NOT_FOUND" });

    const created = await createBooking(createBody(), deps());
    const id = view<{ booking: { id: string } }>(created).booking.id;
    expect(await bookingStatus({ phone: MEMBER_PHONE, bookingId: id }, deps())).toMatchObject({ ok: true, booking: { id, status: "pending" } });
    expect(await bookingStatus({ phone: MEMBER_PHONE, room: "Room A", date: DAY }, deps())).toMatchObject({ ok: true, booking: { id } });
  });

  it("includes the denial reason for denied bookings", async () => {
    const created = await createBooking(createBody(), deps());
    const id = view<{ booking: { id: string } }>(created).booking.id;
    const denied = await denyBooking({ bookingId: id, reason: "Room A is closed that afternoon." }, admin, {
      repo: createDemoRepository(admin.id),
      calendar: fakeGhl({ day: DAY }).gateway,
      now: () => new Date(),
    });
    expect(denied.ok).toBe(true);
    expect(await bookingStatus({ phone: MEMBER_PHONE, bookingId: id }, deps())).toMatchObject({ booking: { status: "denied", denialReason: "Room A is closed that afternoon." } });
  });
});

describe("n8n status webhook", () => {
  const SECRET = "s".repeat(40);
  const url = "https://n8n.example.test/webhook/booking-status";

  function harness(fetchImpl: typeof fetch) {
    const tasks: (() => Promise<void>)[] = [];
    const records: { bookingId: string; status: string; error: string | null }[] = [];
    const notifier = createStatusNotifier({
      url,
      secret: SECRET,
      fetchImpl,
      retryDelaysMs: [],
      schedule: (task) => tasks.push(task),
      record: async (bookingId, status, error) => {
        records.push({ bookingId, status, error });
      },
    });
    return { notifier, tasks, records, flush: () => Promise.all(tasks.map((t) => t())) };
  }

  const approveWith = (id: string, notifier: ReturnType<typeof harness>["notifier"]) =>
    approveBooking({ bookingId: id }, admin, { repo: createDemoRepository(admin.id), calendar: fakeGhl({ day: DAY }).gateway, google: fakeGoogle().gateway, now: () => new Date(), notifier });

  it("fires only for WhatsApp bookings, with a valid HMAC signature", async () => {
    const calls: { headers: Headers; body: string }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const { notifier, flush, records } = harness(fetchImpl);

    const webId = await bookAs(member, "08:00", "09:00");
    expect((await approveWith(webId, notifier)).ok).toBe(true);
    const created = await createBooking(createBody(), deps());
    const waId = view<{ booking: { id: string } }>(created).booking.id;
    expect((await approveWith(waId, notifier)).ok).toBe(true);
    await flush();

    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].body);
    expect(payload).toMatchObject({ event: "booking.approved", bookingId: waId, phone: MEMBER_PHONE, room: "Room A", eventName: "Youth Service", date: DAY, startTime: "13:00", endTime: "16:00", status: "approved" });
    expect(calls[0].body).not.toContain(SECRET);
    const timestamp = calls[0].headers.get("x-victory-timestamp")!;
    const expected = createHmac("sha256", SECRET).update(`${timestamp}.${calls[0].body}`).digest("hex");
    expect(calls[0].headers.get("x-victory-signature")).toBe(`sha256=${expected}`);
    expect(records).toEqual([{ bookingId: waId, status: "approved", error: null }]);
  });

  it("a failed notification never undoes the approval or denial", async () => {
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const { notifier, flush, records } = harness(failing);
    const created = await createBooking(createBody(), deps());
    const id = view<{ booking: { id: string } }>(created).booking.id;

    const result = await approveWith(id, notifier);
    expect(result.ok).toBe(true);
    await flush();
    expect(getDemoState().bookings.find((b) => b.id === id)?.status).toBe("approved");
    expect(records).toEqual([{ bookingId: id, status: "approved", error: "n8n could not be reached" }]);

    const second = await createBooking(createBody({ startTime: "17:00", endTime: "18:00" }), deps());
    const deniedId = view<{ booking: { id: string } }>(second).booking.id;
    const denied = await denyBooking({ bookingId: deniedId, reason: "Not available that day." }, admin, {
      repo: createDemoRepository(admin.id),
      calendar: fakeGhl({ day: DAY }).gateway,
      now: () => new Date(),
      notifier,
    });
    expect(denied.ok).toBe(true);
    await flush();
    expect(getDemoState().bookings.find((b) => b.id === deniedId)?.status).toBe("denied");
  });

  it("retries 5xx responses but not 4xx, keeping the same event id", async () => {
    const booking = { id: "b1", source: "whatsapp", status: "approved", eventName: "X", startTime: zonedDateTime(DAY, "09:00").toISOString(), endTime: zonedDateTime(DAY, "10:00").toISOString(), denialReason: null, room: { name: "Room A" }, requester: { phone: MEMBER_PHONE } } as unknown as BookingDetails;
    const statuses = [503, 200];
    const ids: string[] = [];
    const flaky = (async (_url: string, init: RequestInit) => {
      ids.push(new Headers(init.headers).get("x-victory-event-id")!);
      return new Response("", { status: statuses.shift() ?? 200 });
    }) as unknown as typeof fetch;
    expect(await deliverStatusWebhook(buildStatusPayload(booking, "approved"), { url, secret: SECRET, fetchImpl: flaky, retryDelaysMs: [0, 0] })).toBeNull();
    expect(ids).toEqual(["b1.approved", "b1.approved"]);

    let calls = 0;
    const rejecting = (async () => {
      calls++;
      return new Response("", { status: 400 });
    }) as unknown as typeof fetch;
    expect(await deliverStatusWebhook(buildStatusPayload(booking, "denied"), { url, secret: SECRET, fetchImpl: rejecting, retryDelaysMs: [0, 0] })).toBe("n8n responded HTTP 400");
    expect(calls).toBe(1);
  });

  it("only admins can resend, and only for WhatsApp bookings", async () => {
    const created = await createBooking(createBody(), deps());
    const id = view<{ booking: { id: string } }>(created).booking.id;
    await approveWith(id, harness((async () => new Response("", { status: 500 })) as unknown as typeof fetch).notifier);
    const record = vi.fn(async () => undefined);
    const deliver = vi.fn(async () => null);

    expect(await retryStatusNotification({ bookingId: id }, member, { repo: createDemoRepository(member.id), deliver, record })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await retryStatusNotification({ bookingId: id }, admin, { repo: createDemoRepository(admin.id), deliver, record })).toMatchObject({ ok: true });
    expect(record).toHaveBeenCalledWith(id, "approved", null);

    const webId = await bookAs(member, "08:00", "09:00");
    expect(await retryStatusNotification({ bookingId: webId }, admin, { repo: createDemoRepository(admin.id), deliver, record })).toMatchObject({ ok: false, code: "invalid" });
  });
});
