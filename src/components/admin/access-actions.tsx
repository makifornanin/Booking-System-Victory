"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { changeAccessAction, retryAccessNotificationAction, type AccessActionState } from "@/app/actions/accounts";
import type { AccessStatus } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { describedBy, Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

type Action = "approve" | "deny" | "revoke" | "restore";

const copy: Record<Action, { title: string; body: string; confirm: string; busy: string; needsReason: boolean }> = {
  approve: { title: "Approve access?", body: "They can book rooms right away. GHL sends the welcome email.", confirm: "Approve access", busy: "Approving…", needsReason: false },
  deny: { title: "Deny this account?", body: "They won't be able to use the portal. GHL emails them your reason.", confirm: "Deny account", busy: "Denying…", needsReason: true },
  revoke: {
    title: "Revoke portal access?",
    body: "Their account and booking history are kept. They can't sign in to the portal until access is restored. GHL emails them your reason.",
    confirm: "Revoke access",
    busy: "Revoking…",
    needsReason: true,
  },
  restore: { title: "Restore access?", body: "They can use the portal again. GHL emails them to let them know.", confirm: "Restore access", busy: "Restoring…", needsReason: false },
};

function availableActions(status: AccessStatus): Action[] {
  if (status === "pending") return ["deny", "approve"];
  if (status === "active") return ["revoke"];
  return ["restore"];
}

/** Account access buttons for one user; each opens a confirmation (with a required reason for deny/revoke). */
export function AccessActions({ userId, userName, status, compact }: { userId: string; userName: string; status: AccessStatus; compact?: boolean }) {
  const [action, setAction] = useState<Action | null>(null);
  const [state, setState] = useState<AccessActionState>(null);
  const [pending, startTransition] = useTransition();
  const text = action ? copy[action] : null;
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await changeAccessAction(null, formData);
      setState(result);
      if (!result?.ok) return;
      if (result.data.notificationFailed) toast.warning(result.message, { duration: 10_000 });
      else toast.success(result.message);
      setAction(null);
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {availableActions(status).map((name) => (
          <Button
            key={name}
            size={compact ? "sm" : "md"}
            variant={name === "approve" || name === "restore" ? "primary" : name === "revoke" ? "danger-quiet" : "secondary"}
            onClick={() => {
              setState(null);
              setAction(name);
            }}
          >
            {name === "approve" ? "Approve" : name === "deny" ? "Deny" : name === "revoke" ? "Revoke access" : "Restore access"}
          </Button>
        ))}
      </div>

      <Dialog open={action !== null} onClose={() => setAction(null)} locked={pending} title={text?.title ?? ""} description={userName} size="sm">
        {text && action && (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit(new FormData(event.currentTarget));
            }}
          >
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="action" value={action} />
            <p className="text-sm leading-relaxed text-ink-soft">{text.body}</p>
            {state && !state.ok && !errors.reason && <Notice tone="error">{state.error}</Notice>}
            {text.needsReason && (
              <Field id={`reason-${userId}`} label="Reason" error={errors.reason} hint="Included in the email they receive.">
                <Textarea
                  id={`reason-${userId}`}
                  name="reason"
                  rows={3}
                  maxLength={500}
                  required
                  autoFocus
                  aria-invalid={Boolean(errors.reason)}
                  aria-describedby={describedBy(`reason-${userId}`, errors.reason, "Included in the email they receive.")}
                />
              </Field>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setAction(null)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant={action === "deny" || action === "revoke" ? "danger" : "primary"} busy={pending} busyLabel={text.busy}>
                {text.confirm}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function RetryNotificationButton({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      busy={pending}
      busyLabel="Sending…"
      onClick={() =>
        startTransition(async () => {
          const result = await retryAccessNotificationAction(userId);
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
