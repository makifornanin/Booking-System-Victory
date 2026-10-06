import type { BookingDetails } from "@/lib/data/types";

export type BookingStatusChange = "approved" | "denied" | "cancelled";

/**
 * Tells the WhatsApp assistant (n8n) that a WhatsApp booking changed status.
 * Implementations only act on bookings with source "whatsapp", run after the
 * response is sent, and never throw: a failed notification must not affect
 * the approval, denial or cancellation that triggered it.
 */
export interface BookingStatusNotifier {
  bookingStatusChanged(booking: BookingDetails, status: BookingStatusChange): void;
}

export function notifyStatusChange(notifier: BookingStatusNotifier | undefined, booking: BookingDetails, status: BookingStatusChange): void {
  if (!notifier || booking.source !== "whatsapp") return;
  try {
    notifier.bookingStatusChanged(booking, status);
  } catch (error) {
    console.error(`[notify] could not queue ${status} notification for booking ${booking.id}:`, error instanceof Error ? error.message : error);
  }
}
