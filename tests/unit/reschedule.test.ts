import { beforeEach, describe, expect, it } from "vitest";
import { getSchedule } from "@/lib/bot/tools";
import type { Repository } from "@/lib/data/repository";
import type { BookingDetails } from "@/lib/data/types";
import { createDemoRepository } from "@/lib/demo/repository";
import { getDemoState } from "@/lib/demo/store";
import { addDaysToKey, dateKeyInZone, formatDate, formatTime, zonedDateTime } from "@/lib/domain/time";
import { REVIEW_ALERT_TAGS, RESCHEDULE_TAGS } from "@/lib/ghl/gateway";
import { getRoomDayAvailability } from "@/lib/services/availability";
import { approveBooking, bookingFieldValues, cancelBooking, createBookingRequest, denyBooking, type BookingServiceDeps } from "@/lib/services/bookings";
import { retryCalendarSync } from "@/lib/services/calendar-sync";
import { approveReschedule, denyReschedule, requestReschedule, withdrawReschedule } from "@/lib/services/reschedules";
import { createReviewAlerts } from "@/lib/services/review-alerts";
import { admin, fakeGhl, fakeGoogle, member, otherMember, ROOM_A } from "./fakes";

const DAY = addDaysToKey(dateKeyInZone(new Date()), 10);
const NEW_DAY = addDaysToKey(DAY, 1);
const at = (day: string, time: string) => zonedDateTime(day, time).toISOString();

let ghl: ReturnType<typeof fakeGhl>;
let google: ReturnType<typeof fakeGoogle>;
let memberRepo: Repository;
let adminRepo: Repository;

const deps = (repo: Repository, overrides: Partial<BookingServiceDeps> = {}): BookingServiceDeps => ({
  repo,
  calendar: ghl.gateway,
  google: google.gateway,
  now: () => new Date(),
  ...overrides,
});

const bookingInput = (from: string, to: string, day = DAY) => ({
  roomId: ROOM_A,
  date: day,
  startTime: from,
  endTime: to,
  eventName: "Leaders Huddle",
  eventType: "ministry_meeting",
  attendeeCount: 10,
  purpose: "Planning.",
});

/** An approved booking with a GHL appointment and a Google event, through the real services. */
async function approvedBooking(actor = member, from = "10:00", to = "12:00") {
  const repo = createDemoRepository(actor.id);
  const created = await createBookingRequest(bookingInput(from, to), actor, deps(repo));
  if (!created.ok) throw new Error(created.error);
  const approved = await approveBooking({ bookingId: created.data.bookingId }, admin, deps(adminRepo));
  if (!approved.ok) throw new Error(approved.error);
  return (await adminRepo.getBookingDetails(created.data.bookingId))!;
}

const reschedule = (bookingId: string, from = "14:00", to = "16:00", day = NEW_DAY, actor = member, repo = memberRepo) =>
  requestReschedule({ bookingId, date: day, startTime: from, endTime: to }, actor, deps(repo));

async function pendingRequest(from = "14:00", to = "16:00", day = NEW_DAY) {
  const booking = await approvedBooking();
  const result = await reschedule(booking.id, from, to, day);
  if (!result.ok) throw new Error(result.error);
  return { booking, requestId: result.data.requestId };
}

beforeEach(() => {
  (globalThis as { __victoryDemoState?: unknown }).__victoryDemoState = undefined;
  ghl = fakeGhl({ day: DAY });
  google = fakeGoogle();
  memberRepo = createDemoRepository(member.id);
  adminRepo = createDemoRepository(admin.id);
});

describe("reschedule eligibility", () => {
  it("lets the owner request a new time for a future approved booking, without touching it", async () => {
    const booking = await approvedBooking();
    const result = await reschedule(booking.id);
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("current booking remains confirmed") });
    const after = (await adminRepo.getBookingDetails(booking.id))!;
    expect(after).toMatchObject({ status: "approved", startTime: booking.startTime, endTime: booking.endTime, ghlAppointmentId: booking.ghlAppointmentId });
    const [request] = await memberRepo.listRescheduleRequestsForBooking(booking.id);
    expect(request).toMatchObject({ status: "pending", requestedBy: member.id, originalStart: booking.startTime, requestedStart: at(NEW_DAY, "14:00") });
    expect(ghl.log.moves).toHaveLength(0);
    expect(google.updateCalls()).toBe(0);
  });

  it("rejects pending, denied, cancelled and past bookings", async () => {
    const pending = await createBookingRequest(bookingInput("08:00", "09:00"), member, deps(memberRepo));
    const pendingId = pending.ok ? pending.data.bookingId : "";
    expect(await reschedule(pendingId)).toMatchObject({ ok: false, code: "invalid" });

    const toDeny = await createBookingRequest(bookingInput("13:00", "14:00"), member, deps(memberRepo));
    const deniedId = toDeny.ok ? toDeny.data.bookingId : "";
    await denyBooking({ bookingId: deniedId, reason: "Not that day." }, admin, deps(adminRepo));
    expect(await reschedule(deniedId)).toMatchObject({ ok: false, code: "invalid" });

    const approved = await approvedBooking();
    await cancelBooking({ bookingId: approved.id }, member, deps(memberRepo));
    expect(await reschedule(approved.id)).toMatchObject({ ok: false, code: "invalid" });

    const past = await approvedBooking(member, "17:00", "18:00");
    const stored = getDemoState().bookings.find((b) => b.id === past.id)!;
    stored.startTime = new Date(Date.now() - 3_600_000).toISOString();
    stored.endTime = new Date(Date.now() - 1_800_000).toISOString();
    expect(await reschedule(past.id)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("never lets another member reschedule someone else's booking", async () => {
    const booking = await approvedBooking();
    expect(await reschedule(booking.id, "14:00", "16:00", NEW_DAY, otherMember, createDemoRepository(otherMember.id))).toMatchObject({ ok: false, code: "not_found" });
  });

  it("allows only one pending request per booking, even when submitted twice at once", async () => {
    const booking = await approvedBooking();
    const [a, b] = await Promise.all([reschedule(booking.id, "14:00", "16:00"), reschedule(booking.id, "17:00", "19:00")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await reschedule(booking.id, "08:00", "09:00")).toMatchObject({ ok: false, code: "duplicate" });
  });

  it("keeps Asia/Manila dates through to GHL", async () => {
    const { booking, requestId } = await pendingRequest("14:00", "16:00", NEW_DAY);
    const request = (await adminRepo.getRescheduleRequest(requestId))!;
    expect(dateKeyInZone(request.requestedStart)).toBe(NEW_DAY);
    await approveReschedule({ requestId }, admin, deps(adminRepo));
    expect(ghl.log.moves[0]).toMatchObject({ appointmentId: booking.ghlAppointmentId });
    expect(ghl.log.moves[0].start.toISOString()).toBe(at(NEW_DAY, "14:00"));
    expect(ghl.log.moves[0].end.toISOString()).toBe(at(NEW_DAY, "16:00"));
  });
});

describe("held slots in availability", () => {
  const otherRepo = () => createDemoRepository(otherMember.id);
  const slotStatus = async (day: string, time: string) => {
    const room = (await otherRepo().getRoomById(ROOM_A))!;
    const availability = await getRoomDayAvailability(room, day, { repo: otherRepo(), calendar: fakeGhl({ day }).gateway, now: () => new Date() });
    return availability.slots.find((s) => s.start === at(day, time))?.status;
  };

  it("blocks the requested slot and keeps the original slot blocked while pending", async () => {
    await pendingRequest("14:00", "16:00", NEW_DAY);
    expect(await slotStatus(NEW_DAY, "14:00")).toBe("reserved");
    expect(await slotStatus(DAY, "10:00")).toBe("reserved");
    expect(await createBookingRequest(bookingInput("14:30", "15:30", NEW_DAY), otherMember, deps(otherRepo()))).toMatchObject({ ok: false, code: "conflict" });
    expect(await createBookingRequest(bookingInput("10:00", "11:00", DAY), otherMember, deps(otherRepo()))).toMatchObject({ ok: false, code: "conflict" });
  });

  it("shows a pending reschedule to others only as an anonymous Reserved period", async () => {
    await pendingRequest("14:00", "16:00", NEW_DAY);
    const schedule = await getSchedule(
      { phone: "+639170000003", room: "Room A", date: NEW_DAY },
      {
        findProfilesByPhone: async () => [{ id: otherMember.id, fullName: otherMember.fullName, email: otherMember.email, phone: "+639170000003", role: "user", accessStatus: "active", accessReason: null }],
        repoFor: (id) => createDemoRepository(id),
        calendar: fakeGhl({ day: NEW_DAY }).gateway,
        google: google.gateway,
        now: () => new Date(),
        siteUrl: "https://example.test",
      },
    );
    expect((schedule as unknown as { reserved: unknown[] }).reserved).toEqual([{ start: "14:00", end: "16:00", label: "Reserved" }]);
    expect(JSON.stringify(schedule)).not.toContain("Leaders Huddle");
  });

  it("releases the requested slot on denial, and the original slot on approval", async () => {
    const first = await pendingRequest("14:00", "16:00", NEW_DAY);
    await denyReschedule({ requestId: first.requestId, reason: "Room is set up for another event." }, admin, deps(adminRepo));
    expect(await slotStatus(NEW_DAY, "14:00")).toBe("available");

    const second = await reschedule(first.booking.id, "17:00", "19:00", NEW_DAY);
    if (!second.ok) throw new Error(second.error);
    expect((await approveReschedule({ requestId: second.data.requestId }, admin, deps(adminRepo))).ok).toBe(true);
    expect(await slotStatus(DAY, "10:00")).toBe("available");
    expect(await slotStatus(NEW_DAY, "17:00")).toBe("reserved");
  });

  it("lets only one of two overlapping requests hold a slot", async () => {
    const mine = await approvedBooking(member, "08:00", "09:00");
    const theirs = await approvedBooking(otherMember, "10:00", "11:00");
    const [a, b] = await Promise.all([
      reschedule(mine.id, "14:00", "16:00"),
      reschedule(theirs.id, "15:00", "17:00", NEW_DAY, otherMember, createDemoRepository(otherMember.id)),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe("denying a reschedule", () => {
  it("keeps the original booking, GHL appointment and Google event, and stores the reason", async () => {
    const { booking, requestId } = await pendingRequest();
    const eventsBefore = new Map(google.events);
    const result = await denyReschedule({ requestId, reason: "Room A is booked for a seminar." }, admin, deps(adminRepo));
    expect(result.ok).toBe(true);

    expect((await adminRepo.getBookingDetails(booking.id))!).toMatchObject({ status: "approved", startTime: booking.startTime, endTime: booking.endTime });
    expect(ghl.log.moves).toHaveLength(0);
    expect(ghl.log.cancelled).toHaveLength(0);
    expect(google.events).toEqual(eventsBefore);
    expect(google.updateCalls()).toBe(0);
    expect((await adminRepo.getRescheduleRequest(requestId))!).toMatchObject({ status: "denied", denialReason: "Room A is booked for a seminar.", reviewedBy: admin.id });
  });

  it("requires a reason", async () => {
    const { requestId } = await pendingRequest();
    expect(await denyReschedule({ requestId, reason: "" }, admin, deps(adminRepo))).toMatchObject({ ok: false, code: "invalid" });
  });

  it("writes the requested details and reason, then the denied tag", async () => {
    const { requestId } = await pendingRequest();
    await denyReschedule({ requestId, reason: "Room A is booked for a seminar." }, admin, deps(adminRepo));
    const fields = ghl.log.updates.at(-1)!.fields!;
    expect(fields).toMatchObject({ room: "Room A", event: "Leaders Huddle", date: formatDate(at(NEW_DAY, "14:00"), "EEEE, MMMM d, yyyy"), denialReason: "Room A is booked for a seminar." });
    expect(fields.time).toBe(`${formatTime(at(NEW_DAY, "14:00"))} – ${formatTime(at(NEW_DAY, "16:00"))}`);
    expect(ghl.log.tags.at(-1)!.tag).toBe(RESCHEDULE_TAGS.denied);
  });
});

describe("approving a reschedule", () => {
  it("moves the same GHL appointment, updates the same booking and the same Google event", async () => {
    const { booking, requestId } = await pendingRequest();
    const appointments = ghl.log.appointments.length;
    const creates = google.createCalls();
    const result = await approveReschedule({ requestId }, admin, deps(adminRepo));
    expect(result).toMatchObject({ ok: true, data: { calendarSync: "synced", notificationFailed: false } });

    expect(ghl.log.appointments).toHaveLength(appointments); // no new appointment
    expect(ghl.log.moves).toEqual([expect.objectContaining({ appointmentId: booking.ghlAppointmentId, title: "Leaders Huddle" })]);
    const after = (await adminRepo.getBookingDetails(booking.id))!;
    expect(after).toMatchObject({ id: booking.id, status: "approved", startTime: at(NEW_DAY, "14:00"), endTime: at(NEW_DAY, "16:00"), googleCalendarEventId: booking.googleCalendarEventId, googleCalendarSyncError: null });
    expect((await adminRepo.getRescheduleRequest(requestId))!).toMatchObject({ status: "approved", reviewedBy: admin.id });
    expect(google.updateCalls()).toBe(1);
    expect(google.createCalls()).toBe(creates);
    expect(google.events.get(booking.googleCalendarEventId!)!.start.toISOString()).toBe(at(NEW_DAY, "14:00"));
  });

  it("writes the NEW schedule to the contact before adding the approved tag", async () => {
    const { requestId } = await pendingRequest();
    const sequence: string[] = [];
    const calendar = {
      ...ghl.gateway,
      updateContact: async (...args: Parameters<typeof ghl.gateway.updateContact>) => {
        sequence.push(`fields:${args[1].fields?.date ?? ""}|${args[1].fields?.time ?? ""}`);
        return ghl.gateway.updateContact(...args);
      },
      addTriggerTag: async (...args: Parameters<typeof ghl.gateway.addTriggerTag>) => {
        sequence.push(`tag:${args[1]}`);
        return ghl.gateway.addTriggerTag(...args);
      },
    };
    await approveReschedule({ requestId }, admin, deps(adminRepo, { calendar }));
    const expectedFields = bookingFieldValues({ startTime: at(NEW_DAY, "14:00"), endTime: at(NEW_DAY, "16:00"), room: { name: "Room A" }, eventName: "Leaders Huddle" } as BookingDetails);
    expect(sequence.slice(-2)).toEqual([`fields:${expectedFields.date}|${expectedFields.time}`, `tag:${RESCHEDULE_TAGS.approved}`]);
  });

  it("re-checks the requested time on the server before changing anything", async () => {
    const { booking, requestId } = await pendingRequest("14:00", "16:00", NEW_DAY);
    const blocked = fakeGhl({ day: NEW_DAY, blocked: [{ from: "15:00", to: "15:30" }] });
    const result = await approveReschedule({ requestId }, admin, deps(adminRepo, { calendar: blocked.gateway }));
    expect(result).toMatchObject({ ok: false, code: "conflict" });
    expect(blocked.log.moves).toHaveLength(0);
    expect((await adminRepo.getBookingDetails(booking.id))!.startTime).toBe(booking.startTime);
    expect((await adminRepo.getRescheduleRequest(requestId))!.status).toBe("pending");
  });

  it("is admin-only", async () => {
    const { requestId } = await pendingRequest();
    expect(await approveReschedule({ requestId }, member, deps(memberRepo))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await denyReschedule({ requestId, reason: "nope nope" }, member, deps(memberRepo))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("only the requester can withdraw a pending request", async () => {
    const { requestId } = await pendingRequest();
    expect(await withdrawReschedule({ requestId }, otherMember, { repo: createDemoRepository(otherMember.id) })).toMatchObject({ ok: false });
    expect(await withdrawReschedule({ requestId }, member, { repo: memberRepo })).toMatchObject({ ok: true });
    expect((await adminRepo.getRescheduleRequest(requestId))!.status).toBe("cancelled");
  });
});

describe("reschedule failures", () => {
  it("a GHL failure changes nothing and leaves the request pending for a retry", async () => {
    const { booking, requestId } = await pendingRequest();
    const down = fakeGhl({ day: NEW_DAY, failMove: true });
    const result = await approveReschedule({ requestId }, admin, deps(adminRepo, { calendar: down.gateway }));
    expect(result).toMatchObject({ ok: false, code: "calendar_error", error: expect.stringContaining("still pending") });
    expect((await adminRepo.getBookingDetails(booking.id))!).toMatchObject({ startTime: booking.startTime, endTime: booking.endTime });
    expect((await adminRepo.getRescheduleRequest(requestId))!).toMatchObject({ status: "pending", reviewLockedBy: null });
    expect(google.updateCalls()).toBe(0);

    expect((await approveReschedule({ requestId }, admin, deps(adminRepo))).ok).toBe(true);
  });

  it("moves the GHL appointment back if saving the reschedule fails", async () => {
    const { booking, requestId } = await pendingRequest();
    const failingRepo: Repository = { ...adminRepo, applyReschedule: async () => Promise.reject(new Error("db down")) };
    const result = await approveReschedule({ requestId }, admin, deps(failingRepo));
    expect(result.ok).toBe(false);
    expect(ghl.log.moves).toHaveLength(2);
    expect(ghl.log.moves[1].start.toISOString()).toBe(booking.startTime);
    expect((await adminRepo.getRescheduleRequest(requestId))!.status).toBe("pending");
  });

  it("a Google failure keeps the reschedule, records the error, and the retry updates the same event", async () => {
    const { booking, requestId } = await pendingRequest();
    google.setFail(true);
    const result = await approveReschedule({ requestId }, admin, deps(adminRepo));
    expect(result).toMatchObject({ ok: true, data: { calendarSync: "failed" } });
    const after = (await adminRepo.getBookingDetails(booking.id))!;
    expect(after).toMatchObject({ status: "approved", startTime: at(NEW_DAY, "14:00"), googleCalendarEventId: booking.googleCalendarEventId, googleCalendarSyncError: expect.any(String) });

    google.setFail(false);
    const creates = google.createCalls();
    expect(await retryCalendarSync({ bookingId: booking.id }, member, { repo: memberRepo, google: google.gateway })).toMatchObject({ ok: true });
    expect(google.createCalls()).toBe(creates);
    expect((await adminRepo.getBookingDetails(booking.id))!.googleCalendarSyncError).toBeNull();
    expect(google.events.get(booking.googleCalendarEventId!)!.start.toISOString()).toBe(at(NEW_DAY, "14:00"));
  });
});

describe("pending-review admin alerts", () => {
  function alertsWith(calendar = ghl.gateway) {
    const tasks: (() => Promise<void>)[] = [];
    const saved: string[] = [];
    const alerts = createReviewAlerts({
      calendar,
      schedule: (task) => tasks.push(task),
      fieldsFor: (booking) => bookingFieldValues(booking),
      saveGhlContactId: async (_userId, contactId) => {
        saved.push(contactId);
      },
    });
    return { alerts, flush: () => Promise.all(tasks.map((t) => t())), saved };
  }

  it("a new pending booking writes the booking fields and adds room-booking-pending-review", async () => {
    const { alerts, flush, saved } = alertsWith();
    const created = await createBookingRequest(bookingInput("10:00", "12:00"), member, deps(memberRepo, { reviewAlerts: alerts }));
    expect(created.ok).toBe(true);
    await flush();
    expect(ghl.log.updates.at(-1)!.fields).toMatchObject({ room: "Room A", event: "Leaders Huddle", date: formatDate(at(DAY, "10:00"), "EEEE, MMMM d, yyyy") });
    expect(ghl.log.tags.at(-1)!.tag).toBe(REVIEW_ALERT_TAGS.booking);
    expect(saved).toHaveLength(1);
  });

  it("approving or denying the booking removes room-booking-pending-review", async () => {
    const a = await createBookingRequest(bookingInput("10:00", "11:00"), member, deps(memberRepo));
    const b = await createBookingRequest(bookingInput("13:00", "14:00"), member, deps(memberRepo));
    await approveBooking({ bookingId: a.ok ? a.data.bookingId : "" }, admin, deps(adminRepo));
    expect(ghl.log.removedTags.filter((t) => t.tag === REVIEW_ALERT_TAGS.booking)).toHaveLength(1);
    await denyBooking({ bookingId: b.ok ? b.data.bookingId : "", reason: "Not that day." }, admin, deps(adminRepo));
    expect(ghl.log.removedTags.filter((t) => t.tag === REVIEW_ALERT_TAGS.booking)).toHaveLength(2);
  });

  it("a pending reschedule writes the REQUESTED schedule and adds room-booking-reschedule-pending-review", async () => {
    const booking = await approvedBooking();
    const { alerts, flush } = alertsWith();
    const result = await requestReschedule({ bookingId: booking.id, date: NEW_DAY, startTime: "14:00", endTime: "16:00" }, member, deps(memberRepo, { reviewAlerts: alerts }));
    expect(result.ok).toBe(true);
    await flush();
    expect(ghl.log.updates.at(-1)!.fields).toMatchObject({ date: formatDate(at(NEW_DAY, "14:00"), "EEEE, MMMM d, yyyy") });
    expect(ghl.log.tags.at(-1)!.tag).toBe(REVIEW_ALERT_TAGS.reschedule);
  });

  it("approving or denying the reschedule removes its pending-review tag and keeps the outcome tags", async () => {
    const first = await pendingRequest("14:00", "16:00");
    await denyReschedule({ requestId: first.requestId, reason: "Room is set up for another event." }, admin, deps(adminRepo));
    expect(ghl.log.removedTags.filter((t) => t.tag === REVIEW_ALERT_TAGS.reschedule)).toHaveLength(1);
    expect(ghl.log.tags.at(-1)!.tag).toBe(RESCHEDULE_TAGS.denied);

    const second = await reschedule(first.booking.id, "17:00", "19:00");
    await approveReschedule({ requestId: second.ok ? second.data.requestId : "" }, admin, deps(adminRepo));
    expect(ghl.log.removedTags.filter((t) => t.tag === REVIEW_ALERT_TAGS.reschedule)).toHaveLength(2);
    expect(ghl.log.tags.at(-1)!.tag).toBe(RESCHEDULE_TAGS.approved);
  });

  it("a GHL failure never stops the local request from being created", async () => {
    const down = fakeGhl({ day: DAY, failTag: true, failContactUpdate: true });
    const { alerts, flush } = alertsWith(down.gateway);
    const created = await createBookingRequest(bookingInput("10:00", "12:00"), member, deps(memberRepo, { reviewAlerts: alerts }));
    expect(created.ok).toBe(true);
    await expect(flush()).resolves.toBeDefined();
    expect(getDemoState().bookings.some((b) => b.id === (created.ok ? created.data.bookingId : ""))).toBe(true);

    const booking = await approvedBooking(member, "14:00", "15:00");
    const throwing = { bookingRequested: () => undefined, rescheduleRequested: () => { throw new Error("queue broken"); } };
    expect((await requestReschedule({ bookingId: booking.id, date: NEW_DAY, startTime: "17:00", endTime: "18:00" }, member, deps(memberRepo, { reviewAlerts: throwing }))).ok).toBe(true);
  });
});
