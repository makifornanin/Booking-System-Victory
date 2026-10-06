import type { SessionUser } from "@/lib/auth/provider";
import type { Repository } from "@/lib/data/repository";
import type { BookingDetails } from "@/lib/data/types";
import type { GoogleCalendarGateway } from "@/lib/google/gateway";
import { failure, success, type ServiceResult } from "@/lib/services/result";
import { bookingIdSchema } from "@/lib/validation/booking";

export type CalendarSyncOutcome = "synced" | "already_synced" | "failed" | "not_connected" | "disabled";

export interface CalendarSyncDeps {
  repo: Repository;
  google: GoogleCalendarGateway;
}

export function calendarEventFor(booking: BookingDetails) {
  return {
    bookingId: booking.id,
    summary: booking.eventName,
    description: `Victory Church Room Booking\n\nRoom: ${booking.room.name}\nEvent: ${booking.eventName}`,
    location: booking.room.locationLabel ? `${booking.room.name}, ${booking.room.locationLabel}` : booking.room.name,
    start: new Date(booking.startTime),
    end: new Date(booking.endTime),
  };
}

/**
 * Adds an approved booking to its owner's Google Calendar. Idempotent: if an
 * event id is already stored (and the last sync didn't fail) nothing happens,
 * and the event id is derived from the booking so Google itself rejects
 * duplicates. A stored event whose last sync failed (e.g. after a reschedule)
 * is updated in place instead of duplicated. Never throws.
 */
export async function syncApprovedBooking(booking: BookingDetails, deps: CalendarSyncDeps): Promise<CalendarSyncOutcome> {
  if (booking.status !== "approved") return "failed";
  if (booking.googleCalendarEventId && !booking.googleCalendarSyncError) return "already_synced";
  if (deps.google.mode === "disabled") return "disabled";
  if (booking.googleCalendarEventId) return updateBookingEvent(booking, booking.googleCalendarEventId, deps);

  try {
    if (!(await deps.google.isConnected(booking.userId))) {
      await deps.repo.setCalendarSync(booking.id, null, "Google Calendar isn't connected.");
      return "not_connected";
    }
    const eventId = await deps.google.createBookingEvent(booking.userId, calendarEventFor(booking));
    await deps.repo.setCalendarSync(booking.id, eventId, null);
    return "synced";
  } catch (error) {
    console.error(`[google] calendar sync failed for booking ${booking.id}:`, error instanceof Error ? error.message : error);
    await deps.repo.setCalendarSync(booking.id, null, "Google Calendar sync failed.").catch(() => undefined);
    return "failed";
  }
}

export const SYNC_MESSAGES: Record<CalendarSyncOutcome, string | null> = {
  synced: null,
  already_synced: null,
  disabled: null,
  failed: "Booking approved, but Google Calendar sync failed.",
  not_connected: "Booking approved, but the member hasn't connected Google Calendar.",
};

/** Retry action for admins (any approved booking) and members (their own). */
async function updateBookingEvent(booking: BookingDetails, eventId: string, deps: CalendarSyncDeps): Promise<CalendarSyncOutcome> {
  try {
    const current = await deps.google.updateBookingEvent(booking.userId, eventId, calendarEventFor(booking));
    await deps.repo.setCalendarSync(booking.id, current, null);
    return "synced";
  } catch (error) {
    console.error(`[google] calendar update failed for booking ${booking.id}:`, error instanceof Error ? error.message : error);
    // Keep the event id so a retry updates (not duplicates) the event.
    await deps.repo.setCalendarSync(booking.id, eventId, "Google Calendar update failed.").catch(() => undefined);
    return "failed";
  }
}

/**
 * After an approved reschedule: moves the existing Google event to the new
 * time, or creates one if the booking never made it to Google. Never throws and
 * never undoes the reschedule.
 */
export async function syncRescheduledBooking(booking: BookingDetails, deps: CalendarSyncDeps): Promise<CalendarSyncOutcome> {
  if (booking.status !== "approved") return "failed";
  if (deps.google.mode === "disabled") return "disabled";
  if (!booking.googleCalendarEventId) return syncApprovedBooking({ ...booking, googleCalendarSyncError: null }, deps);
  return updateBookingEvent(booking, booking.googleCalendarEventId, deps);
}

export async function retryCalendarSync(
  rawInput: unknown,
  actor: SessionUser | null,
  deps: CalendarSyncDeps,
): Promise<ServiceResult<{ outcome: CalendarSyncOutcome }>> {
  if (!actor) return failure("unauthenticated", "Your session has expired. Please sign in again.");
  if (actor.accessStatus !== "active") return failure("access_required", "Your account doesn't have portal access.");
  const parsed = bookingIdSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown booking.");

  const booking = await deps.repo.getBookingDetails(parsed.data.bookingId);
  if (!booking || (booking.userId !== actor.id && actor.role !== "admin")) return failure("not_found", "We couldn't find that booking.");
  if (booking.status !== "approved") return failure("invalid", "Only approved bookings are added to Google Calendar.");

  const outcome = await syncApprovedBooking(booking, deps);
  if (outcome === "synced" || outcome === "already_synced") return success({ outcome }, "Added to Google Calendar.");
  if (outcome === "not_connected") return failure("calendar_required", "Connect Google Calendar first, then retry.");
  if (outcome === "disabled") return failure("calendar_error", "Google Calendar sync isn't configured on this server.");
  return failure("calendar_error", "Google Calendar sync failed again. Please try later.");
}
