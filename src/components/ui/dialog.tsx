"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Blocks Esc/backdrop closing while work is in flight. */
  locked?: boolean;
  size?: "sm" | "md" | "lg";
}

const widths = { sm: "w-[min(26rem,calc(100vw-2rem))]", md: "w-[min(32rem,calc(100vw-2rem))]", lg: "w-[min(40rem,calc(100vw-2rem))]" };

/** Native <dialog>: focus trapping, Esc and an inert background come from the browser. */
export function Dialog({ open, onClose, title, description, children, footer, locked, size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !locked) onClose();
      }}
      aria-labelledby={titleId}
      className={cn("m-auto overflow-visible rounded-lg border-0 bg-transparent p-0 text-ink", widths[size])}
    >
      {open && (
        <div className="animate-fade-up overflow-hidden rounded-lg bg-surface shadow-[0_24px_64px_-16px_rgb(22_24_29/0.35)]">
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <div>
              <h2 id={titleId} className="title text-lg">
                {title}
              </h2>
              {description && <div className="mt-1 text-sm text-muted">{description}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={locked}
              className="-mr-2 rounded-md p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
              aria-label="Close"
            >
              <X className="size-[18px]" aria-hidden />
            </button>
          </div>
          <div className="px-6 pt-4 pb-6">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas px-6 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
