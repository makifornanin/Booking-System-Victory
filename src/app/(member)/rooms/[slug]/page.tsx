import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DAY_END_HOUR, DAY_START_HOUR, MAX_BOOKING_MINUTES, SLOT_MINUTES } from "@/lib/config";
import { requireUser } from "@/lib/auth/session";
import { imageUrl } from "@/lib/data";
import { getActiveRooms, getRepositoryForRequest } from "@/lib/data/queries";
import type { Room } from "@/lib/data/types";
import { buildDaySlots } from "@/lib/domain/availability";
import { formatDateKey } from "@/lib/domain/time";
import { ConfigError } from "@/lib/env";
import { getCalendarGateway } from "@/lib/ghl/gateway";
import { getGoogleCalendar } from "@/lib/google/gateway";
import { bookableDateRange, getRoomDayAvailability } from "@/lib/services/availability";
import { firstParam, parseDateKey, parseRoomSlug } from "@/lib/validation/params";
import { BookingPanel } from "@/components/bookings/booking-panel";
import { MonthCalendar } from "@/components/rooms/month-calendar";
import { RoomVisual } from "@/components/rooms/room-visual";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";

async function loadRoom(rawSlug: string): Promise<Room> {
  const slug = parseRoomSlug(rawSlug);
  if (!slug) notFound();
  const room = await (await getRepositoryForRequest()).getRoomBySlug(slug);
  if (!room || !room.isActive) notFound();
  return room;
}

export async function generateMetadata({ params }: PageProps<"/rooms/[slug]">): Promise<Metadata> {
  const slug = parseRoomSlug((await params).slug);
  const room = slug ? await (await getRepositoryForRequest()).getRoomBySlug(slug) : null;
  return { title: room?.name ?? "Room" };
}

const googleNotices: Record<string, { tone: "success" | "error" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Google Calendar connected. Approved bookings will appear there automatically." },
  declined: { tone: "warning", text: "Google Calendar wasn't connected. You'll need to connect it to request a room." },
  error: { tone: "error", text: "We couldn't connect Google Calendar. Please try again." },
  no_refresh: { tone: "error", text: "Google didn't grant ongoing access. Remove Victory Booking System at myaccount.google.com/permissions, then connect again." },
  scope: { tone: "error", text: "Calendar permission wasn't granted. Please connect again and allow access to your calendar." },
  unavailable: { tone: "warning", text: "Google Calendar sync isn't set up on this server yet." },
};

export default async function RoomPage({ params, searchParams }: PageProps<"/rooms/[slug]">) {
  const user = await requireUser();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [room, rooms] = await Promise.all([loadRoom(slug), getActiveRooms()]);

  const { first, last } = bookableDateRange(new Date());
  const requested = parseDateKey(firstParam(query.date));
  const dateKey = requested && requested >= first && requested <= last ? requested : first;
  const googleNotice = googleNotices[firstParam(query.google) ?? ""];

  const mapRooms = rooms.map((r) => ({ id: r.id, name: r.name, mapUrl: imageUrl(r.mapImagePath) }));

  return (
    <div className="space-y-16">
      <div>
        <Link href="/rooms" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted transition-colors hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          All rooms
        </Link>

        <div className="mt-8 grid gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <p className="eyebrow text-muted">{room.locationLabel}</p>
            <h1 className="headline mt-3 text-5xl sm:text-6xl">{room.name}</h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-soft">{room.shortDescription}</p>

            <dl className="mt-8 grid grid-cols-2 border-t border-ink text-sm">
              <div className="border-b border-line py-4 pr-4">
                <dt className="eyebrow text-[10px] text-muted">Capacity</dt>
                <dd className="mt-1.5 text-base font-bold">Up to {room.capacity}</dd>
              </div>
              <div className="border-b border-l border-line py-4 pl-4">
                <dt className="eyebrow text-[10px] text-muted">Location</dt>
                <dd className="mt-1.5 text-base font-bold">{room.locationLabel}</dd>
              </div>
              {room.bestFor.length > 0 && (
                <div className="col-span-2 border-b border-line py-4">
                  <dt className="eyebrow text-[10px] text-muted">Best for</dt>
                  <dd className="mt-1.5 text-ink-soft">{room.bestFor.join(" · ")}</dd>
                </div>
              )}
            </dl>
            {room.fullDescription && <p className="mt-6 text-[15px] leading-relaxed text-muted">{room.fullDescription}</p>}
          </div>

          <div className="lg:col-span-7">
            <RoomVisual roomName={room.name} roomId={room.id} photoUrl={imageUrl(room.imagePath)} mapRooms={mapRooms} locationLabel={room.locationLabel} />
          </div>
        </div>
      </div>

      <section id="availability" aria-labelledby="availability-heading" className="scroll-mt-20">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
          <div>
            <h2 id="availability-heading" className="headline text-4xl">
              Request a time
            </h2>
            <p className="mt-2 text-sm text-muted">Times are in Philippine time. Bookings run in 30-minute steps, up to {MAX_BOOKING_MINUTES / 60} hours.</p>
          </div>
        </div>

        {googleNotice && (
          <Notice tone={googleNotice.tone} className="mt-6">
            {googleNotice.text}
          </Notice>
        )}

        <div className="mt-8 grid gap-10 lg:grid-cols-[17.5rem_minmax(0,1fr)] xl:gap-14">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="mb-4 text-lg font-extrabold">
              <span className="mr-2 font-serif text-base font-normal text-subtle">1</span>
              Choose a date
            </p>
            <MonthCalendar selected={dateKey} first={first} last={last} hrefFor={(key) => `/rooms/${room.slug}?date=${key}`} />
          </div>
          <Suspense key={dateKey} fallback={<ScheduleSkeleton />}>
            <RoomSchedule room={room} dateKey={dateKey} userId={user.id} returnTo={`/rooms/${room.slug}?date=${dateKey}`} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

async function loadAvailability(room: Room, dateKey: string, userId: string) {
  try {
    const [repo, calendar, google] = await Promise.all([getRepositoryForRequest(), getCalendarGateway(), getGoogleCalendar()]);
    const [availability, googleConnected] = await Promise.all([
      getRoomDayAvailability(room, dateKey, { repo, calendar, now: () => new Date() }, { forDisplay: true }),
      google.required ? google.isConnected(userId) : Promise.resolve(true),
    ]);
    return { ...availability, googleRequired: google.required, googleConnected };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[config] ${error.message}`);
    const slots = buildDaySlots({ dateKey, freeRanges: [], busy: [], now: new Date(), slotMinutes: SLOT_MINUTES, dayStartHour: DAY_START_HOUR, dayEndHour: DAY_END_HOUR });
    return { slots, problemMessage: "Online booking isn't available yet because a required integration isn't configured.", googleRequired: false, googleConnected: true };
  }
}

async function RoomSchedule({ room, dateKey, userId, returnTo }: { room: Room; dateKey: string; userId: string; returnTo: string }) {
  const availability = await loadAvailability(room, dateKey, userId);
  return (
    <BookingPanel
      key={dateKey}
      roomId={room.id}
      roomName={room.name}
      capacity={room.capacity}
      dateKey={dateKey}
      dateLabel={formatDateKey(dateKey, "EEEE, d MMMM")}
      slots={availability.slots}
      problem={availability.problemMessage}
      maxMinutes={MAX_BOOKING_MINUTES}
      googleRequired={availability.googleRequired}
      googleConnected={availability.googleConnected}
      returnTo={returnTo}
    />
  );
}

function ScheduleSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" aria-busy="true" aria-label="Loading schedule">
      <div className="space-y-3">
        <Skeleton className="h-6 w-56" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 16 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}
