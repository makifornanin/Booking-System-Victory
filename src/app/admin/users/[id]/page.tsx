import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { getRepositoryForRequest } from "@/lib/data/queries";
import type { AccessChange } from "@/lib/data/types";
import { formatPhone } from "@/lib/domain/phone";
import { formatDate } from "@/lib/domain/time";
import { parseUuid } from "@/lib/validation/params";
import { AccessActions, RetryNotificationButton } from "@/components/admin/access-actions";
import { SummaryList } from "@/components/admin/summary-list";
import { BookingRow } from "@/components/bookings/booking-row";
import { Avatar } from "@/components/shell/account-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { AccessStatusMark } from "@/components/ui/status";

export const metadata: Metadata = { title: "User" };

const changeLabels: Record<AccessChange, string> = { approved: "Approved", denied: "Denied", revoked: "Access revoked", restored: "Access restored" };

export default async function AdminUserPage({ params }: PageProps<"/admin/users/[id]">) {
  const admin = await requireAdmin();
  const id = parseUuid((await params).id);
  if (!id) notFound();

  const repo = await getRepositoryForRequest();
  const [profile, bookings, events] = await Promise.all([repo.getProfile(id), repo.listBookingsForUser(id), repo.listAccessEvents(id)]);
  if (!profile) notFound();

  const now = new Date();
  const name = profile.fullName || "Unnamed";
  const isSelf = profile.id === admin.id;
  const count = (status: string) => bookings.filter((b) => b.status === status).length;

  return (
    <div className="space-y-10">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Users
      </Link>

      <header className="flex flex-col gap-5 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0">
            <AccessStatusMark status={profile.accessStatus} />
            <h1 className="title mt-1 flex items-center gap-2 text-3xl">
              <span className="truncate">{name}</span>
              {profile.role === "admin" && <ShieldCheck className="size-5 shrink-0 text-brand" aria-label="Admin" />}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {profile.role === "admin" ? "Admin" : "Member"} · Joined {formatDate(profile.createdAt, "d MMMM yyyy")}
            </p>
          </div>
        </div>
        {isSelf ? (
          <p className="text-sm text-muted">This is your account. Another admin manages your access.</p>
        ) : (
          <AccessActions userId={profile.id} userName={name} status={profile.accessStatus} />
        )}
      </header>

      {profile.accessNotificationError && (
        <Notice tone="warning" title="Access updated, but the notification email failed." action={<RetryNotificationButton userId={profile.id} />}>
          {profile.accessNotificationError}
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-12">
        <div className="space-y-10 lg:col-span-5">
          <section aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="mb-3 text-[15px] font-extrabold">
              Contact
            </h2>
            <SummaryList
              items={[
                { label: "Email", value: <a href={`mailto:${profile.email}`} className="break-all hover:underline">{profile.email}</a> },
                { label: "Mobile", value: profile.phone ? <a href={`tel:${profile.phone}`} className="hover:underline">{formatPhone(profile.phone)}</a> : "—" },
              ]}
            />
          </section>

          <section aria-labelledby="access-heading">
            <h2 id="access-heading" className="mb-3 text-[15px] font-extrabold">
              Portal access
            </h2>
            <SummaryList
              items={[
                { label: "Status", value: <AccessStatusMark status={profile.accessStatus} /> },
                ...(profile.accessReason ? [{ label: "Reason", value: <span className="font-normal">{profile.accessReason}</span> }] : []),
                { label: "Last reviewed", value: profile.accessReviewedAt ? formatDate(profile.accessReviewedAt, "d MMM yyyy, h:mm a") : "Not yet reviewed" },
              ]}
            />
            {events.length > 0 && (
              <ol className="mt-5 space-y-4 border-l border-line pl-5" aria-label="Access history">
                {events.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute top-1.5 -left-[23.5px] size-2 rounded-full border-2 border-canvas bg-ink-soft" aria-hidden />
                    <p className="text-sm font-bold">
                      {changeLabels[event.change]}
                      {event.actorName && <span className="font-normal text-muted"> by {event.actorName}</span>}
                    </p>
                    <p className="text-[13px] text-muted">
                      {formatDate(event.createdAt, "d MMM yyyy, h:mm a")}
                      {event.notificationError ? " · email failed" : event.notifiedAt ? " · email sent" : ""}
                    </p>
                    {event.reason && <p className="mt-1 text-[13px] text-ink-soft">“{event.reason}”</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section aria-labelledby="history-heading" className="lg:col-span-7">
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <h2 id="history-heading" className="text-[15px] font-extrabold">
              Booking history <span className="ml-1 font-semibold text-muted tabular-nums">{bookings.length}</span>
            </h2>
            {bookings.length > 0 && (
              <p className="text-[13px] text-muted tabular-nums">
                {count("approved")} approved · {count("pending")} pending · {count("denied")} denied
              </p>
            )}
          </div>
          {bookings.length > 0 ? (
            <ol className="divide-y divide-line border-t border-line">
              {bookings.map((booking) => (
                <BookingRow key={booking.id} booking={booking} now={now} showActions={false} detailHref={`/admin/bookings/${booking.id}`} />
              ))}
            </ol>
          ) : (
            <EmptyState variant="quiet" className="mt-4" title="No bookings yet" description="This person hasn't requested a room." />
          )}
        </section>
      </div>
    </div>
  );
}
