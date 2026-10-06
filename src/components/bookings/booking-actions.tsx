"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { cancelBookingAction, retryCalendarSyncAction } from "@/app/actions/bookings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function CancelBookingButton({ bookingId, eventName, approved, label = "Cancel" }: { bookingId: string; eventName: string; approved: boolean; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await cancelBookingAction(bookingId);
      if (result.ok) {
        if (result.data.calendarCleanupFailed) toast.warning(result.message);
        else toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.error);
        if (result.code === "unauthenticated") router.push("/login");
      }
    });
  }

  return (
    <>
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        locked={pending}
        size="sm"
        title={approved ? "Cancel this booking?" : "Withdraw this request?"}
        description={`“${eventName}”`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button variant="danger" onClick={confirm} busy={pending} busyLabel="Cancelling…">
              {approved ? "Cancel booking" : "Withdraw request"}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          {approved
            ? "The room is released in the church calendar and the event is removed from the Google Calendar it was added to."
            : "The time is released for others. You can request it again if it's still open."}
        </p>
      </Dialog>
    </>
  );
}

export function RetryCalendarSyncButton({ bookingId, size = "sm" }: { bookingId: string; size?: "sm" | "md" }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size={size}
      busy={pending}
      busyLabel="Syncing…"
      onClick={() =>
        startTransition(async () => {
          const result = await retryCalendarSyncAction(bookingId);
          if (result.ok) toast.success(result.message);
          else toast.error(result.error);
        })
      }
    >
      <RefreshCw className="size-3.5" aria-hidden />
      Retry calendar sync
    </Button>
  );
}
