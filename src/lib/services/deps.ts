import "server-only";
import { getImageStorage, getRepository } from "@/lib/data";
import { getCalendarGateway } from "@/lib/ghl/gateway";
import { getGoogleCalendar } from "@/lib/google/gateway";
import type { AccountDeps } from "@/lib/services/accounts";
import type { AnnouncementDeps } from "@/lib/services/announcements";
import type { BookingServiceDeps } from "@/lib/services/bookings";
import type { CalendarSyncDeps } from "@/lib/services/calendar-sync";

export async function getBookingDeps(): Promise<BookingServiceDeps> {
  const [repo, calendar, google] = await Promise.all([getRepository(), getCalendarGateway(), getGoogleCalendar()]);
  return { repo, calendar, google, now: () => new Date() };
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
