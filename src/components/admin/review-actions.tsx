"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { approveBookingAction, denyBookingAction, type ReviewActionState } from "@/app/actions/bookings";
import { SummaryList } from "@/components/admin/summary-list";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { describedBy, Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export interface ReviewSummary {
  event: string;
  room: string;
  date: string;
  time: string;
  requester: string;
}

/** Approve / Deny for a pending request. Success is only shown after the server (and GHL) confirm. */
export function ReviewActions({ bookingId, summary }: { bookingId: string; summary: ReviewSummary }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"approve" | "deny" | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approving, startApprove] = useTransition();
  const [denyState, setDenyState] = useState<ReviewActionState>(null);
  const [denying, startDeny] = useTransition();
  const busy = approving || denying;
  const facts = [
    { label: "Event", value: summary.event },
    { label: "Room", value: summary.room },
    { label: "Date", value: summary.date },
    { label: "Time", value: summary.time },
    { label: "Requester", value: summary.requester },
  ];

  function approve() {
    setApproveError(null);
    startApprove(async () => {
      const result = await approveBookingAction(bookingId);
      if (result.ok) {
        if (result.data.calendarSync === "failed" || result.data.calendarSync === "not_connected") toast.warning(result.message, { duration: 9000 });
        else toast.success(result.message);
        setDialog(null);
        router.push("/admin/bookings");
      } else {
        setApproveError(result.error);
        if (result.code === "unauthenticated") router.push("/login");
      }
    });
  }

  // Results are handled right after the action resolves (not in an effect): revalidation
  // re-renders the page without these controls once the booking is no longer pending.
  function deny(formData: FormData) {
    startDeny(async () => {
      const result = await denyBookingAction(null, formData);
      setDenyState(result);
      if (result?.ok) {
        toast.success(result.message);
        setDialog(null);
        router.push("/admin/bookings?status=denied");
      } else if (result?.code === "unauthenticated") {
        router.push("/login");
      }
    });
  }

  const denyErrors = denyState && !denyState.ok ? (denyState.fieldErrors ?? {}) : {};
  const reasonHint = "The requester sees this in their email and in My Bookings.";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setDialog("deny")} disabled={busy}>
          <X className="size-4" aria-hidden />
          Deny
        </Button>
        <Button
          onClick={() => {
            setApproveError(null);
            setDialog("approve");
          }}
          disabled={busy}
        >
          <Check className="size-4" aria-hidden />
          Approve
        </Button>
      </div>

      <Dialog
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        locked={approving}
        title="Approve this reservation?"
        description="It's added to the room's GHL calendar as confirmed, GHL emails the requester, and it goes on their Google Calendar."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={approving}>
              Cancel
            </Button>
            <Button onClick={approve} busy={approving} busyLabel="Approving reservation…">
              Approve reservation
            </Button>
          </>
        }
      >
        <SummaryList items={facts} dense />
        {approveError && (
          <Notice tone="error" title="Not approved — the booking is still pending" className="mt-4 animate-fade-in">
            {approveError}
          </Notice>
        )}
      </Dialog>

      <Dialog
        open={dialog === "deny"}
        onClose={() => setDialog(null)}
        locked={denying}
        title="Deny this request?"
        description={`${summary.event} · ${summary.room} · ${summary.date}`}
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            deny(new FormData(event.currentTarget));
          }}
          className="space-y-4"
        >
          <input type="hidden" name="bookingId" value={bookingId} />
          {denyState && !denyState.ok && !denyErrors.reason && <Notice tone="error">{denyState.error}</Notice>}
          <Field id="reason" label="Reason" error={denyErrors.reason} hint={reasonHint}>
            <Textarea
              id="reason"
              name="reason"
              rows={4}
              maxLength={500}
              required
              autoFocus
              placeholder="e.g. Room D is closed for maintenance that evening. Room C is open instead."
              aria-invalid={Boolean(denyErrors.reason)}
              aria-describedby={describedBy("reason", denyErrors.reason, reasonHint)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={denying}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" busy={denying} busyLabel="Denying…">
              Deny request
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
