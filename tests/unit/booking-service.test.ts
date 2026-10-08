import { beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "@/lib/data/repository";
import { createDemoRepository } from "@/lib/demo/repository";
import { addDaysToKey, dateKeyInZone, formatDate, zonedDateTime, zonedDayRange } from "@/lib/domain/time";
import { GhlError } from "@/lib/ghl/errors";
import { isPastDue, PAST_DUE_MESSAGE } from "@/lib/domain/booking-rules";
import { getRoomDayAvailability } from "@/lib/services/availability";
import {
  approveBooking,
  cancelBooking,
  createBookingRequest,
  DENIAL_NOTIFICATION_FAILED,
  denyBooking,
  retryDenialEmail,
  type BookingServiceDeps,
} from "@/lib/services/bookings";
import { retryCalendarSync } from "@/lib/services/calendar-sync";
import { admin, fakeGhl, fakeGoogle, member, otherMember, ROOM_A } from "./fakes";

const DAY = addDaysToKey(dateKeyInZone(new Date()), 10);

let repo: Repository;
let adminRepo: Repository;

function deps(overrides: Partial<BookingServiceDeps> = {}): BookingServiceDeps {
  return { repo, calendar: fakeGhl({ day: DAY }).gateway, google: fakeGoogle().gateway, now: () => new Date(), ...overrides };
}
const adminDeps = (overrides: Partial<BookingServiceDeps> = {}) => deps({ repo: adminRepo, ...overrides });

const request = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
  roomId: ROOM_A,
  date: DAY,
  startTime: from,
  endTime: to,
  eventName: "Leaders Huddle",
  eventType: "ministry_meeting",
  attendeeCount: "12",
  purpose: "Planning for next quarter.",
  ...extra,
});

async function createPending(from = "10:00", to = "12:00", actor = member) {
  const result = await createBookingRequest(request(from, to), actor, deps());
  if (!result.ok) throw new Error(result.error);
  return result.data.bookingId;
}

beforeEach(() => {
  (globalThis as { __victoryDemoState?: unknown }).__victoryDemoState = undefined;
  repo = createDemoRepository(member.id);
  adminRepo = createDemoRepository(admin.id);
});

describe("booking requests", () => {
  it("creates a valid request as pending, owned by the session user", async () => {
    const result = await createBookingRequest(request("10:00", "12:00", { userId: otherMember.id }), member, deps());
    expect(result.ok).toBe(true);
    const booking = await repo.getBookingDetails(result.ok ? result.data.bookingId : "");
    expect(booking).toMatchObject({ status: "pending", userId: member.id, startTime: zonedDateTime(DAY, "10:00").toISOString() });
  });

  it("accepts variable durations on the 30-minute grid", async () => {
    expect((await createBookingRequest(request("08:00", "09:00"), member, deps())).ok).toBe(true);
    expect((await createBookingRequest(request("09:00", "11:30"), member, deps())).ok).toBe(true);
    expect((await createBookingRequest(request("13:00", "18:00"), member, deps())).ok).toBe(true);
  });

  it("requires a session and active portal access", async () => {
    expect(await createBookingRequest(request("10:00", "12:00"), null, deps())).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await createBookingRequest(request("10:00", "12:00"), { ...member, accessStatus: "pending" }, deps())).toMatchObject({
      ok: false,
      code: "access_required",
    });
  });

  it("requires a connected Google Calendar before the first booking", async () => {
    const google = fakeGoogle({ connected: [] });
    expect(await createBookingRequest(request("10:00", "11:00"), member, deps({ google: google.gateway }))).toMatchObject({
      ok: false,
      code: "calendar_required",
      error: "Connect Google Calendar to continue.",
    });
    google.connected.add(member.id);
    expect((await createBookingRequest(request("10:00", "11:00"), member, deps({ google: google.gateway }))).ok).toBe(true);
  });

  it("does not require Google when sync is disabled (local development)", async () => {
    const google = fakeGoogle({ connected: [], required: false });
    expect((await createBookingRequest(request("10:00", "11:00"), member, deps({ google: google.gateway }))).ok).toBe(true);
  });

  it("rejects an invalid time range and invalid fields", async () => {
    expect(await createBookingRequest(request("12:00", "10:00"), member, deps())).toMatchObject({ ok: false, code: "invalid" });
    const result = await createBookingRequest(request("10:00", "11:00", { eventName: "", attendeeCount: "0" }), member, deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(["eventName", "attendeeCount"]));
  });

  it("rejects attendee counts above room capacity", async () => {
    const result = await createBookingRequest(request("10:00", "11:00", { attendeeCount: "41" }), member, deps());
    expect(result).toMatchObject({ ok: false, fieldErrors: { attendeeCount: expect.stringContaining("40") } });
  });

  it("blocks overlapping requests and allows only one of two simultaneous ones", async () => {
    await createPending("10:00", "12:00");
    expect(await createBookingRequest(request("11:00", "13:00"), otherMember, deps())).toMatchObject({ ok: false, code: "conflict" });
    expect((await createBookingRequest(request("12:00", "13:00"), otherMember, deps())).ok).toBe(true);
    const results = await Promise.all([
      createBookingRequest(request("14:00", "15:00"), member, deps()),
      createBookingRequest(request("14:00", "15:00"), otherMember, deps()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("rejects times GHL does not show as free, and fails gracefully when GHL is down", async () => {
    const blocked = fakeGhl({ day: DAY, blocked: [{ from: "15:00", to: "16:00" }] });
    expect(await createBookingRequest(request("14:30", "15:30"), member, deps({ calendar: blocked.gateway }))).toMatchObject({ ok: false, code: "conflict" });
    const down = fakeGhl({ day: DAY });
    down.gateway.getFreeSlotStarts = async () => {
      throw new GhlError("unavailable", "down");
    };
    expect(await createBookingRequest(request("10:00", "11:00"), member, deps({ calendar: down.gateway }))).toMatchObject({ ok: false, code: "calendar_error" });
  });

  it("treats each free start as covering the calendar's slot duration", async () => {
    // 60-minute slots: a free start at 16:00 makes 16:30–17:00 bookable even though 16:30 itself can't start an hour.
    const ghl = fakeGhl({ day: DAY, slotDurationMinutes: 60, blocked: [{ from: "16:30", to: "23:59" }] });
    expect((await createBookingRequest(request("16:30", "17:00"), member, deps({ calendar: ghl.gateway }))).ok).toBe(true);
  });

  it("caps how many pending requests a member can have", async () => {
    const times = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00"];
    for (let i = 0; i < times.length - 1; i++) {
      expect((await createBookingRequest(request(times[i], times[i + 1]), member, deps())).ok).toBe(true);
    }
    expect(await createBookingRequest(request("14:00", "14:30"), member, deps())).toMatchObject({
      ok: false,
      error: expect.stringContaining("maximum number of requests"),
    });
  });
});

describe("approval", () => {
  it("does not let a normal member approve", async () => {
    const id = await createPending();
    const ghl = fakeGhl({ day: DAY });
    expect(await approveBooking({ bookingId: id }, member, deps({ calendar: ghl.gateway }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(ghl.log.appointments).toHaveLength(0);
    expect((await repo.getBookingDetails(id))?.status).toBe("pending");
  });

  it("sends the calendar's assigned team member with a confirmed appointment, then marks approved", async () => {
    const id = await createPending("10:00", "12:30");
    const ghl = fakeGhl({ day: DAY, assignedUserId: "staff-room-a" });
    const result = await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway }));

    expect(result).toMatchObject({ ok: true });
    expect(ghl.log.updates[0]).toMatchObject({
      contactId: "contact-1",
      fields: {
        room: "Room A",
        event: "Leaders Huddle",
        date: formatDate(zonedDateTime(DAY, "10:00"), "EEEE, MMMM d, yyyy"),
        time: "10:00 AM – 12:30 PM",
        denialReason: "",
      },
    });
    expect(ghl.log.appointments).toEqual([
      expect.objectContaining({ id: "appt-1", contactId: "contact-1", calendarId: "demo-calendar-room-a", assignedUserId: "staff-room-a" }),
    ]);
    expect(await adminRepo.getBookingDetails(id)).toMatchObject({ status: "approved", ghlAppointmentId: "appt-1", reviewedBy: admin.id, reviewLockedAt: null });
  });

  it("keeps the booking pending when the calendar has no team member", async () => {
    const id = await createPending();
    const ghl = fakeGhl({ day: DAY, assignedUserId: null });
    const result = await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway }));
    expect(result).toMatchObject({ ok: false, code: "calendar_error", error: expect.stringContaining("no team member assigned") });
    expect(ghl.log.appointments).toHaveLength(0);
    expect(ghl.log.updates).toHaveLength(0);
    expect(await adminRepo.getBookingDetails(id)).toMatchObject({ status: "pending", reviewLockedAt: null });
  });

  it("caches the GHL contact id and reuses it on the next approval", async () => {
    const first = await createPending("08:00", "09:00");
    const second = await createPending("09:00", "10:00");
    const ghl = fakeGhl({ day: DAY });
    await approveBooking({ bookingId: first }, admin, adminDeps({ calendar: ghl.gateway }));
    await approveBooking({ bookingId: second }, admin, adminDeps({ calendar: ghl.gateway }));
    expect(ghl.log.searches).toBe(1);
    expect((await adminRepo.getProfile(member.id))?.ghlContactId).toBe("contact-1");
  });

  it("falls back to find-or-create when the cached contact no longer exists", async () => {
    await adminRepo.saveGhlContactId(member.id, "deleted-contact");
    const id = await createPending();
    const ghl = fakeGhl({ day: DAY });
    expect((await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway }))).ok).toBe(true);
    expect(ghl.log.searches).toBe(1);
    expect((await adminRepo.getProfile(member.id))?.ghlContactId).toBe("contact-1");
  });

  it("keeps the booking pending when GHL appointment creation fails, and allows a retry", async () => {
    const id = await createPending();
    const result = await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: fakeGhl({ day: DAY, failCreate: true }).gateway }));
    expect(result).toMatchObject({ ok: false, code: "calendar_error", error: expect.stringContaining("still pending") });
    expect(await adminRepo.getBookingDetails(id)).toMatchObject({ status: "pending", ghlAppointmentId: null, reviewedBy: null, reviewLockedAt: null });
    expect((await approveBooking({ bookingId: id }, admin, adminDeps())).ok).toBe(true);
  });

  it("keeps the booking pending when the contact can't be updated or GHL shows the time as taken", async () => {
    const id = await createPending("10:00", "12:00");
    for (const options of [{ failContactUpdate: true }, { blocked: [{ from: "11:00", to: "11:30" }] }]) {
      const ghl = fakeGhl({ day: DAY, ...options });
      expect((await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway }))).ok).toBe(false);
      expect(ghl.log.appointments).toHaveLength(0);
      expect((await adminRepo.getBookingDetails(id))?.status).toBe("pending");
    }
  });

  it("processes a double click only once", async () => {
    const id = await createPending();
    const ghl = fakeGhl({ day: DAY });
    const google = fakeGoogle();
    const shared = adminDeps({ calendar: ghl.gateway, google: google.gateway });
    const results = await Promise.all([approveBooking({ bookingId: id }, admin, shared), approveBooking({ bookingId: id }, admin, shared)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(ghl.log.appointments).toHaveLength(1);
    expect(google.events.size).toBe(1);
    expect(await approveBooking({ bookingId: id }, admin, shared)).toMatchObject({ ok: false, code: "already_reviewed" });
  });

  it("rolls back GHL if saving fails, but never when the save actually succeeded", async () => {
    const id = await createPending();
    const ghl = fakeGhl({ day: DAY });
    expect((await approveBooking({ bookingId: id }, admin, adminDeps({ repo: { ...adminRepo, markApproved: async () => null }, calendar: ghl.gateway }))).ok).toBe(false);
    expect(ghl.log.deleted).toEqual(["appt-1"]);

    const flaky: Repository = {
      ...adminRepo,
      markApproved: async (...args) => {
        await adminRepo.markApproved(...args);
        throw new Error("connection reset");
      },
    };
    const ghl2 = fakeGhl({ day: DAY });
    expect((await approveBooking({ bookingId: id }, admin, adminDeps({ repo: flaky, calendar: ghl2.gateway }))).ok).toBe(true);
    expect(ghl2.log.deleted).toEqual([]);
  });

  it("warns the admin when GHL may have created the appointment without confirming", async () => {
    const id = await createPending();
    const ghl = fakeGhl({ day: DAY, failCreate: new GhlError("unavailable", "timed out", undefined, true) });
    expect(await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("may still have been created"),
    });
  });
});

describe("Google Calendar sync", () => {
  it("adds the approved booking to the member's Google Calendar and stores the event id", async () => {
    const id = await createPending("10:00", "12:00");
    const google = fakeGoogle();
    const result = await approveBooking({ bookingId: id }, admin, adminDeps({ google: google.gateway }));
    expect(result).toMatchObject({ ok: true, data: { calendarSync: "synced" } });
    const event = [...google.events.values()][0];
    expect(event).toMatchObject({ userId: member.id, summary: "Leaders Huddle", location: "Room A, 2nd floor, east wing" });
    expect(event.description).toContain("Victory Church Room Booking");
    expect(event.description).toContain("Room: Room A");
    expect((await adminRepo.getBookingDetails(id))?.googleCalendarEventId).toBe(`vrb${id.replace(/-/g, "")}`);
  });

  it("keeps the approval when Google fails, then retry syncs without duplicating", async () => {
    const id = await createPending();
    const google = fakeGoogle({ fail: true });
    const result = await approveBooking({ bookingId: id }, admin, adminDeps({ google: google.gateway }));
    expect(result).toMatchObject({ ok: true, data: { calendarSync: "failed" }, message: "Booking approved, but Google Calendar sync failed." });
    expect(await adminRepo.getBookingDetails(id)).toMatchObject({ status: "approved", googleCalendarEventId: null, googleCalendarSyncError: expect.any(String) });

    google.setFail(false);
    expect(await retryCalendarSync({ bookingId: id }, member, { repo, google: google.gateway })).toMatchObject({ ok: true });
    expect(await retryCalendarSync({ bookingId: id }, admin, { repo: adminRepo, google: google.gateway })).toMatchObject({
      ok: true,
      data: { outcome: "already_synced" },
    });
    expect(google.events.size).toBe(1);
    expect(google.createCalls()).toBe(2); // one failed attempt + one success; the second retry made no call
  });

  it("does not let another member retry someone else's sync", async () => {
    const id = await createPending();
    await approveBooking({ bookingId: id }, admin, adminDeps({ google: fakeGoogle({ fail: true }).gateway }));
    expect(await retryCalendarSync({ bookingId: id }, otherMember, { repo: createDemoRepository(otherMember.id), google: fakeGoogle().gateway })).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("cancelling an approved booking cancels the GHL appointment and removes only the stored event", async () => {
    const keep = await createPending("08:00", "09:00");
    const id = await createPending("10:00", "11:00");
    const ghl = fakeGhl({ day: DAY });
    const google = fakeGoogle();
    await approveBooking({ bookingId: keep }, admin, adminDeps({ calendar: ghl.gateway, google: google.gateway }));
    await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway, google: google.gateway }));
    const eventId = (await adminRepo.getBookingDetails(id))!.googleCalendarEventId!;

    const result = await cancelBooking({ bookingId: id }, member, deps({ calendar: ghl.gateway, google: google.gateway }));
    expect(result).toMatchObject({ ok: true, data: { calendarCleanupFailed: false } });
    expect(ghl.log.cancelled).toEqual(["appt-2"]);
    expect(google.deleted).toEqual([eventId]);
    expect(google.events.size).toBe(1);
    expect((await adminRepo.getBookingDetails(id))?.status).toBe("cancelled");
    expect((await adminRepo.getBookingDetails(keep))?.status).toBe("approved");
  });

  it("does not cancel locally when GHL can't cancel the appointment", async () => {
    const id = await createPending();
    await approveBooking({ bookingId: id }, admin, adminDeps());
    const ghl = fakeGhl({ day: DAY });
    ghl.gateway.cancelAppointment = async () => {
      throw new GhlError("unavailable", "down");
    };
    expect((await cancelBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway }))).ok).toBe(false);
    expect((await adminRepo.getBookingDetails(id))?.status).toBe("approved");
  });

  it("lets a member cancel their own pending request but not someone else's", async () => {
    const id = await createPending();
    expect(await cancelBooking({ bookingId: id }, otherMember, deps({ repo: createDemoRepository(otherMember.id) }))).toMatchObject({ ok: false, code: "not_found" });
    expect(await cancelBooking({ bookingId: id }, member, deps())).toMatchObject({ ok: true });
  });
});

describe("denial", () => {
  it("requires a reason and an admin", async () => {
    const id = await createPending();
    const ghl = fakeGhl({ day: DAY });
    expect(await denyBooking({ bookingId: id, reason: "   " }, admin, adminDeps({ calendar: ghl.gateway }))).toMatchObject({
      ok: false,
      fieldErrors: { reason: expect.any(String) },
    });
    expect(await denyBooking({ bookingId: id, reason: "Not available" }, member, deps())).toMatchObject({ ok: false, code: "forbidden" });
    expect(ghl.log.tags).toHaveLength(0);
  });

  it("updates the contact fields with the reason, adds the denial tag, then marks denied", async () => {
    const id = await createPending("10:00", "12:00");
    const ghl = fakeGhl({ day: DAY });
    expect(await denyBooking({ bookingId: id, reason: "Room is being repainted." }, admin, adminDeps({ calendar: ghl.gateway }))).toMatchObject({
      ok: true,
      data: { notificationFailed: false },
    });
    expect(ghl.log.updates[0].fields).toMatchObject({ room: "Room A", denialReason: "Room is being repainted." });
    expect(ghl.log.tags).toEqual([{ contactId: "contact-1", tag: "room-booking-denied" }]);
    expect(await adminRepo.getBookingDetails(id)).toMatchObject({ status: "denied", denialReason: "Room is being repainted.", reviewedBy: admin.id });
    const { start, end } = zonedDayRange(DAY);
    expect(await repo.getBusyRanges(ROOM_A, start, end)).toEqual([]);
  });

  it("denies locally even when GHL fails: reason kept, slot released, failure recorded", async () => {
    const { start, end } = zonedDayRange(DAY);
    // Tag refused, contact fields refused, and GHL completely unavailable.
    for (const options of [{ failTag: true }, { failContactUpdate: true }, { contactsDown: true }]) {
      const id = await createPending();
      const result = await denyBooking({ bookingId: id, reason: "Closed that day." }, admin, adminDeps({ calendar: fakeGhl({ day: DAY, ...options }).gateway }));
      expect(result).toMatchObject({ ok: true, data: { notificationFailed: true }, message: DENIAL_NOTIFICATION_FAILED });
      expect(await adminRepo.getBookingDetails(id)).toMatchObject({
        status: "denied",
        denialReason: "Closed that day.",
        reviewedBy: admin.id,
        reviewLockedAt: null,
        ghlNotificationError: expect.any(String),
      });
      expect(await repo.getBusyRanges(ROOM_A, start, end)).toEqual([]);
    }
  });

  it("lets an admin retry a failed denial email", async () => {
    const id = await createPending();
    await denyBooking({ bookingId: id, reason: "Closed that day." }, admin, adminDeps({ calendar: fakeGhl({ day: DAY, contactsDown: true }).gateway }));

    const ghl = fakeGhl({ day: DAY });
    expect(await retryDenialEmail({ bookingId: id }, member, deps({ calendar: ghl.gateway }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await retryDenialEmail({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway }))).toMatchObject({ ok: true });
    expect(ghl.log.updates[0].fields).toMatchObject({ denialReason: "Closed that day." });
    expect(ghl.log.tags).toEqual([{ contactId: "contact-1", tag: "room-booking-denied" }]);
    expect((await adminRepo.getBookingDetails(id))?.ghlNotificationError).toBeNull();
  });

  it("only re-sends the email for denied bookings", async () => {
    const id = await createPending();
    expect(await retryDenialEmail({ bookingId: id }, admin, adminDeps())).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("past-due requests", () => {
  const start = () => zonedDateTime(DAY, "10:00");

  it("are past due from the exact start time (Asia/Manila)", () => {
    const booking = { status: "pending" as const, startTime: start().toISOString() };
    expect(isPastDue(booking, new Date(start().getTime() - 1))).toBe(false);
    expect(isPastDue(booking, start())).toBe(true);
    expect(isPastDue({ ...booking, status: "approved" }, new Date(start().getTime() + 3_600_000))).toBe(false);
  });

  it("can be approved until the start time, never at it", async () => {
    const id = await createPending("10:00", "12:00");
    const ghl = fakeGhl({ day: DAY });
    expect(await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway, now: start }))).toMatchObject({
      ok: false,
      code: "invalid",
      error: PAST_DUE_MESSAGE,
    });
    expect(ghl.log.appointments).toHaveLength(0);
    expect(await adminRepo.getBookingDetails(id)).toMatchObject({ status: "pending", reviewLockedAt: null });

    const justBefore = () => new Date(start().getTime() - 1);
    expect(await approveBooking({ bookingId: id }, admin, adminDeps({ calendar: ghl.gateway, now: justBefore }))).toMatchObject({ ok: true });
  });

  it("stay pending (never auto-denied) until an admin closes them", async () => {
    const id = await createPending("10:00", "12:00");
    const later = () => zonedDateTime(DAY, "13:00");
    expect((await approveBooking({ bookingId: id }, admin, adminDeps({ now: later }))).ok).toBe(false);
    expect((await adminRepo.getBookingDetails(id))?.status).toBe("pending");
    expect(await denyBooking({ bookingId: id, reason: "The start time passed before review." }, admin, adminDeps({ now: later }))).toMatchObject({ ok: true });
    expect((await adminRepo.getBookingDetails(id))?.status).toBe("denied");
  });

  it("are refused by the repository too, if the service check is ever bypassed", async () => {
    const id = await createPending("10:00", "12:00");
    const later = zonedDateTime(DAY, "13:00");
    await adminRepo.claimBookingForReview(id, admin.id, later, new Date(later.getTime() - 120_000));
    await expect(adminRepo.markApproved(id, admin.id, "appt-x", later)).rejects.toMatchObject({ code: "invalid", message: PAST_DUE_MESSAGE });
  });

  it("don't block later times", async () => {
    await createPending("10:00", "12:00");
    const room = (await repo.getRoomById(ROOM_A))!;
    const calendar = fakeGhl({ day: DAY }).gateway;
    const { slots } = await getRoomDayAvailability(room, DAY, { repo, calendar, now: () => zonedDateTime(DAY, "13:00") });
    expect(slots.filter((s) => new Date(s.start) < zonedDateTime(DAY, "13:00")).every((s) => s.status === "past")).toBe(true);
    expect(slots.filter((s) => new Date(s.start) >= zonedDateTime(DAY, "13:00")).every((s) => s.status !== "reserved")).toBe(true);
  });
});
