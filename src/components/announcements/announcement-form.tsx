"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ImageUp } from "lucide-react";
import {
  createAnnouncementAction,
  updateAnnouncementAction,
  type AnnouncementActionState,
} from "@/app/actions/announcements";
import type { PosterOrientation } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { roundDownToGrid, ScheduleField } from "@/components/announcements/schedule-field";
import { describedBy, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";

export interface AnnouncementFormValues {
  id: string;
  internalTitle: string;
  orientation: PosterOrientation;
  publishAt: string;
  expiresAt: string;
  isPublished: boolean;
  imageUrl: string;
}

interface AnnouncementFormProps {
  /** Present when editing. */
  initial?: AnnouncementFormValues;
  /** Default publish time for new posters, "YYYY-MM-DDTHH:mm" in church time. */
  defaultPublishAt: string;
  onDone?: () => void;
}

export const ORIENTATIONS: { value: PosterOrientation; label: string; ratio: string; size: string; frame: string }[] = [
  { value: "portrait", label: "Portrait", ratio: "4:5", size: "1080 × 1350", frame: "aspect-[4/5] w-44" },
  { value: "landscape", label: "Landscape", ratio: "16:9", size: "1920 × 1080", frame: "aspect-video w-full" },
];

export function AnnouncementForm(props: AnnouncementFormProps) {
  // A new key after each successful create resets every field, including the controlled ones.
  const [formKey, setFormKey] = useState(0);
  return <AnnouncementFormFields key={formKey} {...props} onCreated={() => setFormKey((k) => k + 1)} />;
}

function AnnouncementFormFields({ initial, defaultPublishAt, onDone, onCreated }: AnnouncementFormProps & { onCreated: () => void }) {
  const prefix = initial?.id ?? "new";
  const [orientation, setOrientation] = useState<PosterOrientation>(initial?.orientation ?? "portrait");
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<AnnouncementActionState>(null);
  const [pending, startTransition] = useTransition();
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const isEdit = Boolean(initial);
  const chosen = ORIENTATIONS.find((o) => o.value === orientation)!;
  const posterHint = `${isEdit ? "Leave empty to keep the current poster. " : ""}JPG, PNG or WebP up to 5 MB. ${chosen.ratio} (e.g. ${chosen.size}) fits without cropping.`;
  const today = defaultPublishAt.slice(0, 10);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await (isEdit ? updateAnnouncementAction : createAnnouncementAction)(null, formData);
      setState(result);
      if (!result?.ok) return;
      toast.success(result.message);
      if (!isEdit) onCreated();
      onDone?.();
    });
  }

  const shownImage = preview ?? initial?.imageUrl ?? null;

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
    >
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {state && !state.ok && <Notice tone="error">{state.error}</Notice>}

      <fieldset>
        <legend className="text-sm font-bold text-ink">Orientation</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {ORIENTATIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30",
                orientation === option.value ? "border-ink bg-surface" : "border-line-strong bg-surface hover:border-ink/40",
              )}
            >
              <input
                type="radio"
                name="orientation"
                value={option.value}
                checked={orientation === option.value}
                onChange={() => setOrientation(option.value)}
                className="sr-only"
              />
              <span
                className={cn("shrink-0 rounded-[2px] border-[1.5px]", orientation === option.value ? "border-ink" : "border-subtle", option.value === "portrait" ? "h-5 w-4" : "h-3.5 w-6")}
                aria-hidden
              />
              <span>
                <span className="block font-bold text-ink">{option.label}</span>
                <span className="block text-xs text-muted">{option.ratio}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.orientation && <p className="mt-1.5 text-[13px] font-semibold text-denied">{errors.orientation}</p>}
      </fieldset>

      <Field id={`${prefix}-poster`} label="Poster image" error={errors.poster} hint={posterHint}>
        <div className="space-y-2.5">
          <div className={cn("relative mx-auto overflow-hidden rounded-sm bg-sunken ring-1 ring-line transition-[width] duration-200", chosen.frame)}>
            {shownImage ? (
              <Image src={shownImage} alt="Poster preview" fill sizes="(max-width: 640px) 100vw, 360px" unoptimized className="object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-subtle">
                <ImageUp className="size-6" aria-hidden />
                <span className="text-xs font-bold">
                  {chosen.label} {chosen.ratio}
                </span>
              </div>
            )}
          </div>
          <p className="text-center text-xs text-muted">How members will see it. The image fills the {chosen.ratio} frame; edges may be cropped.</p>
          <label
            htmlFor={`${prefix}-poster`}
            className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-line-strong bg-surface text-sm font-bold text-ink transition-colors hover:border-ink/40 has-[+input:focus-visible]:ring-2"
          >
            {shownImage ? "Choose a different image" : "Choose an image"}
          </label>
          <input
            id={`${prefix}-poster`}
            name="poster"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-invalid={Boolean(errors.poster)}
            aria-describedby={describedBy(`${prefix}-poster`, errors.poster, posterHint)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
        </div>
      </Field>

      <Field id={`${prefix}-title`} label="Internal title" error={errors.internalTitle} hint="For admins only. Also used as the poster's alt text.">
        <Input id={`${prefix}-title`} name="internalTitle" defaultValue={initial?.internalTitle} maxLength={120} required aria-invalid={Boolean(errors.internalTitle)} />
      </Field>

      <ScheduleField
        name="publishAt"
        idPrefix={`${prefix}-publish`}
        dateLabel="Publish date"
        timeLabel="Publish time"
        defaultValue={initial?.publishAt ?? `${today}T${roundDownToGrid(defaultPublishAt.slice(11, 16))}`}
        today={today}
        fallbackTime="09:00"
        error={errors.publishAt}
      />
      <ScheduleField
        name="expiresAt"
        idPrefix={`${prefix}-expires`}
        dateLabel="Expiry date"
        timeLabel="Expiry time"
        defaultValue={initial?.expiresAt ?? ""}
        today={today}
        fallbackTime="23:59"
        optional
        error={errors.expiresAt}
        hint="Leave empty to keep it up until you remove it."
      />
      <p className="-mt-2 text-xs text-muted">Times are Philippine time.</p>

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
