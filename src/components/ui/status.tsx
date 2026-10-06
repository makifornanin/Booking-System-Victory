import type { AccessStatus } from "@/lib/data/types";
import type { AnnouncementStatus } from "@/lib/domain/announcements";
import type { BookingStatus } from "@/lib/domain/booking-rules";
import { cn } from "@/lib/utils";

type Tone = "pending" | "approved" | "denied" | "cancelled" | "brand";

const dot: Record<Tone, string> = {
  pending: "bg-pending",
  approved: "bg-approved",
  denied: "bg-denied",
  cancelled: "bg-cancelled",
  brand: "bg-brand",
};

const text: Record<Tone, string> = {
  pending: "text-pending",
  approved: "text-approved",
  denied: "text-denied",
  cancelled: "text-cancelled",
  brand: "text-brand",
};

/** Status as a colored dot plus text — readable without color, lighter than a pill. */
export function StatusMark({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-bold whitespace-nowrap", text[tone], className)}>
      <span className={cn("size-1.5 rounded-full", dot[tone])} aria-hidden />
      {label}
    </span>
  );
}

const bookingLabels: Record<BookingStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
};

export function BookingStatus({ status, className }: { status: BookingStatus; className?: string }) {
  return <StatusMark tone={status} label={bookingLabels[status]} className={className} />;
}

const accessTone: Record<AccessStatus, Tone> = { pending: "pending", active: "approved", denied: "denied", revoked: "cancelled" };
const accessLabels: Record<AccessStatus, string> = { pending: "Awaiting approval", active: "Active", denied: "Denied", revoked: "Revoked" };

export function AccessStatusMark({ status, className }: { status: AccessStatus; className?: string }) {
  return <StatusMark tone={accessTone[status]} label={accessLabels[status]} className={className} />;
}

const announcementTone: Record<AnnouncementStatus, Tone> = { draft: "cancelled", scheduled: "brand", published: "approved", expired: "denied" };
const announcementLabels: Record<AnnouncementStatus, string> = { draft: "Draft", scheduled: "Scheduled", published: "Published", expired: "Expired" };

export function AnnouncementStatusMark({ status }: { status: AnnouncementStatus }) {
  return <StatusMark tone={announcementTone[status]} label={announcementLabels[status]} />;
}
