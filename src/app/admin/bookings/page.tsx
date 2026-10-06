import type { Metadata } from "next";
import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import { eventTypeLabel } from "@/lib/config";
import { requireAdmin } from "@/lib/auth/session";
import { getBookingCounts, getRepositoryForRequest } from "@/lib/data/queries";
import type { BookingDetails } from "@/lib/data/types";
import { formatPhone } from "@/lib/domain/phone";
import { formatDate, formatTimeRange } from "@/lib/domain/time";
import { adminBookingTabSchema, firstParam } from "@/lib/validation/params";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Booking requests" };

const tabs = [
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "denied", label: "Denied" },
] as const;

const empty = {
  pending: { title: "You're all caught up", description: "New booking requests will appear here." },
  approved: { title: "No approved bookings", description: "Approved bookings will be listed here." },
  denied: { title: "No denied requests", description: "Requests you deny are listed here with their reasons." },
};

function orderApproved(list: BookingDetails[], now: Date): BookingDetails[] {
  const upcoming = list.filter((b) => new Date(b.endTime) > now);
  const past = list.filter((b) => new Date(b.endTime) <= now).reverse();
  return [...upcoming, ...past];
}

export default async function AdminBookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  await requireAdmin();
  const status = adminBookingTabSchema.parse(firstParam((await searchParams).status));
  const now = new Date();
  const [list, counts] = await Promise.all([(await getRepositoryForRequest()).listBookingsByStatus(status, 200), getBookingCounts()]);
  const bookings = status === "approved" ? orderApproved(list, now) : list;

  return (
    <div>
      <PageHeader
        variant="operational"
        title="Booking requests"
        description="Approving adds the reservation to the room's GHL calendar (GHL emails the requester) and to their Google Calendar. Denying requires a reason."
      />

      <LinkTabs
        label="Request status"
        tabs={tabs.map((tab) => ({
          href: tab.status === "pending" ? "/admin/bookings" : `/admin/bookings?status=${tab.status}`,
          label: tab.label,
          count: counts[tab.status],
          active: tab.status === status,
        }))}
      />

      {bookings.length === 0 ? (
        <EmptyState className="mt-10" {...empty[status]} />
      ) : (
        <ul className="divide-y divide-line border-b border-line">
          <li className="hidden grid-cols-[9.5rem_minmax(0,1fr)_8rem_minmax(0,13rem)_7rem] gap-6 py-2.5 text-xs font-bold text-muted lg:grid" aria-hidden>
            <span>When</span>
            <span>Request</span>
            <span>Room</span>
            <span>Requested by</span>
            <span className="text-right">{status === "denied" ? "Reviewed" : "Submitted"}</span>
          </li>
          {bookings.map((booking) => {
            const past = new Date(booking.endTime) <= now;
            return (
              <li
                key={booking.id}
                className="group relative grid gap-x-6 gap-y-1 py-4 transition-colors hover:bg-sunken/40 lg:grid-cols-[9.5rem_minmax(0,1fr)_8rem_minmax(0,13rem)_7rem] lg:items-center lg:py-3.5"
              >
                <div className={past ? "text-muted" : undefined}>
                  <p className="text-sm font-bold tabular-nums">{formatDate(booking.startTime, "EEE d MMM")}</p>
                  <p className="text-[13px] tabular-nums text-muted">{formatTimeRange(booking.startTime, booking.endTime)}</p>
                </div>
                <div className="min-w-0">
                  <Link href={`/admin/bookings/${booking.id}`} className="block truncate text-[15px] font-extrabold after:absolute after:inset-0 group-hover:text-brand">
                    {booking.eventName}
                  </Link>
                  <p className="truncate text-[13px] text-muted">
                    {eventTypeLabel(booking.eventType)} · {booking.attendeeCount} people
                    {status === "denied" && booking.denialReason ? ` · “${booking.denialReason}”` : ""}
                  </p>
                  {status === "approved" && booking.googleCalendarSyncError && !booking.googleCalendarEventId && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-pending">
                      <CalendarX2 className="size-3.5" aria-hidden />
                      Google Calendar sync failed
                    </p>
                  )}
                </div>
                <p className="text-sm text-ink-soft">{booking.room.name}</p>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{booking.requester.fullName}</p>
                  <p className="truncate text-[13px] text-muted">{formatPhone(booking.requester.phone)}</p>
                </div>
                <p className="text-xs text-muted lg:text-right">
                  {formatDate(status === "denied" && booking.reviewedAt ? booking.reviewedAt : booking.createdAt, "d MMM, h:mm a")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
