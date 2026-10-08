import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck2 } from "lucide-react";
import { eventTypeLabel } from "@/lib/config";
import { requireAdmin } from "@/lib/auth/session";
import { getRepositoryForRequest } from "@/lib/data/queries";
import { isPastDue, PAST_DUE_MESSAGE } from "@/lib/domain/booking-rules";
import { formatPhone } from "@/lib/domain/phone";
import { dateKeyInZone, formatDate, formatTimeRange, zonedDayRange } from "@/lib/domain/time";
import { parseUuid } from "@/lib/validation/params";
import { ReviewActions } from "@/components/admin/review-actions";
import { SummaryList } from "@/components/admin/summary-list";
import { CancelBookingButton, RetryCalendarSyncButton, RetryDenialEmailButton, RetryStatusNotificationButton } from "@/components/bookings/booking-actions";
import { Notice } from "@/components/ui/notice";
import { BookingStatus } from "@/components/ui/status";

export const metadata: Metadata = { title: "Booking request" };

export default async function AdminBookingPage({ params }: PageProps<"/admin/bookings/[id]">) {
  await requireAdmin();
  const id = parseUuid((await params).id);
  if (!id) notFound();

  const repo = await getRepositoryForRequest();
  const booking = await repo.getBookingDetails(id);
  if (!booking) notFound();

  const { start, end } = zonedDayRange(dateKeyInZone(booking.startTime));
  const [room, sameDay, reschedules] = await Promise.all([
    repo.getRoomById(booking.roomId),
    repo.listBookingsBetween(start, end, ["pending", "approved"]),
    repo.listRescheduleRequestsForBooking(booking.id),
  ]);
  const pendingReschedule = reschedules.find((r) => r.status === "pending");
  const slot = (from: string, to: string) => `${formatDate(from, "EEE d MMM")} · ${formatTimeRange(from, to)}`;
  const roomDay = sameDay.filter((b) => b.roomId === booking.roomId);
  const now = new Date();
  const isPending = booking.status === "pending";
  const pastDue = isPastDue(booking, now);
  const isUpcoming = new Date(booking.startTime) > now;
  const overCapacity = room && booking.attendeeCount > room.capacity;
  const dateLabel = formatDate(booking.startTime, "EEEE, d MMMM yyyy");
  const timeLabel = formatTimeRange(booking.startTime, booking.endTime);

  const details: { label: string; value: ReactNode }[] = [
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
    { label: "Room", value: `${booking.room.name}${room ? ` · up to ${room.capacity}` : ""}` },
    { label: "Event type", value: eventTypeLabel(booking.eventType) },
    { label: "Attendees", value: booking.attendeeCount },
    { label: "Purpose", value: <span className="font-normal whitespace-pre-line">{booking.purpose}</span> },
    { label: "Submitted", value: formatDate(booking.createdAt, "d MMM yyyy, h:mm a") },
    { label: "Source", value: booking.source === "whatsapp" ? "WhatsApp assistant" : "Website" },
  ];
  if (booking.reviewedAt) {
    details.push({
      label: booking.status === "denied" ? "Denied" : "Reviewed",
      value: `${formatDate(booking.reviewedAt, "d MMM yyyy, h:mm a")}${booking.reviewer ? ` by ${booking.reviewer.fullName}` : ""}`,
    });
  }
  if (booking.ghlAppointmentId) details.push({ label: "GHL appointment", value: <code className="text-xs font-normal">{booking.ghlAppointmentId}</code> });

  return (
    <div className="space-y-8">
      <Link href="/admin/bookings" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Booking requests
      </Link>

      <header className="flex flex-col gap-5 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <BookingStatus status={booking.status} pastDue={pastDue} />
          <h1 className="title mt-2 text-3xl">{booking.eventName}</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            {booking.room.name} · {dateLabel} · {timeLabel} · {booking.requester.fullName}
          </p>
        </div>
        {isPending ? (
          <ReviewActions
            bookingId={booking.id}
            pastDue={pastDue}
            summary={{ event: booking.eventName, room: booking.room.name, date: dateLabel, time: timeLabel, requester: `${booking.requester.fullName} (${booking.requester.email})` }}
          />
        ) : booking.status === "approved" && isUpcoming ? (
          <CancelBookingButton bookingId={booking.id} eventName={booking.eventName} approved label="Cancel booking" />
        ) : null}
      </header>

      {pastDue && (
        <Notice tone="warning" title="Past due">
          {PAST_DUE_MESSAGE} Closing it records it as denied and emails the requester your note.
        </Notice>
      )}
      {booking.status === "denied" && booking.denialReason && (
        <Notice tone="error" title="Denial reason">
          {booking.denialReason}
        </Notice>
      )}
      {booking.status === "denied" && booking.ghlNotificationError && (
        <Notice tone="warning" title="Booking denied, but the notification could not be sent." action={<RetryDenialEmailButton bookingId={booking.id} />}>
          {booking.ghlNotificationError}
        </Notice>
      )}
      {isPending && !pastDue && overCapacity && <Notice tone="warning">This request is for more people than the room holds ({room.capacity}).</Notice>}
      {pendingReschedule && (
        <Notice
          tone="info"
          title="Reschedule requested"
          action={
            <Link href={`/admin/bookings/reschedule/${pendingReschedule.id}`} className="text-sm font-bold underline">
              Review
            </Link>
          }
        >
          The member asked to move this booking to {slot(pendingReschedule.requestedStart, pendingReschedule.requestedEnd)}. It stays as shown until you approve.
        </Notice>
      )}
      {booking.status === "approved" && booking.googleCalendarSyncError && (
        <Notice tone="warning" title="Booking approved, but Google Calendar sync failed." action={<RetryCalendarSyncButton bookingId={booking.id} />}>
          {booking.googleCalendarSyncError}
        </Notice>
      )}
      {booking.source === "whatsapp" && booking.statusNotificationError && booking.status !== "pending" && (
        <Notice tone="warning" title="The WhatsApp status message couldn’t be sent." action={<RetryStatusNotificationButton bookingId={booking.id} />}>
          {booking.statusNotificationError}. The {booking.status === "approved" ? "approval" : booking.status === "denied" ? "denial" : "cancellation"} itself is saved.
        </Notice>
      )}
      {booking.status === "approved" && booking.googleCalendarEventId && !booking.googleCalendarSyncError && (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-approved">
          <CalendarCheck2 className="size-4" aria-hidden />
          On the member&apos;s Google Calendar
        </p>
      )}

      <div className="grid gap-10 lg:grid-cols-12">
        <section aria-labelledby="details-heading" className="lg:col-span-7">
          <h2 id="details-heading" className="mb-3 text-[15px] font-extrabold">
            Request
          </h2>
          <SummaryList items={details} />
          {reschedules.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-2 text-[13px] font-extrabold">Reschedule history</h3>
              <ul className="divide-y divide-line border-y border-line text-[13px]">
                {reschedules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
                    <Link href={`/admin/bookings/reschedule/${r.id}`} className="font-semibold hover:text-brand">
                      {slot(r.originalStart, r.originalEnd)} → {slot(r.requestedStart, r.requestedEnd)}
                    </Link>
                    <span className="text-muted">
                      {r.status === "pending" ? "Pending review" : r.status === "approved" ? "Approved" : r.status === "denied" ? "Denied" : "Withdrawn"} · {formatDate(r.createdAt, "d MMM")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="space-y-10 lg:col-span-5">
          <section aria-labelledby="requester-heading">
            <h2 id="requester-heading" className="mb-3 text-[15px] font-extrabold">
              Requested by
            </h2>
            <SummaryList
              items={[
                { label: "Name", value: <Link href={`/admin/users/${booking.requester.id}`} className="text-brand hover:underline">{booking.requester.fullName}</Link> },
                { label: "Email", value: <a href={`mailto:${booking.requester.email}`} className="hover:underline">{booking.requester.email}</a> },
                { label: "Mobile", value: booking.requester.phone ? <a href={`tel:${booking.requester.phone}`} className="hover:underline">{formatPhone(booking.requester.phone)}</a> : "—" },
              ]}
            />
          </section>

          <section aria-labelledby="sameday-heading">
            <h2 id="sameday-heading" className="mb-3 text-[15px] font-extrabold">
              {booking.room.name} that day
            </h2>
            <ul className="divide-y divide-line border-y border-line">
              {roomDay.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold tabular-nums">{formatTimeRange(b.startTime, b.endTime)}</p>
                    <p className="truncate text-[13px] text-muted">{b.id === booking.id ? "This request" : `${b.eventName} · ${b.requester.fullName}`}</p>
                  </div>
                  <BookingStatus status={b.status} />
                </li>
              ))}
              {roomDay.length === 0 && <li className="py-3 text-sm text-muted">No other bookings that day.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
