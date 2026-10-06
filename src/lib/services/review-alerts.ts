import type { BookingDetails, RescheduleRequestDetails } from "@/lib/data/types";
import { ghlUserMessage } from "@/lib/ghl/errors";
import { REVIEW_ALERT_TAGS, type CalendarGateway, type ContactFieldValues, type GhlContactRef } from "@/lib/ghl/gateway";
import { syncGhlContact, type ContactOwner } from "@/lib/services/ghl-contact";

/**
 * Internal admin notifications while a request waits for review. A GHL workflow
 * runs when the tag is added; the tag is removed again once the request is
 * approved or denied. None of this ever affects the request itself.
 */
export interface ReviewAlerts {
  bookingRequested(booking: BookingDetails): void;
  rescheduleRequested(request: RescheduleRequestDetails): void;
}

export interface ReviewAlertDeps {
  calendar: CalendarGateway;
  /** Server-side write of the contact id (members can't call the admin-only function). */
  saveGhlContactId: (userId: string, contactId: string) => Promise<void>;
}

/** Writes the booking fields to the requester's contact and re-adds the alert tag. Returns an error instead of throwing. */
export async function sendReviewAlert(owner: ContactOwner, fields: ContactFieldValues, tag: string, deps: ReviewAlertDeps): Promise<string | null> {
  try {
    if (!owner.email) throw new Error("The member has no email address on file.");
    const contact = await syncGhlContact(deps.calendar, { saveGhlContactId: deps.saveGhlContactId }, owner, { fields });
    await deps.calendar.addTriggerTag(contact, tag);
    return null;
  } catch (error) {
    const message = error instanceof Error && !("kind" in error) ? error.message : ghlUserMessage(error);
    console.error(`[review-alerts] ${tag} for ${owner.id} failed:`, error instanceof Error ? error.message : error);
    return message;
  }
}

/** Removes an alert tag once the request is reviewed. Best-effort: logs and never throws. */
export async function clearReviewAlert(calendar: CalendarGateway, contact: GhlContactRef | null, tag: string): Promise<void> {
  if (!contact) return;
  await calendar.removeTag(contact, tag).catch((error: unknown) => {
    console.error(`[review-alerts] could not remove ${tag} from contact ${contact.id}:`, error instanceof Error ? error.message : error);
  });
}

/** Queues the alerts with `schedule` (next/server `after` in production) so requests never wait for GHL. */
export function createReviewAlerts(deps: ReviewAlertDeps & { schedule: (task: () => Promise<void>) => void; fieldsFor: (booking: BookingDetails) => ContactFieldValues }): ReviewAlerts {
  return {
    bookingRequested(booking) {
      deps.schedule(async () => {
        await sendReviewAlert(booking.requester, deps.fieldsFor(booking), REVIEW_ALERT_TAGS.booking, deps);
      });
    },
    rescheduleRequested(request) {
      const requested = { ...request.booking, startTime: request.requestedStart, endTime: request.requestedEnd };
      deps.schedule(async () => {
        await sendReviewAlert(request.booking.requester, deps.fieldsFor(requested), REVIEW_ALERT_TAGS.reschedule, deps);
      });
    },
  };
}

/** Calls the hook without ever letting it affect the request. */
export function queueReviewAlert(run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error("[review-alerts] could not queue the alert:", error instanceof Error ? error.message : error);
  }
}
