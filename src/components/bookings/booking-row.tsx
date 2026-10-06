import Link from "next/link";
import { CalendarCheck2, CalendarX2 } from "lucide-react";
import { eventTypeLabel } from "@/lib/config";
import type { BookingWithRoom } from "@/lib/data/types";
import { canMemberCancel } from "@/lib/domain/booking-rules";
import { formatDate, formatTimeRange } from "@/lib/domain/time";
import { cn } from "@/lib/utils";
import { CancelBookingButton, RetryCalendarSyncButton } from "@/components/bookings/booking-actions";
import { BookingStatus } from "@/components/ui/status";

/** Serif day numeral with the weekday underneath, like a printed calendar column. */
export function DateColumn({ iso, muted }: { iso: string; muted?: boolean }) {
  return (
    <div className={cn("w-12 text-center", muted ? "text-subtle" : "text-ink")}>
      <span className="block font-serif text-[2rem] leading-none tabular-nums">{formatDate(iso, "d")}</span>
      <span className="eyebrow mt-1.5 block text-[10px] text-muted">{formatDate(iso, "EEE")}</span>
    </div>
  );
}

function CalendarSyncLine({ booking, showRetry }: { booking: BookingWithRoom; showRetry: boolean }) {
  if (booking.status !== "approved") return null;
  if (booking.googleCalendarEventId) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-approved">
        <CalendarCheck2 className="size-3.5" aria-hidden />
        On your Google Calendar
      </p>
    );
  }
  if (!booking.googleCalendarSyncError) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-pending">
        <CalendarX2 className="size-3.5" aria-hidden />
        Approved, but Google Calendar sync failed.
      </p>
      {showRetry && <RetryCalendarSyncButton bookingId={booking.id} />}
    </div>
  );
}

export function BookingRow({
  booking,
  now,
  highlight,
  showActions = true,
  detailHref,
}: {
  booking: BookingWithRoom;
  now: Date;
  highlight?: boolean;
  showActions?: boolean;
  detailHref?: string;
}) {
  const past = new Date(booking.endTime) <= now;
  const muted = past || booking.status === "cancelled" || booking.status === "denied";
  return (
    <li
      id={`booking-${booking.id}`}
      className={cn("grid grid-cols-[3rem_minmax(0,1fr)] gap-x-5 gap-y-3 py-6 sm:grid-cols-[3rem_minmax(0,1fr)_auto]", highlight && "animate-fade-up")}
    >
      <DateColumn iso={booking.startTime} muted={muted} />
      <div className="min-w-0">
        <p className={cn("text-[17px] leading-snug font-extrabold", muted && "text-ink-soft")}>
          {detailHref ? (
            <Link href={detailHref} className="hover:text-brand">
              {booking.eventName}
            </Link>
          ) : (
            booking.eventName
          )}
          {highlight && <span className="ml-2 align-middle text-xs font-extrabold text-accent-ink">New</span>}
        </p>
        <p className="mt-1 text-sm text-muted">
          {booking.room.slug ? (
            <Link href={`/rooms/${booking.room.slug}`} className="font-semibold text-ink-soft hover:text-brand">
              {booking.room.name}
            </Link>
          ) : (
            booking.room.name
          )}{" "}
          · <span className="tabular-nums">{formatTimeRange(booking.startTime, booking.endTime)}</span> · {eventTypeLabel(booking.eventType)} · {booking.attendeeCount}{" "}
          {booking.attendeeCount === 1 ? "person" : "people"}
        </p>
        {booking.status === "denied" && booking.denialReason && (
          <p className="mt-3 border-l-2 border-denied pl-3 text-sm leading-relaxed text-ink-soft">
            <span className="font-bold text-denied">Reason · </span>
            {booking.denialReason}
          </p>
        )}
        <CalendarSyncLine booking={booking} showRetry={showActions} />
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-auto sm:flex-col sm:items-end sm:justify-start">
        <BookingStatus status={booking.status} />
        {showActions && canMemberCancel(booking, now) && (
          <CancelBookingButton bookingId={booking.id} eventName={booking.eventName} approved={booking.status === "approved"} label={booking.status === "approved" ? "Cancel booking" : "Withdraw"} />
        )}
      </div>
    </li>
  );
}
