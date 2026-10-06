import "server-only";
import { after } from "next/server";
import { getDataMode, getStatusWebhookConfig } from "@/lib/env";
import { createStatusNotifier } from "@/lib/bot/status-webhook";
import type { BookingStatusChange, BookingStatusNotifier } from "@/lib/services/status-notifier";

/** Stores the latest notification result on the booking (server-only columns). */
export async function recordStatusNotification(bookingId: string, status: BookingStatusChange, error: string | null): Promise<void> {
  if (getDataMode() === "demo") {
    const { getDemoState } = await import("@/lib/demo/store");
    const booking = getDemoState().bookings.find((b) => b.id === bookingId);
    if (booking) {
      booking.statusNotificationStatus = status;
      booking.statusNotificationError = error;
      if (!error) booking.statusNotifiedAt = new Date().toISOString();
    }
    return;
  }
  const { systemQuery } = await import("@/lib/db/client");
  await systemQuery(
    `update public.bookings
        set status_notification_status = $2,
            status_notification_error = $3,
            status_notified_at = case when $3::text is null then now() else status_notified_at end
      where id = $1`,
    [bookingId, status, error],
  );
}

/** The n8n status notifier, or undefined when N8N_STATUS_WEBHOOK_URL isn't configured. */
export function getStatusNotifier(): BookingStatusNotifier | undefined {
  const config = getStatusWebhookConfig();
  if (!config) return undefined;
  return createStatusNotifier({ ...config, schedule: (task) => after(task), record: recordStatusNotification });
}
