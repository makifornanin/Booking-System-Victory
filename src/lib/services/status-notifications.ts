import type { SessionUser } from "@/lib/auth/provider";
import type { Repository } from "@/lib/data/repository";
import type { BookingDetails } from "@/lib/data/types";
import { failure, success, type ServiceResult } from "@/lib/services/result";
import type { BookingStatusChange } from "@/lib/services/status-notifier";
import { bookingIdSchema } from "@/lib/validation/booking";

export interface StatusNotificationDeps {
  repo: Repository;
  /** Null when no n8n status webhook is configured. */
  deliver: ((booking: BookingDetails, status: BookingStatusChange) => Promise<string | null>) | null;
  record: (bookingId: string, status: BookingStatusChange, error: string | null) => Promise<void>;
}

/** Admin: re-sends the WhatsApp status notification for a booking's current status. */
export async function retryStatusNotification(rawInput: unknown, actor: SessionUser | null, deps: StatusNotificationDeps): Promise<ServiceResult> {
  if (!actor) return failure("unauthenticated", "Your session has expired. Please sign in again.");
  if (actor.role !== "admin" || actor.accessStatus !== "active") return failure("forbidden", "Only admins can resend notifications.");
  const parsed = bookingIdSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown booking.");

  const booking = await deps.repo.getBookingDetails(parsed.data.bookingId);
  if (!booking) return failure("not_found", "We couldn't find that booking.");
  if (booking.source !== "whatsapp") return failure("invalid", "Only WhatsApp bookings send status notifications.");
  if (booking.status === "pending") return failure("invalid", "Pending requests don't send a status notification.");
  if (!deps.deliver) return failure("calendar_error", "The n8n status webhook isn't configured on this server.");

  const error = await deps.deliver(booking, booking.status);
  await deps.record(booking.id, booking.status, error);
  return error ? failure("calendar_error", `The notification failed again: ${error}`) : success(undefined, "WhatsApp notification sent.");
}
