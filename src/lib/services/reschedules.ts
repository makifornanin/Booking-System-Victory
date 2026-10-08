import { z } from "zod";
import { REVIEW_LOCK_TTL_MS } from "@/lib/config";
import type { SessionUser } from "@/lib/auth/provider";
import { RepositoryError, type Repository } from "@/lib/data/repository";
import type { BookingDetails, RescheduleRequestDetails } from "@/lib/data/types";
import { isRangeBookable, toRange } from "@/lib/domain/availability";
import { canRequestReschedule, validateBookingWindow } from "@/lib/domain/booking-rules";
import { dateKeyInZone, zonedDateTime } from "@/lib/domain/time";
import { ghlUserMessage } from "@/lib/ghl/errors";
import { RESCHEDULE_TAGS, REVIEW_ALERT_TAGS, resolveCalendarId } from "@/lib/ghl/gateway";
import { getRoomDayAvailability } from "@/lib/services/availability";
import { bookingFieldValues, type BookingServiceDeps } from "@/lib/services/bookings";
import { syncRescheduledBooking, type CalendarSyncOutcome } from "@/lib/services/calendar-sync";
import { syncGhlContact } from "@/lib/services/ghl-contact";
import { failure, fieldErrorsFrom, success, type ServiceResult } from "@/lib/services/result";
import { clearReviewAlert, queueReviewAlert } from "@/lib/services/review-alerts";
import { dateKeySchema, timeKeySchema } from "@/lib/validation/booking";

export type RescheduleDeps = Omit<BookingServiceDeps, "notifier">;

export const RESCHEDULE_SUBMITTED_MESSAGE =
  "Your reschedule request has been submitted for admin review. Your current booking remains confirmed until the request is approved.";

const requestSchema = z.object({
  bookingId: z.uuid({ error: "Unknown booking." }),
  date: dateKeySchema,
  startTime: timeKeySchema,
  endTime: timeKeySchema,
});
const idSchema = z.object({ requestId: z.uuid({ error: "Unknown reschedule request." }) });
const denialSchema = z.object({
  requestId: z.uuid({ error: "Unknown reschedule request." }),
  reason: z
    .string()
    .trim()
    .min(3, { error: "Enter a reason so the member knows why." })
    .max(500, { error: "Keep the reason under 500 characters." }),
});

function memberGuard(actor: SessionUser | null): ServiceResult<never> | null {
  if (!actor) return failure("unauthenticated", "Your session has expired. Please sign in again.");
  if (actor.accessStatus !== "active") return failure("access_required", "Your account doesn't have portal access.");
  return null;
}

function adminGuard(actor: SessionUser | null): ServiceResult<never> | null {
  const denied = memberGuard(actor);
  if (denied) return denied;
  if (actor!.role !== "admin") return failure("forbidden", "Only admins can review reschedule requests.");
  return null;
}

function repositoryFailure<T>(error: unknown): ServiceResult<T> {
  if (error instanceof RepositoryError) {
    if (error.code === "conflict") return failure("conflict", "That time is no longer available. Please pick another slot.");
    if (error.code === "duplicate") return failure("duplicate", "This booking already has a reschedule request waiting for review.");
    if (error.code === "invalid") return failure("invalid", error.message);
    if (error.code === "forbidden") return failure("not_found", "We couldn't find that booking.");
  }
  console.error("[reschedules] unexpected error", error instanceof Error ? error.message : error);
  return failure("unknown", "Something went wrong while saving. Please try again.");
}

/** Contact fields for reschedule emails: the requested (new) room, event, date and time. */
function requestedFieldValues(request: RescheduleRequestDetails, denialReason = "") {
  return bookingFieldValues({ ...request.booking, startTime: request.requestedStart, endTime: request.requestedEnd }, denialReason);
}

// ---------------------------------------------------------------------------
// Member
// ---------------------------------------------------------------------------

/**
 * Creates a pending reschedule request. The original booking stays approved and
 * unchanged; the requested slot is held (the database refuses overlaps) until an
 * admin approves or denies it.
 */
export async function requestReschedule(rawInput: unknown, actor: SessionUser | null, deps: RescheduleDeps): Promise<ServiceResult<{ requestId: string }>> {
  const denied = memberGuard(actor);
  if (denied) return denied;
  const parsed = requestSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Please check the highlighted fields.", fieldErrorsFrom(parsed.error.issues));
  const input = parsed.data;
  const now = deps.now();

  const booking = await deps.repo.getBookingDetails(input.bookingId);
  if (!booking || booking.userId !== actor!.id) return failure("not_found", "We couldn't find that booking.");
  if (booking.status !== "approved") return failure("invalid", "Only approved bookings can be rescheduled.");
  if (!canRequestReschedule(booking, now)) return failure("invalid", "Past bookings can't be rescheduled.");

  const existing = await deps.repo.listRescheduleRequestsForBooking(booking.id);
  if (existing.some((r) => r.status === "pending")) return failure("duplicate", "This booking already has a reschedule request waiting for review.");

  const start = zonedDateTime(input.date, input.startTime);
  const end = zonedDateTime(input.date, input.endTime);
  const windowProblem = validateBookingWindow({ start, end, now });
  if (windowProblem) return failure("invalid", windowProblem);
  if (start.toISOString() === booking.startTime && end.toISOString() === booking.endTime) {
    return failure("invalid", "Choose a different date or time than your current booking.");
  }

  const room = await deps.repo.getRoomById(booking.roomId);
  if (!room || !room.isActive) return failure("not_found", "This room is not available for booking.");
  // The same engine as new bookings: GHL free slots minus bookings and held slots.
  const availability = await getRoomDayAvailability(room, input.date, deps);
  if (availability.problem) return failure("calendar_error", availability.problemMessage ?? "This room can't be booked right now.");
  if (!isRangeBookable(availability.slots, toRange(start, end))) {
    return failure("conflict", "That time is no longer available. Please pick another slot.");
  }

  try {
    const request = await deps.repo.insertRescheduleRequest({ bookingId: booking.id, requestedStart: start.toISOString(), requestedEnd: end.toISOString() });
    if (deps.reviewAlerts) {
      const alerts = deps.reviewAlerts;
      queueReviewAlert(() => alerts.rescheduleRequested({ ...request, booking, reviewer: null }));
    }
    return success({ requestId: request.id }, RESCHEDULE_SUBMITTED_MESSAGE);
  } catch (error) {
    return repositoryFailure(error);
  }
}

/** Members may withdraw their own pending request; the held slot is released. */
export async function withdrawReschedule(rawInput: unknown, actor: SessionUser | null, deps: Pick<RescheduleDeps, "repo">): Promise<ServiceResult> {
  const denied = memberGuard(actor);
  if (denied) return denied;
  const parsed = idSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown reschedule request.");
  const cancelled = await deps.repo.cancelOwnReschedule(parsed.data.requestId).catch(() => null);
  if (!cancelled) return failure("invalid", "This request can't be withdrawn. It may already have been reviewed.");
  return success(undefined, "Reschedule request withdrawn. Your booking is unchanged.");
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function claim(deps: Pick<RescheduleDeps, "repo" | "now">, requestId: string, adminId: string) {
  const now = deps.now();
  const claimed = await deps.repo.claimRescheduleForReview(requestId, adminId, now, new Date(now.getTime() - REVIEW_LOCK_TTL_MS));
  return {
    claimed: Boolean(claimed),
    release: () => deps.repo.releaseRescheduleClaim(requestId, adminId).catch(() => undefined),
  };
}

async function explainUnclaimable(repo: Repository, requestId: string): Promise<ServiceResult<never>> {
  const request = await repo.getRescheduleRequest(requestId);
  if (!request) return failure("not_found", "We couldn't find that reschedule request.");
  if (request.status !== "pending") return failure("already_reviewed", `This request was already ${request.status}.`);
  return failure("busy", "Another admin is reviewing this request right now. Try again in a moment.");
}

export interface RescheduleApprovalResult {
  calendarSync: CalendarSyncOutcome;
  notificationFailed: boolean;
}

/**
 * Approves a reschedule. Order:
 * 1. claim the request, re-check that it and the booking are still valid and that
 *    the requested time is still free (its own hold excluded);
 * 2. move the existing GHL appointment (if this fails nothing else changes);
 * 3. move the booking and mark the request approved, atomically (if this fails,
 *    the GHL appointment is moved back);
 * 4. write the new times to the GHL contact and add the "approved" email tag;
 * 5. update the member's Google Calendar event (failure is recorded, never undone).
 */
export async function approveReschedule(rawInput: unknown, actor: SessionUser | null, deps: RescheduleDeps): Promise<ServiceResult<RescheduleApprovalResult>> {
  const denied = adminGuard(actor);
  if (denied) return denied;
  const parsed = idSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown reschedule request.");
  const requestId = parsed.data.requestId;
  const adminId = actor!.id;

  const lock = await claim(deps, requestId, adminId).catch(() => ({ claimed: false, release: async () => undefined }));
  if (!lock.claimed) return explainUnclaimable(deps.repo, requestId);
  const { release } = lock;
  const stillPending = (message: string) => `${message} The reschedule request is still pending.`;

  const request = await deps.repo.getRescheduleRequest(requestId);
  if (!request || request.status !== "pending") {
    await release();
    return explainUnclaimable(deps.repo, requestId);
  }
  const booking = request.booking;
  const now = deps.now();
  if (booking.status !== "approved" || booking.startTime !== request.originalStart || booking.endTime !== request.originalEnd) {
    await release();
    return failure("invalid", "The booking changed after this request was made, so it can't be applied. Deny it and ask the member to request again.");
  }
  if (new Date(booking.startTime).getTime() <= now.getTime()) {
    await release();
    return failure("invalid", "The original booking has already started, so it can't be rescheduled.");
  }
  const start = new Date(request.requestedStart);
  const end = new Date(request.requestedEnd);
  const windowProblem = validateBookingWindow({ start, end, now });
  if (windowProblem) {
    await release();
    return failure("invalid", stillPending(windowProblem));
  }
  if (!booking.ghlAppointmentId) {
    await release();
    return failure("calendar_error", stillPending("This booking has no GHL appointment to move."));
  }

  const room = await deps.repo.getRoomById(booking.roomId);
  const calendarId = room ? resolveCalendarId(deps.calendar, room) : null;
  if (!room || !calendarId) {
    await release();
    return failure("calendar_error", stillPending("This room isn't connected to a GHL calendar."));
  }

  // Final check with live GHL free slots; the request's own hold doesn't count against it.
  let info;
  try {
    const [calendarInfo, availability] = await Promise.all([
      deps.calendar.getCalendarInfo(calendarId),
      getRoomDayAvailability(room, dateKeyInZone(start), deps, { excludeRescheduleId: requestId }),
    ]);
    info = calendarInfo;
    if (availability.problem) {
      await release();
      return failure("calendar_error", stillPending(availability.problemMessage ?? "The room's calendar couldn't be checked."));
    }
    if (!isRangeBookable(availability.slots, toRange(start, end))) {
      await release();
      return failure("conflict", stillPending("GHL or another booking no longer shows the requested time as free."));
    }
  } catch (error) {
    await release();
    return failure("calendar_error", stillPending(ghlUserMessage(error)));
  }
  if (!info.assignedUserId) {
    await release();
    return failure("calendar_error", stillPending(`${room.name}'s GHL calendar has no team member assigned.`));
  }

  const title = booking.eventName;
  try {
    await deps.calendar.moveAppointment(booking.ghlAppointmentId, { calendarId, assignedUserId: info.assignedUserId, start, end, title });
  } catch (error) {
    await release();
    return failure("calendar_error", stillPending(ghlUserMessage(error)));
  }

  let moved: Awaited<ReturnType<Repository["applyReschedule"]>> = null;
  let applyError: unknown = null;
  try {
    moved = await deps.repo.applyReschedule(requestId);
  } catch (error) {
    applyError = error;
  }
  if (!moved) {
    // Put the GHL appointment back where it was; the local booking never moved.
    await deps.calendar
      .moveAppointment(booking.ghlAppointmentId, { calendarId, assignedUserId: info.assignedUserId, start: new Date(booking.startTime), end: new Date(booking.endTime), title })
      .catch(() => console.error(`[reschedules] could not move GHL appointment ${booking.ghlAppointmentId} back for request ${requestId}; check it in GHL.`));
    await release();
    if (applyError instanceof RepositoryError && (applyError.code === "invalid" || applyError.code === "conflict")) {
      return failure(applyError.code, stillPending(applyError.message));
    }
    console.error("[reschedules] applyReschedule failed", applyError instanceof Error ? applyError.message : applyError);
    return failure("unknown", stillPending("The reschedule couldn't be saved, so the GHL appointment was moved back. Please try again."));
  }

  const rescheduled: BookingDetails = { ...booking, ...moved, room: booking.room, requester: booking.requester, reviewer: booking.reviewer };
  const notificationError = await sendRescheduleEmail(request, "approved", "", deps);
  const calendarSync = await syncRescheduledBooking(rescheduled, deps);

  const parts = ["Reschedule approved. The GHL appointment was moved"];
  if (calendarSync === "synced") parts.push(" and the member's Google Calendar was updated");
  let message = `${parts.join("")}.`;
  if (notificationError) message += ` The email notification failed: ${notificationError}`;
  if (calendarSync === "failed") message += " Google Calendar sync failed; it can be retried from the booking.";
  return success({ calendarSync, notificationFailed: Boolean(notificationError) }, message);
}

/**
 * Denies a reschedule. The original booking, its GHL appointment and Google event
 * stay as they are. The denial is saved first (releasing the held slot); the GHL
 * email follows and, if it fails, is recorded for a retry without undoing anything.
 */
export async function denyReschedule(
  rawInput: unknown,
  actor: SessionUser | null,
  deps: Pick<RescheduleDeps, "repo" | "calendar" | "now">,
): Promise<ServiceResult<{ notificationFailed: boolean }>> {
  const denied = adminGuard(actor);
  if (denied) return denied;
  const parsed = denialSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "A reason is required to deny a request.", fieldErrorsFrom(parsed.error.issues));
  const { requestId, reason } = parsed.data;
  const adminId = actor!.id;

  const lock = await claim(deps, requestId, adminId).catch(() => ({ claimed: false, release: async () => undefined }));
  if (!lock.claimed) return explainUnclaimable(deps.repo, requestId);
  const { release } = lock;

  const request = await deps.repo.getRescheduleRequest(requestId);
  if (!request || request.status !== "pending") {
    await release();
    return explainUnclaimable(deps.repo, requestId);
  }

  let deniedRequest: Awaited<ReturnType<Repository["markRescheduleDenied"]>>;
  try {
    deniedRequest = await deps.repo.markRescheduleDenied(requestId, adminId, reason, deps.now());
  } catch (error) {
    await release();
    return repositoryFailure(error);
  }
  if (!deniedRequest) {
    await release();
    return explainUnclaimable(deps.repo, requestId);
  }

  const notificationError = await sendRescheduleEmail(request, "denied", reason, deps);
  return success(
    { notificationFailed: notificationError !== null },
    notificationError
      ? "Reschedule denied, but the notification could not be sent."
      : "Reschedule denied. The original booking stays confirmed, and GHL will email the member.",
  );
}

/**
 * Writes the requested room/event/date/time (and the denial reason) to the
 * member's GHL contact, then re-adds the reschedule email tag. Returns an error
 * message (recorded on the request) instead of throwing.
 */
async function sendRescheduleEmail(
  request: RescheduleRequestDetails,
  outcome: "approved" | "denied",
  reason: string,
  deps: Pick<RescheduleDeps, "repo" | "calendar">,
): Promise<string | null> {
  const requester = request.booking.requester;
  try {
    if (!requester.email) throw new Error("The member has no email address on file.");
    const contact = await syncGhlContact(deps.calendar, deps.repo, requester, { fields: requestedFieldValues(request, reason) });
    // The request is reviewed: it no longer waits in the internal "pending review" alert.
    await clearReviewAlert(deps.calendar, contact, REVIEW_ALERT_TAGS.reschedule);
    await deps.calendar.addTriggerTag(contact, RESCHEDULE_TAGS[outcome]);
    await deps.repo.setRescheduleNotificationResult(request.id, null).catch(() => undefined);
    return null;
  } catch (error) {
    const message = error instanceof Error && !("kind" in error) ? error.message : ghlUserMessage(error);
    console.error(`[reschedules] ${outcome} email failed for request ${request.id}:`, error instanceof Error ? error.message : error);
    await deps.repo.setRescheduleNotificationResult(request.id, message).catch(() => undefined);
    return message;
  }
}

/** Admin: re-sends the approval/denial email for a reviewed request. */
export async function retryRescheduleEmail(rawInput: unknown, actor: SessionUser | null, deps: Pick<RescheduleDeps, "repo" | "calendar">): Promise<ServiceResult> {
  const denied = adminGuard(actor);
  if (denied) return denied;
  const parsed = idSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown reschedule request.");
  const request = await deps.repo.getRescheduleRequest(parsed.data.requestId);
  if (!request) return failure("not_found", "We couldn't find that reschedule request.");
  if (request.status !== "approved" && request.status !== "denied") return failure("invalid", "Only reviewed requests send an email.");
  const error = await sendRescheduleEmail(request, request.status, request.denialReason ?? "", deps);
  return error ? failure("calendar_error", `The email failed again: ${error}`) : success(undefined, "Email sent.");
}
