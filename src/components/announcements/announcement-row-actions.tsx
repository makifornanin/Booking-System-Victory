"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteAnnouncementAction, setAnnouncementPublishedAction } from "@/app/actions/announcements";
import { AnnouncementForm, type AnnouncementFormValues } from "@/components/announcements/announcement-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function AnnouncementRowActions({ values, defaultPublishAt }: { values: AnnouncementFormValues; defaultPublishAt: string }) {
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const [busy, setBusy] = useState<"publish" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();

  function run(kind: "publish" | "delete", action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(kind);
    startTransition(async () => {
      const result = await action();
      setBusy(null);
      if (result.ok) {
        toast.success(result.message);
        setDialog(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="quiet" onClick={() => setDialog("edit")} disabled={pending}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="quiet"
        busy={pending && busy === "publish"}
        busyLabel={values.isPublished ? "Unpublishing…" : "Publishing…"}
        disabled={pending}
        onClick={() => run("publish", () => setAnnouncementPublishedAction(values.id, !values.isPublished))}
      >
        {values.isPublished ? "Unpublish" : "Publish"}
      </Button>
      <Button size="sm" variant="danger-quiet" onClick={() => setDialog("delete")} disabled={pending}>
        Delete
      </Button>

      <Dialog open={dialog === "edit"} onClose={() => setDialog(null)} title="Edit announcement" size="lg">
        <AnnouncementForm initial={values} defaultPublishAt={defaultPublishAt} onDone={() => setDialog(null)} />
      </Dialog>

      <Dialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        locked={pending}
        size="sm"
        title="Delete this announcement?"
        description={`“${values.internalTitle}” and its poster image will be removed permanently.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={pending}>
              Keep it
            </Button>
            <Button variant="danger" busy={pending && busy === "delete"} busyLabel="Deleting…" onClick={() => run("delete", () => deleteAnnouncementAction(values.id))}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">Members will stop seeing it immediately.</p>
      </Dialog>
    </div>
  );
}
