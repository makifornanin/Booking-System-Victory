import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function BookingNotFound() {
  return (
    <EmptyState
      title="Booking not found"
      description="This request doesn't exist. It may have been removed."
      action={
        <Link href="/admin/bookings" className={buttonStyles()}>
          Back to requests
        </Link>
      }
    />
  );
}
