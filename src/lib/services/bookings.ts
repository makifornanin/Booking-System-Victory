import { REVIEW_LOCK_TTL_MS, eventTypeLabel } from "@/lib/config";
import type { SessionUser } from "@/lib/auth/provider";
import { RepositoryError, type Repository } from "@/lib/data/repository";
import type { Booking, BookingDetails, BookingSource } from "@/lib/data/types";
import { isRangeBookable, toRange } from "@/lib/domain/availability";
import { canMemberCancel, isPastDue, PAST_DUE_MESSAGE, validateBookingWindow } from "@/lib/domain/booking-rules";
import { dateKeyInZone, formatDate, formatTime, zonedDateTime } from "@/lib/domain/time";
import { GhlError, ghlUserMessage } from "@/lib/ghl/errors";
import { REVIEW_ALERT_TAGS, resolveCalendarId, type BookingFieldValues, type CalendarGateway } from "@/lib/ghl/gateway";
import type { GoogleCalendarGateway } from "@/lib/google/gateway";
import { getRoomDayAvailability, isWindowFreeInCalendar } from "@/lib/services/availability";
import { SYNC_MESSAGES, syncApprovedBooking, type CalendarSyncOutcome } from "@/lib/services/calendar-sync";
import { syncGhlContact } from "@/lib/services/ghl-contact";
import { failure, fieldErrorsFrom, success, type ServiceResult } from "@/lib/services/result";
import { clearReviewAlert, queueReviewAlert, type ReviewAlerts } from "@/lib/services/review-alerts";
import { notifyStatusChange, type BookingStatusNotifier } from "@/lib/services/status-notifier";
import { bookingIdSchema, bookingRequestSchema, denialSchema } from "@/lib/validation/booking";

export interface BookingServiceDeps {
  repo: Repository;
  calendar: CalendarGateway;
  google: GoogleCalendarGateway;
  now: () => Date;
  /** Optional: tells n8n when a WhatsApp booking is approved, denied or cancelled. */
  notifier?: BookingStatusNotifier;
  /** Optional: internal GHL alerts while new or reschedule requests wait for review. */
  reviewAlerts?: ReviewAlerts;
}

/** A concurrent request took the time between the availability check and the insert. */
export const BOOKING_RACE_MESSAGE = "Someone just booked that time. Please pick another slot.";

const ALREADY_REVIEWED: Record<string, string> = {
  approved: "This request was already approved.",
  denied: "This request was already denied.",
  cancelled: "The requester cancelled this booking.",
};

function repositoryFailure<T>(error: unknown): ServiceResult<T> {
  if (error instanceof RepositoryError) {
    if (error.code === "conflict") return failure("conflict", BOOKING_RACE_MESSAGE);
    if (error.code === "duplicate") return failure("duplicate", error.message);
    if (error.code === "invalid") return failure("invalid", error.message);
    if (error.code === "forbidden") return failure("forbidden", error.message);
  }
  console.error("[bookings] unexpected error", error instanceof Error ? error.message : error);
  return failure("unknown", "Something went wrong while saving. Please try again.");
}

function guard(actor: SessionUser | null): ServiceResult<never> | null {
  if (!actor) return failure("unauthenticated", "Your session has expired. Please sign in again.");
  if (actor.accessStatus !== "active") return failure("access_required", "Your account is awaiting approval.");
  return null;
}

// ---------------------------------------------------------------------------
// Member: request a booking
// ---------------------------------------------------------------------------

export interface BookingOrigin {
  source: BookingSource;
  /** WhatsApp message id; the database rejects a second booking for the same message. */
  whatsappMessageId?: string | null;
}

export async function createBookingRequest(
  rawInput: unknown,
  actor: SessionUser | null,
  deps: BookingServiceDeps,
  origin: BookingOrigin = { source: "web" },
): Promise<ServiceResult<{ bookingId: string }>> {
  const denied = guard(actor);
  if (denied) return denied;

  const parsed = bookingRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return failure("invalid", "Please check the highlighted fields.", fieldErrorsFrom(parsed.error.issues));
  }
  const input = parsed.data;

  // Approved bookings go straight to the member's Google Calendar, so a connection is required first.
  const [room, connected] = await Promise.all([
    deps.repo.getRoomById(input.roomId),
    deps.google.required ? deps.google.isConnected(actor!.id) : Promise.resolve(true),
  ]);
  if (!connected) return failure("calendar_required", "Connect Google Calendar to continue.");
  if (!room || !room.isActive) return failure("not_found", "This room is not available for booking.");

  if (input.attendeeCount > room.capacity) {
    return failure("invalid", "Please check the highlighted fields.", {
      attendeeCount: `${room.name} holds up to ${room.capacity} people.`,
    });
  }

  // Times are rebuilt on the server from the chosen local date and slot labels.
  const start = zonedDateTime(input.date, input.startTime);
  const end = zonedDateTime(input.date, input.endTime);
  const windowProblem = validateBookingWindow({ start, end, now: deps.now() });
  if (windowProblem) return failure("invalid", windowProblem);

  const availability = await getRoomDayAvailability(room, input.date, deps);
  if (availability.problem) {
    return failure("calendar_error", availability.problemMessage ?? "This room can't be booked right now.");
  }
  if (!isRangeBookable(availability.slots, toRange(start, end))) {
    return failure("conflict", "That time is no longer available. Please pick another slot.");
  }

  try {
    // The database exclusion constraint is the final guard against concurrent requests.
    const booking = await deps.repo.insertBooking({
      userId: actor!.id,
      roomId: room.id,
      eventName: input.eventName,
      eventType: input.eventType,
      purpose: input.purpose,
      attendeeCount: input.attendeeCount,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      source: origin.source,
      whatsappMessageId: origin.whatsappMessageId ?? null,
    });
    if (deps.reviewAlerts) {
      const alerts = deps.reviewAlerts;
      queueReviewAlert(() =>
        alerts.bookingRequested({
          ...booking,
          room: { id: room.id, name: room.name, slug: room.slug, locationLabel: room.locationLabel },
          requester: { id: actor!.id, fullName: actor!.fullName, email: actor!.email, phone: actor!.phone, ghlContactId: null },
          reviewer: null,
        }),
      );
    }
    return success({ bookingId: booking.id }, "Request sent. It's pending review by the church office.");
  } catch (error) {
    return repositoryFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Cancellation (member: own future booking; admin: approved booking)
// ---------------------------------------------------------------------------

/**
 * Cancels a booking. For approved bookings the GHL appointment is cancelled first
 * (if that fails nothing changes locally), then the local booking, then the
 * matching Google Calendar event — only the stored event id is ever touched.
 */
export async function cancelBooking(
  rawInput: unknown,
  actor: SessionUser | null,
  deps: BookingServiceDeps,
): Promise<ServiceResult<{ calendarCleanupFailed: boolean }>> {
  const denied = guard(actor);
  if (denied) return denied;
  const parsed = bookingIdSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown booking.");

  const booking = await deps.repo.getBookingDetails(parsed.data.bookingId);
  const isOwner = booking?.userId === actor!.id;
  const isAdmin = actor!.role === "admin";
  if (!booking || (!isOwner && !isAdmin)) return failure("not_found", "We couldn't find that booking.");

  if (isOwner && !canMemberCancel(booking, deps.now())) return failure("invalid", "This booking can no longer be cancelled.");
  if (!isOwner && booking.status !== "approved") return failure("invalid", "Only approved bookings can be cancelled here. Deny pending requests instead.");

  if (booking.status === "approved" && booking.ghlAppointmentId) {
    try {
      await deps.calendar.cancelAppointment(booking.ghlAppointmentId);
    } catch (error) {
      return failure("calendar_error", `${ghlUserMessage(error)} The booking was not cancelled.`);
    }
  }

  let cancelled;
  try {
    cancelled = isOwner ? await deps.repo.cancelOwnBooking(booking.id, actor!.id) : await deps.repo.cancelApprovedBooking(booking.id);
  } catch (error) {
    return repositoryFailure(error);
  }
  if (!cancelled) return failure("busy", "This booking is being reviewed right now. Try again in a moment.");

  let calendarCleanupFailed = false;
  if (booking.googleCalendarEventId && deps.google.mode !== "disabled") {
    try {
      await deps.google.deleteBookingEvent(booking.userId, booking.googleCalendarEventId);
      await deps.repo.setCalendarSync(booking.id, null, null).catch(() => undefined);
    } catch (error) {
      calendarCleanupFailed = true;
      console.error(`[google] could not remove event for booking ${booking.id}:`, error instanceof Error ? error.message : error);
    }
  }

  notifyStatusChange(deps.notifier, { ...booking, ...cancelled, status: "cancelled" }, "cancelled");
  return success(
    { calendarCleanupFailed },
    calendarCleanupFailed ? "Booking cancelled, but the Google Calendar event couldn't be removed." : "Booking cancelled.",
  );
}

// ---------------------------------------------------------------------------
// Admin: approve / deny
// ---------------------------------------------------------------------------

/** Values written to the requester's GHL contact before a workflow runs. */
export function bookingFieldValues(details: BookingDetails, denialReason = ""): BookingFieldValues {
  return {
    room: details.room.name,
    event: details.eventName,
    date: formatDate(details.startTime, "EEEE, MMMM d, yyyy"),
    time: `${formatTime(details.startTime)} – ${formatTime(details.endTime)}`,
    denialReason,
  };
}

async function explainUnclaimable(repo: Repository, bookingId: string): Promise<ServiceResult<never>> {
  const current = await repo.getBookingDetails(bookingId);
  if (!current) return failure("not_found", "We couldn't find that booking request.");
  if (current.status !== "pending") {
    return failure("already_reviewed", ALREADY_REVIEWED[current.status] ?? "This request was already reviewed.");
  }
  return failure("busy", "Another admin is processing this request right now. Refresh in a moment.");
}

/** Claims the booking for this admin so approve/deny/cancel can't interleave. */
async function claim(deps: Pick<BookingServiceDeps, "repo" | "now">, bookingId: string, adminId: string) {
  const now = deps.now();
  const claimed = await deps.repo.claimBookingForReview(bookingId, adminId, now, new Date(now.getTime() - REVIEW_LOCK_TTL_MS));
  const release = () =>
    deps.repo.releaseReviewClaim(bookingId, adminId).catch((error: unknown) => {
      console.error(`[bookings] failed to release review claim for ${bookingId}`, error instanceof Error ? error.message : error);
    });
  return { claimed, release };
}

function ghlFailure(error: unknown): ServiceResult<never> {
  if (error instanceof RepositoryError) return repositoryFailure(error);
  return failure("calendar_error", `${ghlUserMessage(error)} The booking is still pending.`);
}

function adminGuard(actor: SessionUser | null, action: string): ServiceResult<never> | null {
  const denied = guard(actor);
  if (denied) return denied;
  if (actor!.role !== "admin") return failure("forbidden", `Only admins can ${action} bookings.`);
  return null;
}

export interface ApprovalResult {
  calendarSync: CalendarSyncOutcome;
}

export async function approveBooking(
  rawInput: unknown,
  actor: SessionUser | null,
  deps: BookingServiceDeps,
): Promise<ServiceResult<ApprovalResult>> {
  const denied = adminGuard(actor, "approve");
  if (denied) return denied;

  const parsed = bookingIdSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown booking.");
  const bookingId = parsed.data.bookingId;
  const adminId = actor!.id;

  let lock: Awaited<ReturnType<typeof claim>>;
  try {
    lock = await claim(deps, bookingId, adminId);
  } catch (error) {
    return repositoryFailure(error);
  }
  if (!lock.claimed) return explainUnclaimable(deps.repo, bookingId);
  const { release } = lock;

  let details: BookingDetails;
  let calendarId: string;
  let assignedUserId: string;
  let contactId: string;
  try {
    const current = await deps.repo.getBookingDetails(bookingId);
    if (!current || current.status !== "pending") {
      await release();
      return explainUnclaimable(deps.repo, bookingId);
    }
    details = current;
    if (isPastDue(details, deps.now())) {
      await release();
      return failure("invalid", PAST_DUE_MESSAGE);
    }

    const window = toRange(details.startTime, details.endTime);
    const [room, conflicts] = await Promise.all([
      deps.repo.getRoomById(details.roomId),
      deps.repo.findConflictingBookings(details.roomId, window, bookingId),
    ]);
    if (!room || !room.isActive) {
      await release();
      return failure("invalid", "This room is no longer active. Deny the request or reactivate the room.");
    }
    if (conflicts.length > 0) {
      await release();
      return failure("conflict", "Another booking now overlaps this time. Review the schedule before approving.");
    }

    const resolved = resolveCalendarId(deps.calendar, room);
    if (!resolved) {
      await release();
      return failure("calendar_error", `${room.name} has no GHL calendar ID. Set it in the rooms table, then approve.`);
    }
    calendarId = resolved;

    // Calendar settings (cached) and a live availability check, in parallel.
    const [info, stillFree] = await Promise.all([
      deps.calendar.getCalendarInfo(calendarId),
      isWindowFreeInCalendar(deps.calendar, calendarId, dateKeyInZone(details.startTime), window),
    ]);
    if (!info.assignedUserId) {
      await release();
      return failure(
        "calendar_error",
        `${room.name}'s GHL calendar has no team member assigned, and GHL requires one. Assign a staff member to the calendar in GHL, then approve again. The booking is still pending.`,
      );
    }
    assignedUserId = info.assignedUserId;
    if (!stillFree) {
      await release();
      return failure(
        "conflict",
        "GHL no longer shows this time as free for the room, so the booking stays pending. If an earlier approval attempt timed out, its appointment may already be in GHL.",
      );
    }

    if (!details.requester.email) {
      await release();
      return failure("invalid", "The requester has no email address on file, so GHL can't send the confirmation.");
    }

    // The approval email workflow reads these contact fields, so they must be set first.
    const contact = await syncGhlContact(deps.calendar, deps.repo, details.requester, { fields: bookingFieldValues(details) });
    contactId = contact.id;
  } catch (error) {
    await release();
    return ghlFailure(error);
  }

  let appointmentId: string;
  try {
    // A confirmed API appointment triggers the "Room Booking - Approved" workflow in GHL.
    const appointment = await deps.calendar.createAppointment({
      calendarId,
      contactId,
      assignedUserId,
      start: new Date(details.startTime),
      end: new Date(details.endTime),
      title: `${details.eventName} — ${details.requester.fullName}`,
      description: `${eventTypeLabel(details.eventType)} · ${details.attendeeCount} attendees · Booking ${details.id}\n${details.purpose}`,
    });
    appointmentId = appointment.id;
  } catch (error) {
    await release();
    if (error instanceof GhlError && error.ambiguous) {
      console.error(`[bookings] AMBIGUOUS GHL appointment create for booking ${bookingId}; verify the room calendar.`);
      return failure(
        "calendar_error",
        `GHL didn't confirm the appointment, but it may still have been created. Check the room's GHL calendar for booking ${bookingId} before trying again. The booking is still pending.`,
      );
    }
    return ghlFailure(error);
  }

  // Only now, after GHL accepted the appointment, is the booking marked approved.
  let approved: Awaited<ReturnType<Repository["markApproved"]>>;
  try {
    approved = await deps.repo.markApproved(bookingId, adminId, appointmentId, deps.now());
  } catch (error) {
    console.error(`[bookings] markApproved failed for ${bookingId}`, error instanceof Error ? error.message : error);
    // The update may have committed even though the response was lost; never roll back a saved approval.
    const current = await deps.repo.getBookingDetails(bookingId).catch(() => null);
    approved = current?.status === "approved" && current.ghlAppointmentId === appointmentId ? current : null;
  }

  if (!approved) {
    await release();
    try {
      await deps.calendar.deleteAppointment(appointmentId);
    } catch {
      console.error(`[bookings] ORPHANED GHL appointment ${appointmentId} for booking ${bookingId}; remove it in GHL.`);
    }
    return failure("unknown", "The approval couldn't be saved, so the calendar entry was rolled back. Please try again.");
  }

  // Google Calendar comes last and can never undo the approval.
  const calendarSync = await syncApprovedBooking({ ...details, ...approved, status: "approved", googleCalendarEventId: null }, deps);
  notifyStatusChange(deps.notifier, { ...details, ...approved, status: "approved" }, "approved");
  await clearReviewAlert(deps.calendar, { id: contactId, tags: null }, REVIEW_ALERT_TAGS.booking);
  const message =
    SYNC_MESSAGES[calendarSync] ??
    (calendarSync === "disabled"
      ? "Booking approved and added to the GHL calendar."
      : "Booking approved and added to the GHL calendar and the member's Google Calendar.");
  return success({ calendarSync }, message);
}

export const DENIAL_NOTIFICATION_FAILED = "Booking denied, but the notification could not be sent.";

export interface DenialResult {
  /** The booking is denied either way; only GHL's email to the requester failed (it can be retried). */
  notificationFailed: boolean;
}

/**
 * Denying is a local decision. Order:
 * 1. claim and re-check the pending booking;
 * 2. mark it denied with the reason, reviewer and time, which frees its slot;
 * 3. only then ask GHL to email the requester. A GHL failure is recorded on the
 *    booking for a retry and never undoes the denial.
 */
export async function denyBooking(
  rawInput: unknown,
  actor: SessionUser | null,
  deps: Omit<BookingServiceDeps, "google">,
): Promise<ServiceResult<DenialResult>> {
  const deniedActor = adminGuard(actor, "deny");
  if (deniedActor) return deniedActor;

  const parsed = denialSchema.safeParse(rawInput);
  if (!parsed.success) {
    return failure("invalid", "A reason is required to deny a request.", fieldErrorsFrom(parsed.error.issues));
  }
  const { bookingId, reason } = parsed.data;
  const adminId = actor!.id;

  let lock: Awaited<ReturnType<typeof claim>>;
  try {
    lock = await claim(deps, bookingId, adminId);
  } catch (error) {
    return repositoryFailure(error);
  }
  if (!lock.claimed) return explainUnclaimable(deps.repo, bookingId);
  const { release } = lock;

  let details: BookingDetails | null;
  try {
    details = await deps.repo.getBookingDetails(bookingId);
  } catch (error) {
    await release();
    return repositoryFailure(error);
  }
  if (!details || details.status !== "pending") {
    await release();
    return explainUnclaimable(deps.repo, bookingId);
  }

  let deniedBooking: Booking | null;
  try {
    deniedBooking = await deps.repo.markDenied(bookingId, adminId, reason, deps.now());
  } catch (error) {
    console.error(`[bookings] markDenied failed for ${bookingId}`, error instanceof Error ? error.message : error);
    // The update may have committed even though the response was lost.
    const current = await deps.repo.getBookingDetails(bookingId).catch(() => null);
    deniedBooking = current?.status === "denied" ? current : null;
    if (!deniedBooking) {
      await release();
      return repositoryFailure(error);
    }
  }
  if (!deniedBooking) {
    await release();
    return explainUnclaimable(deps.repo, bookingId);
  }

  const denied: BookingDetails = { ...details, ...deniedBooking, status: "denied", denialReason: reason };
  notifyStatusChange(deps.notifier, denied, "denied");
  const notificationError = await sendDenialEmail(denied, deps);
  return success(
    { notificationFailed: notificationError !== null },
    notificationError ? DENIAL_NOTIFICATION_FAILED : "Booking denied. GHL will email the requester with your reason.",
  );
}

/**
 * Best-effort: writes the denial to the requester's GHL contact, clears the
 * pending-review alert and re-adds the denial tag (its workflow sends the email).
 * The outcome is saved on the booking; returns the error message, never throws.
 */
async function sendDenialEmail(booking: BookingDetails, deps: Pick<BookingServiceDeps, "repo" | "calendar">): Promise<string | null> {
  let message: string | null = null;
  try {
    if (!booking.requester.email) throw new Error("The requester has no email address on file.");
    const contact = await syncGhlContact(deps.calendar, deps.repo, booking.requester, { fields: bookingFieldValues(booking, booking.denialReason ?? "") });
    await clearReviewAlert(deps.calendar, contact, REVIEW_ALERT_TAGS.booking);
    await deps.calendar.addTriggerTag(contact, deps.calendar.bookingDeniedTag);
  } catch (error) {
    message = error instanceof Error && !("kind" in error) ? error.message : ghlUserMessage(error);
    console.error(`[bookings] denial email failed for booking ${booking.id}:`, error instanceof Error ? error.message : error);
  }
  await deps.repo.setBookingNotificationResult(booking.id, message).catch((error: unknown) => {
    console.error(`[bookings] could not record the denial email result for ${booking.id}`, error instanceof Error ? error.message : error);
  });
  return message;
}

/** Admin: re-sends the denial email for a denied booking. */
export async function retryDenialEmail(rawInput: unknown, actor: SessionUser | null, deps: Pick<BookingServiceDeps, "repo" | "calendar">): Promise<ServiceResult> {
  const deniedActor = adminGuard(actor, "review");
  if (deniedActor) return deniedActor;
  const parsed = bookingIdSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown booking.");
  const booking = await deps.repo.getBookingDetails(parsed.data.bookingId);
  if (!booking) return failure("not_found", "We couldn't find that booking.");
  if (booking.status !== "denied") return failure("invalid", "Only denied bookings send a denial email.");
  const error = await sendDenialEmail(booking, deps);
  return error ? failure("calendar_error", `The notification failed again: ${error}`) : success(undefined, "Notification sent.");
}
