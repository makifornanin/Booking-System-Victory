import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DAY_END_HOUR, DAY_START_HOUR, MAX_BOOKING_MINUTES, SLOT_MINUTES } from "@/lib/config";
import { requireUser } from "@/lib/auth/session";
import { getRepositoryForRequest } from "@/lib/data/queries";
import type { Room } from "@/lib/data/types";
import { buildDaySlots } from "@/lib/domain/availability";
import { canRequestReschedule } from "@/lib/domain/booking-rules";
import { dateKeyInZone, formatDate, formatDateKey, formatTimeRange } from "@/lib/domain/time";
import { ConfigError } from "@/lib/env";
import { getCalendarGateway } from "@/lib/ghl/gateway";
import { bookableDateRange, getRoomDayAvailability } from "@/lib/services/availability";
import { firstParam, parseDateKey, parseUuid } from "@/lib/validation/params";
import { BookingPanel } from "@/components/bookings/booking-panel";
import { MonthCalendar } from "@/components/rooms/month-calendar";
import { SummaryList } from "@/components/admin/summary-list";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Request reschedule" };

export default async function ReschedulePage({ params, searchParams }: PageProps<"/bookings/[id]/reschedule">) {
  const user = await requireUser();
  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const id = parseUuid(rawId);
  if (!id) notFound();

  const repo = await getRepositoryForRequest();
  const [booking, requests] = await Promise.all([repo.getBookingDetails(id), repo.listRescheduleRequestsForBooking(id)]);
  if (!booking || booking.userId !== user.id) notFound();
  const room = await repo.getRoomById(booking.roomId);
  if (!room) notFound();

  const now = new Date();
  const pending = requests.find((r) => r.status === "pending");
  const currentLabel = `${formatDate(booking.startTime, "EEE d MMM")} · ${formatTimeRange(booking.startTime, booking.endTime)}`;
  const back = (
    <Link href="/bookings" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted transition-colors hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden />
      My bookings
    </Link>
  );

  if (!canRequestReschedule(booking, now) || pending) {
    return (
      <div className="space-y-8">
        {back}
        <EmptyState
          title={pending ? "A reschedule request is already waiting" : "This booking can't be rescheduled"}
          description={
            pending
              ? `You asked to move it to ${formatDate(pending.requestedStart, "EEE d MMM")} · ${formatTimeRange(pending.requestedStart, pending.requestedEnd)}. Your current booking stays confirmed until the church office reviews it.`
              : "Only upcoming approved bookings can be rescheduled."
          }
          action={
            <Link href="/bookings" className={buttonStyles({ variant: "secondary" })}>
              Back to my bookings
            </Link>
          }
        />
      </div>
    );
  }

  const { first, last } = bookableDateRange(now);
  const bookingDay = dateKeyInZone(booking.startTime);
  const requested = parseDateKey(firstParam(query.date));
  const dateKey = requested && requested >= first && requested <= last ? requested : bookingDay >= first && bookingDay <= last ? bookingDay : first;
  const durationMinutes = (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / 60_000;

  return (
    <div className="space-y-12">
      <div>
        {back}
        <p className="eyebrow mt-8 text-muted">Request reschedule</p>
        <h1 className="headline mt-3 text-[2.5rem] sm:text-5xl">{booking.eventName}</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          This is a request. Your current booking stays confirmed until the church office approves the new time.
        </p>
      </div>

      <section aria-labelledby="current-heading" className="max-w-xl">
        <h2 id="current-heading" className="mb-3 text-[15px] font-extrabold">
          Current booking
        </h2>
        <SummaryList
          items={[
            { label: "Room", value: `${booking.room.name} (stays the same)` },
            { label: "Date", value: formatDate(booking.startTime, "EEEE, d MMMM yyyy") },
            { label: "Time", value: formatTimeRange(booking.startTime, booking.endTime) },
          ]}
        />
      </section>

      <section aria-labelledby="new-heading">
        <div className="border-b border-ink pb-4">
          <h2 id="new-heading" className="headline text-4xl">
            Choose a new date and time
          </h2>
          <p className="mt-2 text-sm text-muted">Philippine time, 30-minute steps, up to {MAX_BOOKING_MINUTES / 60} hours. Same room: {booking.room.name}.</p>
        </div>
        <div className="mt-8 grid gap-10 lg:grid-cols-[17.5rem_minmax(0,1fr)] xl:gap-14">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="mb-4 text-lg font-extrabold">
              <span className="mr-2 font-serif text-base font-normal text-subtle">1</span>
              Choose a date
            </p>
            <MonthCalendar selected={dateKey} first={first} last={last} hrefFor={(key) => `/bookings/${booking.id}/reschedule?date=${key}`} />
          </div>
          <Suspense key={dateKey} fallback={<Skeleton className="h-96" />}>
            <NewTimePicker room={room} dateKey={dateKey} bookingId={booking.id} durationMinutes={durationMinutes} currentLabel={currentLabel} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

async function NewTimePicker(props: { room: Room; dateKey: string; bookingId: string; durationMinutes: number; currentLabel: string }) {
  const { room, dateKey } = props;
  let slots;
  let problem: string | null = null;
  try {
    const [repo, calendar] = await Promise.all([getRepositoryForRequest(), getCalendarGateway()]);
    // The same availability engine as new bookings (GHL + bookings + held slots).
    const availability = await getRoomDayAvailability(room, dateKey, { repo, calendar, now: () => new Date() }, { forDisplay: true });
    slots = availability.slots;
    problem = availability.problemMessage;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[config] ${error.message}`);
    slots = buildDaySlots({ dateKey, freeRanges: [], busy: [], now: new Date(), slotMinutes: SLOT_MINUTES, dayStartHour: DAY_START_HOUR, dayEndHour: DAY_END_HOUR });
    problem = "Online booking isn't available yet because a required integration isn't configured.";
  }

  return (
    <BookingPanel
      key={dateKey}
      roomId={room.id}
      roomName={room.name}
      capacity={room.capacity}
      dateKey={dateKey}
      dateLabel={formatDateKey(dateKey, "EEEE, d MMMM")}
      slots={slots}
      problem={problem}
      maxMinutes={MAX_BOOKING_MINUTES}
      googleRequired={false}
      googleConnected
      returnTo={`/bookings/${props.bookingId}/reschedule?date=${dateKey}`}
      reschedule={{ bookingId: props.bookingId, durationMinutes: props.durationMinutes, currentLabel: props.currentLabel }}
    />
  );
}
