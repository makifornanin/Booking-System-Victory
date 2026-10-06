import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { getActiveRooms, getBookingCounts, getRepositoryForRequest, getUserCounts } from "@/lib/data/queries";
import { formatPhone } from "@/lib/domain/phone";
import { addDaysToKey, dateKeyInZone, formatDate, formatTimeRange, zonedDayRange } from "@/lib/domain/time";
import { RoomUsageTimeline } from "@/components/admin/room-usage-timeline";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Admin overview" };

function Panel({ title, count, href, children }: { title: string; count?: number; href?: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b border-ink pb-2.5">
        <h2 className="text-[15px] font-extrabold">
          {title}
          {count !== undefined && <span className="ml-2 font-semibold text-muted tabular-nums">{count}</span>}
        </h2>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-bold text-brand hover:underline">
            View all
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const repo = await getRepositoryForRequest();
  const now = new Date();
  const today = dateKeyInZone(now);
  const { start: dayStart, end: dayEnd } = zonedDayRange(today);
  const weekEnd = zonedDayRange(addDaysToKey(today, 7)).start;

  const [bookingCounts, userCounts, pending, pendingUsers, todays, upcoming, rooms] = await Promise.all([
    getBookingCounts(),
    getUserCounts(),
    repo.listBookingsByStatus("pending", 6),
    repo.listUsers("pending"),
    repo.listBookingsBetween(dayStart, dayEnd, ["pending", "approved"]),
    repo.listBookingsBetween(now, weekEnd, ["approved"]),
    getActiveRooms(),
  ]);

  return (
    <div className="space-y-12">
      <PageHeader variant="operational" eyebrow={formatDate(now, "EEEE, d MMMM")} title="Overview" />

      <div className="grid gap-10 xl:grid-cols-2">
        <Panel title="Booking requests" count={bookingCounts.pending} href="/admin/bookings">
          {pending.length > 0 ? (
            <ul className="divide-y divide-line">
              {pending.map((booking) => (
                <li key={booking.id} className="relative flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/bookings/${booking.id}`} className="block truncate text-sm font-bold after:absolute after:inset-0 hover:text-brand">
                      {booking.eventName}
                    </Link>
                    <p className="truncate text-[13px] text-muted">
                      {booking.requester.fullName} · {booking.room.name}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink-soft">
                    {formatDate(booking.startTime, "EEE d MMM")}
                    <span className="block font-normal text-muted">{formatTimeRange(booking.startTime, booking.endTime)}</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-muted">No requests waiting. New ones appear here.</p>
          )}
        </Panel>

        <Panel title="Accounts awaiting approval" count={userCounts.pending} href="/admin/users">
          {pendingUsers.length > 0 ? (
            <ul className="divide-y divide-line">
              {pendingUsers.slice(0, 6).map((user) => (
                <li key={user.id} className="relative flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/users/${user.id}`} className="block truncate text-sm font-bold after:absolute after:inset-0 hover:text-brand">
                      {user.fullName || "Unnamed"}
                    </Link>
                    <p className="truncate text-[13px] text-muted">
                      {user.email} · {formatPhone(user.phone)}
                    </p>
                  </div>
                  <p className="shrink-0 text-[13px] text-muted">Joined {formatDate(user.createdAt, "d MMM")}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-muted">No accounts waiting for approval.</p>
          )}
        </Panel>
      </div>

      <Panel title="Today's rooms" count={todays.length}>
        <div className="pt-4">
          <RoomUsageTimeline dateKey={today} rooms={rooms} bookings={todays} now={now} />
          {todays.length === 0 && <p className="mt-3 text-sm text-muted">No rooms are booked today.</p>}
        </div>
      </Panel>

      <Panel title="Next 7 days" count={upcoming.length} href="/admin/bookings?status=approved">
        {upcoming.length > 0 ? (
          <ul className="divide-y divide-line">
            {upcoming.map((booking) => (
              <li key={booking.id} className="relative grid gap-1 py-3 sm:grid-cols-[13rem_7rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className="text-sm font-semibold tabular-nums">
                  {formatDate(booking.startTime, "EEE d MMM")} · {formatTimeRange(booking.startTime, booking.endTime)}
                </span>
                <span className="text-sm text-muted">{booking.room.name}</span>
                <Link href={`/admin/bookings/${booking.id}`} className="truncate text-sm font-bold after:absolute after:inset-0 hover:text-brand">
                  {booking.eventName}
                </Link>
                <span className="text-[13px] text-muted">{booking.requester.fullName}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-sm text-muted">No approved bookings in the next 7 days.</p>
        )}
      </Panel>
    </div>
  );
}
