"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, RefreshCw, X } from "lucide-react";
import { approveRescheduleAction, denyRescheduleAction, retryRescheduleEmailAction, type RescheduleReviewState } from "@/app/actions/reschedules";
import { SummaryList } from "@/components/admin/summary-list";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { describedBy, Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export interface RescheduleSummary {
  event: string;
  room: string;
  current: string;
  requested: string;
  requester: string;
}

/** Approve / Deny a pending reschedule. Success only shows after GHL (and the database) confirm. */
export function RescheduleReviewActions({ requestId, summary }: { requestId: string; summary: RescheduleSummary }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"approve" | "deny" | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approving, startApprove] = useTransition();
  const [denyState, setDenyState] = useState<RescheduleReviewState>(null);
  const [denying, startDeny] = useTransition();
  const busy = approving || denying;
  const facts = [
    { label: "Event", value: summary.event },
    { label: "Room", value: summary.room },
    { label: "Current", value: summary.current },
    { label: "Requested", value: <span className="text-brand">{summary.requested}</span> },
    { label: "Requested by", value: summary.requester },
  ];

  function approve() {
    setApproveError(null);
    startApprove(async () => {
      const result = await approveRescheduleAction(requestId);
      if (result.ok) {
        if (result.data.notificationFailed || result.data.calendarSync === "failed") toast.warning(result.message, { duration: 10_000 });
        else toast.success(result.message);
        setDialog(null);
        router.push("/admin/bookings");
      } else {
        setApproveError(result.error);
        if (result.code === "unauthenticated") router.push("/login");
      }
    });
  }

  function deny(formData: FormData) {
    startDeny(async () => {
      const result = await denyRescheduleAction(null, formData);
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
  const reasonHint = "The member sees this in their email. Their original booking stays confirmed.";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setDialog("deny")} disabled={busy}>
          <X className="size-4" aria-hidden />
          Deny reschedule
        </Button>
        <Button
          onClick={() => {
            setApproveError(null);
            setDialog("approve");
          }}
          disabled={busy}
        >
          <Check className="size-4" aria-hidden />
          Approve reschedule
        </Button>
      </div>

      <Dialog
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        locked={approving}
        title="Approve this reschedule?"
        description="The existing GHL appointment moves to the new time, the booking is updated, the member is emailed, and their Google Calendar event moves too."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={approving}>
              Cancel
            </Button>
            <Button onClick={approve} busy={approving} busyLabel="Approving reschedule…">
              Approve reschedule
            </Button>
          </>
        }
      >
        <SummaryList items={facts} dense />
        {approveError && (
          <Notice tone="error" title="Not approved. The request is still pending and the booking is unchanged." className="mt-4 animate-fade-in">
            {approveError}
          </Notice>
        )}
      </Dialog>

      <Dialog open={dialog === "deny"} onClose={() => setDialog(null)} locked={denying} title="Deny this reschedule?" description={`${summary.event} · ${summary.room} · requested ${summary.requested}`}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            deny(new FormData(event.currentTarget));
          }}
          className="space-y-4"
        >
          <input type="hidden" name="requestId" value={requestId} />
          {denyState && !denyState.ok && !denyErrors.reason && <Notice tone="error">{denyState.error}</Notice>}
          <Field id="reschedule-reason" label="Reason" error={denyErrors.reason} hint={reasonHint}>
            <Textarea
              id="reschedule-reason"
              name="reason"
              rows={4}
              maxLength={500}
              required
              autoFocus
              placeholder="e.g. Room A is set up for another event that afternoon."
              aria-invalid={Boolean(denyErrors.reason)}
              aria-describedby={describedBy("reschedule-reason", denyErrors.reason, reasonHint)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={denying}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" busy={denying} busyLabel="Denying…">
              Deny reschedule
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function RetryRescheduleEmailButton({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      busy={pending}
      busyLabel="Sending…"
      onClick={() =>
        startTransition(async () => {
          const result = await retryRescheduleEmailAction(requestId);
          if (result.ok) toast.success(result.message);
          else toast.error(result.error);
        })
      }
    >
      <RefreshCw className="size-3.5" aria-hidden />
      Retry email
    </Button>
  );
}
