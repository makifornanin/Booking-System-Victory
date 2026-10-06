import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { imageUrl } from "@/lib/data";
import { getRepositoryForRequest } from "@/lib/data/queries";
import { selectLiveAnnouncements } from "@/lib/domain/announcements";
import { formatDate, formatInZone, formatTimeRange } from "@/lib/domain/time";
import { getVerseOfTheDay } from "@/lib/verse";
import { firstName } from "@/lib/utils";
import { PosterBoard, type Poster } from "@/components/announcements/poster-board";
import { VerseOfTheDay } from "@/components/dashboard/verse-of-the-day";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingStatus } from "@/components/ui/status";

export const metadata: Metadata = { title: "Home" };

function greeting(now: Date): string {
  const hour = Number(formatInZone(now, "H"));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  return (
    <div className="space-y-14">
      <section className="grid gap-10 border-b border-line pb-10 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <p className="eyebrow text-muted">{formatDate(now, "EEEE, d MMMM")}</p>
          <h1 className="headline mt-3 text-[2.75rem] sm:text-6xl">
            {greeting(now)}, {firstName(user.fullName)}.
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted">What&apos;s happening around Victory this week.</p>
        </div>
        <Suspense fallback={<Skeleton className="h-24 lg:col-span-4" />}>
          <NextBooking userId={user.id} />
        </Suspense>
      </section>

      <Suspense fallback={<Skeleton className="h-28" />}>
        <Verse />
      </Suspense>

      <div className="border-t border-line pt-14">
        <Suspense fallback={<BulletinSkeleton />}>
          <Bulletin />
        </Suspense>
      </div>
    </div>
  );
}

async function NextBooking({ userId }: { userId: string }) {
  const now = new Date();
  const bookings = await (await getRepositoryForRequest()).listBookingsForUser(userId);
  const next = bookings
    .filter((b) => (b.status === "approved" || b.status === "pending") && new Date(b.endTime) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

  return (
    <aside aria-label="Your next booking" className="lg:col-span-4 lg:border-l lg:border-line lg:pl-8">
      <p className="eyebrow text-muted">Your next booking</p>
      {next ? (
        <div className="mt-3">
          <Link href="/bookings" className="group block">
            <p className="text-lg leading-snug font-extrabold group-hover:text-brand">{next.eventName}</p>
            <p className="mt-1 text-sm text-muted">
              {next.room.name} · {formatDate(next.startTime, "EEE d MMM")} · {formatTimeRange(next.startTime, next.endTime)}
            </p>
          </Link>
          <BookingStatus status={next.status} className="mt-2" />
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-[15px] text-ink-soft">Nothing on the calendar yet.</p>
          <Link href="/rooms" className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-brand underline-offset-4 hover:underline">
            Find a room
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      )}
    </aside>
  );
}

async function Verse() {
  return <VerseOfTheDay verse={await getVerseOfTheDay()} />;
}

async function Bulletin() {
  const now = new Date();
  const announcements = await (await getRepositoryForRequest()).listLiveAnnouncements();
  const posters: Poster[] = selectLiveAnnouncements(announcements, now).flatMap((item) => {
    const url = imageUrl(item.imagePath);
    return url ? [{ id: item.id, title: item.internalTitle, url, orientation: item.orientation }] : [];
  });

  return (
    <section aria-labelledby="bulletin-heading">
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <h2 id="bulletin-heading" className="headline text-3xl">
          This week at Victory
        </h2>
        {posters.length > 0 && <p className="hidden text-sm text-muted sm:block">Select a poster to see it in full</p>}
      </div>
      {posters.length > 0 ? (
        <PosterBoard posters={posters} />
      ) : (
        <EmptyState variant="quiet" title="No announcements this week" description="Posters from the church office will appear here." />
      )}
    </section>
  );
}

function BulletinSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading announcements">
      <Skeleton className="h-9 w-72" />
      <div className="flex flex-wrap gap-5">
        <Skeleton className="aspect-video w-full sm:w-[533px] lg:w-[711px]" />
        <Skeleton className="aspect-[4/5] w-full max-w-[340px] sm:w-[240px] lg:w-[320px]" />
      </div>
    </div>
  );
}
