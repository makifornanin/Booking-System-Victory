import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarX2, MailWarning, MessageCircle } from "lucide-react";
import { z } from "zod";
import { eventTypeLabel } from "@/lib/config";
import { requireAdmin } from "@/lib/auth/session";
import { getBookingCounts, getRepositoryForRequest } from "@/lib/data/queries";
import type { BookingDetails, RescheduleRequestDetails } from "@/lib/data/types";
import { formatPhone } from "@/lib/domain/phone";
import { formatDate, formatTimeRange } from "@/lib/domain/time";
import { adminBookingTabSchema, firstParam } from "@/lib/validation/params";
import { cn } from "@/lib/utils";
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
  pending: { title: "You're all caught up", description: "New booking and reschedule requests will appear here." },
  approved: { title: "No approved bookings", description: "Approved bookings and reschedules will be listed here." },
  denied: { title: "No denied requests", description: "Requests you deny are listed here with their reasons." },
};

const sourceSchema = z.enum(["all", "web", "whatsapp"]).catch("all");
const SOURCES = [
  { value: "all", label: "All sources" },
  { value: "web", label: "Web" },
  { value: "whatsapp", label: "WhatsApp" },
] as const;

type Item = { kind: "booking"; booking: BookingDetails } | { kind: "reschedule"; request: RescheduleRequestDetails };

const startOf = (item: Item) => (item.kind === "booking" ? item.booking.startTime : item.request.requestedStart);
const endOf = (item: Item) => (item.kind === "booking" ? item.booking.endTime : item.request.requestedEnd);
const reviewedOf = (item: Item) => (item.kind === "booking" ? item.booking.reviewedAt : item.request.reviewedAt) ?? "";

/** A pending request whose (requested) start has passed: it can only be closed. */
const isStale = (item: Item, now: Date) => new Date(startOf(item)) <= now;

function order(items: Item[], status: "pending" | "approved" | "denied", now: Date): Item[] {
  if (status === "denied") return [...items].sort((a, b) => reviewedOf(b).localeCompare(reviewedOf(a)));
  const ascending = [...items].sort((a, b) => startOf(a).localeCompare(startOf(b)));
  // Requests that can still be approved come first; past-due ones wait below to be closed.
  if (status === "pending") return [...ascending.filter((item) => !isStale(item, now)), ...ascending.filter((item) => isStale(item, now))];
  const upcoming = ascending.filter((item) => new Date(endOf(item)) > now);
  const past = ascending.filter((item) => new Date(endOf(item)) <= now).reverse();
  return [...upcoming, ...past];
}

export default async function AdminBookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  await requireAdmin();
  const params = await searchParams;
  const status = adminBookingTabSchema.parse(firstParam(params.status));
  const source = sourceSchema.parse(firstParam(params.source));
  const now = new Date();
  const repo = await getRepositoryForRequest();
  const [bookings, reschedules, counts] = await Promise.all([repo.listBookingsByStatus(status, 200), repo.listRescheduleRequestsByStatus(status, 100), getBookingCounts()]);

  const all: Item[] = [
    ...bookings.map((booking): Item => ({ kind: "booking", booking })),
    ...reschedules.map((request): Item => ({ kind: "reschedule", request })),
  ];
  const sourceOf = (item: Item) => (item.kind === "booking" ? item.booking.source : item.request.booking.source);
  const items = order(source === "all" ? all : all.filter((item) => sourceOf(item) === source), status, now);
  const firstPastDue = status === "pending" ? items.findIndex((item) => isStale(item, now)) : -1;
  const hrefFor = (s: string, src: string) => {
    const query = new URLSearchParams();
    if (s !== "pending") query.set("status", s);
    if (src !== "all") query.set("source", src);
    const qs = query.toString();
    return qs ? `/admin/bookings?${qs}` : "/admin/bookings";
  };

  return (
    <div>
      <PageHeader
        variant="operational"
        title="Booking requests"
        description="Approving a booking adds it to the room's GHL calendar (GHL emails the requester) and to their Google Calendar. Approving a reschedule moves that appointment and event. Denying requires a reason."
      />

      <LinkTabs
        label="Request status"
        tabs={tabs.map((tab) => ({
          href: hrefFor(tab.status, source),
          label: tab.label,
          count: counts[tab.status],
          active: tab.status === status,
        }))}
      />

      <nav aria-label="Filter by source" className="flex justify-end gap-4 pt-3 text-[13px]">
        {SOURCES.map((option) => (
          <Link
            key={option.value}
            href={hrefFor(status, option.value)}
            scroll={false}
            aria-current={option.value === source ? "true" : undefined}
            className={cn("font-semibold", option.value === source ? "text-ink" : "text-muted hover:text-ink")}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState className="mt-10" {...(source === "all" ? empty[status] : { title: "Nothing from this source", description: "Try another source filter." })} />
      ) : (
        <ul className="divide-y divide-line border-b border-line">
          <li className="hidden grid-cols-[9.5rem_minmax(0,1fr)_8rem_minmax(0,13rem)_7rem] gap-6 py-2.5 text-xs font-bold text-muted lg:grid" aria-hidden>
            <span>When</span>
            <span>Request</span>
            <span>Room</span>
            <span>Requested by</span>
            <span className="text-right">{status === "denied" ? "Reviewed" : "Submitted"}</span>
          </li>
          {items.map((item, index) => (
            <Fragment key={item.kind === "booking" ? item.booking.id : item.request.id}>
              {index === firstPastDue && (
                <li className="pt-8 pb-2.5">
                  <h2 className="text-[13px] font-extrabold">Past due</h2>
                  <p className="text-[13px] text-muted">The start time passed before these were reviewed, so they can only be closed.</p>
                </li>
              )}
              {item.kind === "booking" ? (
                <BookingItem booking={item.booking} status={status} now={now} />
              ) : (
                <RescheduleItem request={item.request} status={status} now={now} />
              )}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}

const rowClass = "group relative grid gap-x-6 gap-y-1 py-4 transition-colors hover:bg-sunken/40 lg:grid-cols-[9.5rem_minmax(0,1fr)_8rem_minmax(0,13rem)_7rem] lg:items-center lg:py-3.5";

function TypeLabel({ kind }: { kind: "booking" | "reschedule" }) {
  return <p className={cn("eyebrow text-[10px]", kind === "reschedule" ? "text-accent-ink" : "text-subtle")}>{kind === "reschedule" ? "Reschedule" : "New booking"}</p>;
}

function WhatsAppMark() {
  return (
    <span className="mr-1.5 inline-flex items-center gap-1 font-semibold text-ink-soft">
      <MessageCircle className="size-3" aria-hidden />
      WhatsApp ·
    </span>
  );
}

function BookingItem({ booking, status, now }: { booking: BookingDetails; status: "pending" | "approved" | "denied"; now: Date }) {
  const past = new Date(booking.endTime) <= now;
  return (
    <li className={rowClass}>
      <div className={past ? "text-muted" : undefined}>
        <p className="text-sm font-bold tabular-nums">{formatDate(booking.startTime, "EEE d MMM")}</p>
        <p className="text-[13px] tabular-nums text-muted">{formatTimeRange(booking.startTime, booking.endTime)}</p>
      </div>
      <div className="min-w-0">
        <TypeLabel kind="booking" />
        <Link href={`/admin/bookings/${booking.id}`} className="block truncate text-[15px] font-extrabold after:absolute after:inset-0 group-hover:text-brand">
          {booking.eventName}
        </Link>
        <p className="truncate text-[13px] text-muted">
          {booking.source === "whatsapp" && <WhatsAppMark />}
          {eventTypeLabel(booking.eventType)} · {booking.attendeeCount} people
          {status === "denied" && booking.denialReason ? ` · “${booking.denialReason}”` : ""}
        </p>
        {status === "approved" && booking.googleCalendarSyncError && (
          <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-pending">
            <CalendarX2 className="size-3.5" aria-hidden />
            Google Calendar sync failed
          </p>
        )}
        {status === "denied" && booking.ghlNotificationError && (
          <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-pending">
            <MailWarning className="size-3.5" aria-hidden />
            Denial email not sent
          </p>
        )}
      </div>
      <p className="text-sm text-ink-soft">{booking.room.name}</p>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{booking.requester.fullName}</p>
        <p className="truncate text-[13px] text-muted">{formatPhone(booking.requester.phone)}</p>
      </div>
      <p className="text-xs text-muted lg:text-right">{formatDate(status === "denied" && booking.reviewedAt ? booking.reviewedAt : booking.createdAt, "d MMM, h:mm a")}</p>
    </li>
  );
}

function RescheduleItem({ request, status, now }: { request: RescheduleRequestDetails; status: "pending" | "approved" | "denied"; now: Date }) {
  const booking = request.booking;
  const past = new Date(request.requestedEnd) <= now;
  return (
    <li className={rowClass}>
      <div className={past ? "text-muted" : undefined}>
        <p className="text-sm font-bold tabular-nums">{formatDate(request.requestedStart, "EEE d MMM")}</p>
        <p className="text-[13px] tabular-nums text-muted">{formatTimeRange(request.requestedStart, request.requestedEnd)}</p>
      </div>
      <div className="min-w-0">
        <TypeLabel kind="reschedule" />
        <Link href={`/admin/bookings/reschedule/${request.id}`} className="block truncate text-[15px] font-extrabold after:absolute after:inset-0 group-hover:text-brand">
          {booking.eventName}
        </Link>
        <p className="truncate text-[13px] text-muted">
          {booking.source === "whatsapp" && <WhatsAppMark />}
          {status === "approved" ? "Moved from" : "Currently"} {formatDate(request.originalStart, "EEE d MMM")} · {formatTimeRange(request.originalStart, request.originalEnd)}
          {status === "denied" && request.denialReason ? ` · “${request.denialReason}”` : ""}
        </p>
      </div>
      <p className="text-sm text-ink-soft">{booking.room.name}</p>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{booking.requester.fullName}</p>
        <p className="truncate text-[13px] text-muted">{formatPhone(booking.requester.phone)}</p>
      </div>
      <p className="text-xs text-muted lg:text-right">{formatDate(status === "denied" && request.reviewedAt ? request.reviewedAt : request.createdAt, "d MMM, h:mm a")}</p>
    </li>
  );
}
