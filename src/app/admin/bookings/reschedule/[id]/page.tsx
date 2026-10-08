import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { getRepositoryForRequest } from "@/lib/data/queries";
import type { RescheduleStatus } from "@/lib/data/types";
import { formatPhone } from "@/lib/domain/phone";
import { formatDate, formatTimeRange } from "@/lib/domain/time";
import { parseUuid } from "@/lib/validation/params";
import { RescheduleReviewActions, RetryRescheduleEmailButton } from "@/components/admin/reschedule-review-actions";
import { SummaryList } from "@/components/admin/summary-list";
import { Notice } from "@/components/ui/notice";
import { StatusMark } from "@/components/ui/status";

export const metadata: Metadata = { title: "Reschedule request" };

const STATUS: Record<RescheduleStatus, { tone: "pending" | "approved" | "denied" | "cancelled"; label: string }> = {
  pending: { tone: "pending", label: "Pending review" },
  approved: { tone: "approved", label: "Reschedule approved" },
  denied: { tone: "denied", label: "Reschedule denied" },
  cancelled: { tone: "cancelled", label: "Withdrawn" },
};

export default async function AdminReschedulePage({ params }: PageProps<"/admin/bookings/reschedule/[id]">) {
  await requireAdmin();
  const id = parseUuid((await params).id);
  if (!id) notFound();
  const request = await (await getRepositoryForRequest()).getRescheduleRequest(id);
  if (!request) notFound();

  const booking = request.booking;
  const day = (iso: string) => formatDate(iso, "EEEE, d MMMM yyyy");
  const current = `${formatDate(request.originalStart, "EEE d MMM")} · ${formatTimeRange(request.originalStart, request.originalEnd)}`;
  const requested = `${formatDate(request.requestedStart, "EEE d MMM")} · ${formatTimeRange(request.requestedStart, request.requestedEnd)}`;
  const status = STATUS[request.status];
  // The requested time (or the booking itself) has started: the move can no longer be approved.
  const now = new Date().getTime();
  const pastDue = request.status === "pending" && Math.min(new Date(request.requestedStart).getTime(), new Date(request.originalStart).getTime()) <= now;

  return (
    <div className="space-y-8">
      <Link href="/admin/bookings" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Booking requests
      </Link>

      <header className="flex flex-col gap-5 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="eyebrow text-[10px] text-accent-ink">Reschedule</p>
          <h1 className="title mt-1 text-3xl">{booking.eventName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-muted">
            <StatusMark tone={pastDue ? "cancelled" : status.tone} label={pastDue ? "Past due" : status.label} />
            <span>
              {booking.room.name} · {booking.requester.fullName}
            </span>
          </div>
        </div>
        {request.status === "pending" && (
          <RescheduleReviewActions
            requestId={request.id}
            pastDue={pastDue}
            summary={{ event: booking.eventName, room: booking.room.name, current, requested, requester: `${booking.requester.fullName} (${booking.requester.email})` }}
          />
        )}
      </header>

      {pastDue && (
        <Notice tone="warning" title="Past due">
          This request can no longer be approved because its start time has passed. Closing it keeps the original booking as it is.
        </Notice>
      )}
      {request.status === "denied" && request.denialReason && (
        <Notice tone="error" title="Denial reason">
          {request.denialReason}. The original booking stayed confirmed.
        </Notice>
      )}
      {request.notificationError && (request.status === "approved" || request.status === "denied") && (
        <Notice tone="warning" title="The member's email couldn't be sent." action={<RetryRescheduleEmailButton requestId={request.id} />}>
          {request.notificationError}
        </Notice>
      )}

      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start">
        <section aria-labelledby="current-heading">
          <h2 id="current-heading" className="mb-3 text-[15px] font-extrabold">
            {request.status === "approved" ? "Previous booking" : "Current booking"}
          </h2>
          <SummaryList
            items={[
              { label: "Event", value: booking.eventName },
              { label: "Room", value: booking.room.name },
              { label: "Date", value: day(request.originalStart) },
              { label: "Time", value: formatTimeRange(request.originalStart, request.originalEnd) },
            ]}
          />
          <Link href={`/admin/bookings/${booking.id}`} className="mt-3 inline-block text-[13px] font-bold text-brand hover:underline">
            Open the booking
          </Link>
        </section>
        <ArrowRight className="hidden size-5 text-subtle md:mt-12 md:block" aria-hidden />
        <section aria-labelledby="requested-heading">
          <h2 id="requested-heading" className="mb-3 text-[15px] font-extrabold">
            Requested change
          </h2>
          <SummaryList
            items={[
              { label: "Room", value: `${booking.room.name} (same)` },
              { label: "Date", value: <span className="text-brand">{day(request.requestedStart)}</span> },
              { label: "Time", value: <span className="text-brand">{formatTimeRange(request.requestedStart, request.requestedEnd)}</span> },
              { label: "Submitted", value: formatDate(request.createdAt, "d MMM yyyy, h:mm a") },
              ...(request.reviewedAt
                ? [{ label: "Reviewed", value: `${formatDate(request.reviewedAt, "d MMM yyyy, h:mm a")}${request.reviewer ? ` by ${request.reviewer.fullName}` : ""}` }]
                : []),
            ]}
          />
          {request.status === "pending" && <p className="mt-3 text-[13px] text-muted">The requested time is held for this booking until you decide.</p>}
        </section>
      </div>

      <section aria-labelledby="requester-heading" className="max-w-xl">
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
    </div>
  );
}
