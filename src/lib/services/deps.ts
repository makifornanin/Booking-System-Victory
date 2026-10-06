import "server-only";
import { after } from "next/server";
import { getStatusNotifier } from "@/lib/bot/notifier";
import { getDataMode } from "@/lib/env";
import { getImageStorage, getRepository } from "@/lib/data";
import { getCalendarGateway } from "@/lib/ghl/gateway";
import { getGoogleCalendar } from "@/lib/google/gateway";
import type { AccountDeps } from "@/lib/services/accounts";
import type { AnnouncementDeps } from "@/lib/services/announcements";
import { bookingFieldValues, type BookingServiceDeps } from "@/lib/services/bookings";
import { createReviewAlerts, type ReviewAlerts } from "@/lib/services/review-alerts";
import type { CalendarGateway } from "@/lib/ghl/gateway";
import type { CalendarSyncDeps } from "@/lib/services/calendar-sync";

export async function getBookingDeps(): Promise<BookingServiceDeps> {
  const [repo, calendar, google] = await Promise.all([getRepository(), getCalendarGateway(), getGoogleCalendar()]);
  return { repo, calendar, google, now: () => new Date(), notifier: getStatusNotifier(), reviewAlerts: getReviewAlerts(calendar) };
}

export async function getAccountDeps(): Promise<AccountDeps> {
  const [repo, calendar] = await Promise.all([getRepository(), getCalendarGateway()]);
  return { repo, calendar };
}

export async function getCalendarSyncDeps(): Promise<CalendarSyncDeps> {
  const [repo, google] = await Promise.all([getRepository(), getGoogleCalendar()]);
  return { repo, google };
}

export async function getAnnouncementDeps(): Promise<AnnouncementDeps> {
  const [repo, storage] = await Promise.all([getRepository(), getImageStorage()]);
  return { repo, storage };
}

/** Internal "pending review" GHL alerts, sent after the response so requests never wait for GHL. */
export function getReviewAlerts(calendar: CalendarGateway): ReviewAlerts {
  return createReviewAlerts({
    calendar,
    schedule: (task) => after(task),
    fieldsFor: (booking) => bookingFieldValues(booking),
    async saveGhlContactId(userId, contactId) {
      if (getDataMode() === "demo") {
        const { getDemoState } = await import("@/lib/demo/store");
        const user = getDemoState().users.find((u) => u.id === userId);
        if (user) user.ghlContactId = contactId;
        return;
      }
      const { systemQuery } = await import("@/lib/db/client");
      await systemQuery("update public.profiles set ghl_contact_id = $2 where id = $1", [userId, contactId]);
    },
  });
}
