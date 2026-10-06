"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { disconnectGoogleAction } from "@/app/actions/google";
import { Button, buttonStyles } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusMark } from "@/components/ui/status";

/** Connected-account row: status, what it does, and one action. */
export function GoogleCalendarRow({ connected, available }: { connected: boolean; available: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!available) {
    return <p className="text-sm text-muted">Google Calendar sync isn&apos;t configured on this server yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <StatusMark tone={connected ? "approved" : "cancelled"} label={connected ? "Connected" : "Not connected"} />
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
          {connected
            ? "Approved bookings are added to your Google Calendar automatically, and removed if a booking is cancelled."
            : "Connect once so approved bookings are added to your Google Calendar automatically. Required before your first booking."}{" "}
          <Link href="/privacy#google-calendar" className="font-semibold text-ink-soft underline-offset-2 hover:underline">
            How we use Calendar access
          </Link>
        </p>
      </div>
      {connected ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Disconnect
        </Button>
      ) : (
        <a href="/api/google/connect?returnTo=/account" className={buttonStyles()}>
          Connect Google Calendar
        </a>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        locked={pending}
        size="sm"
        title="Disconnect Google Calendar?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Keep connected
            </Button>
            <Button
              variant="danger"
              busy={pending}
              busyLabel="Disconnecting…"
              onClick={() =>
                startTransition(async () => {
                  const result = await disconnectGoogleAction();
                  if (result.ok) {
                    toast.success(result.message);
                    setOpen(false);
                  } else toast.error(result.error);
                })
              }
            >
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          New approvals won&apos;t be added to your calendar, and you&apos;ll need to reconnect before requesting another room. Events already in your calendar stay there.
        </p>
      </Dialog>
    </div>
  );
}
