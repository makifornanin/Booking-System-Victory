"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ImageUp } from "lucide-react";
import {
  createAnnouncementAction,
  updateAnnouncementAction,
  type AnnouncementActionState,
} from "@/app/actions/announcements";
import { describedBy, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";

export interface AnnouncementFormValues {
  id: string;
  internalTitle: string;
  publishAt: string;
  expiresAt: string;
  isPublished: boolean;
  imageUrl: string;
}

interface AnnouncementFormProps {
  /** Present when editing. */
  initial?: AnnouncementFormValues;
  /** Default publish time for new posters, as a datetime-local value in church time. */
  defaultPublishAt: string;
  onDone?: () => void;
}

export function AnnouncementForm({ initial, defaultPublishAt, onDone }: AnnouncementFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<AnnouncementActionState>(null);
  const [pending, startTransition] = useTransition();
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const isEdit = Boolean(initial);
  const posterHint = isEdit ? "Leave empty to keep the current poster." : "JPG, PNG or WebP up to 5 MB. Portrait 4:5 (e.g. 1080×1350) fits best.";

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await (isEdit ? updateAnnouncementAction : createAnnouncementAction)(null, formData);
      setState(result);
      if (!result?.ok) return;
      toast.success(result.message);
      if (!isEdit) {
        formRef.current?.reset();
        setPreview(null);
      }
      onDone?.();
    });
  }

  const shownImage = preview ?? initial?.imageUrl ?? null;

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
    >
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {state && !state.ok && <Notice tone="error">{state.error}</Notice>}

      <Field id={`${initial?.id ?? "new"}-poster`} label="Poster image" error={errors.poster} hint={posterHint}>
        <label
          htmlFor={`${initial?.id ?? "new"}-poster`}
          className="flex cursor-pointer gap-4 rounded-md border border-dashed border-line-strong bg-canvas p-3 transition-colors hover:border-ink/40"
        >
          <div className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-sm bg-sunken">
            {shownImage ? (
              <Image src={shownImage} alt="Poster preview" fill sizes="96px" unoptimized className="object-contain" />
            ) : (
              <ImageUp className="absolute inset-0 m-auto size-6 text-subtle" aria-hidden />
            )}
          </div>
          <div className="self-center text-sm">
            <p className="font-bold text-ink">{shownImage ? "Choose a different image" : "Choose an image"}</p>
            <p className="mt-0.5 text-muted">{preview ? "Preview of the new poster" : isEdit ? "Current poster" : "No file selected"}</p>
          </div>
        </label>
        <input
          id={`${initial?.id ?? "new"}-poster`}
          name="poster"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-invalid={Boolean(errors.poster)}
          aria-describedby={describedBy(`${initial?.id ?? "new"}-poster`, errors.poster, posterHint)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
        />
      </Field>

      <Field id={`${initial?.id ?? "new"}-title`} label="Internal title" error={errors.internalTitle} hint="For admins only. Also used as the poster's alt text.">
        <Input
          id={`${initial?.id ?? "new"}-title`}
          name="internalTitle"
          defaultValue={initial?.internalTitle}
          maxLength={120}
          required
          aria-invalid={Boolean(errors.internalTitle)}
        />
      </Field>

      <div className={isEdit ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
        <Field id={`${initial?.id ?? "new"}-publishAt`} label="Publish on" error={errors.publishAt}>
          <Input
            id={`${initial?.id ?? "new"}-publishAt`}
            name="publishAt"
            type="datetime-local"
            defaultValue={initial?.publishAt ?? defaultPublishAt}
            required
            aria-invalid={Boolean(errors.publishAt)}
          />
        </Field>
        <Field id={`${initial?.id ?? "new"}-expiresAt`} label="Expires on" optional error={errors.expiresAt}>
          <Input
            id={`${initial?.id ?? "new"}-expiresAt`}
            name="expiresAt"
            type="datetime-local"
            defaultValue={initial?.expiresAt}
            aria-invalid={Boolean(errors.expiresAt)}
          />
        </Field>
      </div>

      <label className="flex items-start gap-3 border-y border-line py-3 text-sm">
        <input type="checkbox" name="publish" defaultChecked={initial ? initial.isPublished : true} className="mt-0.5 size-4 accent-brand" />
        <span>
          <span className="font-bold text-ink">Publish</span>
          <span className="block text-muted">Visible to members from the publish date until it expires. Unchecked saves a draft.</span>
        </span>
      </label>

      <SubmitButton className="w-full" pending={pending} pendingLabel={isEdit ? "Saving…" : "Uploading…"}>
        {isEdit ? "Save changes" : "Add announcement"}
      </SubmitButton>
    </form>
  );
}
