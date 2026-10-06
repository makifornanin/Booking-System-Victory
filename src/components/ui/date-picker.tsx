"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** "YYYY-MM-DD" ⇄ a local Date at midnight, so the calendar shows the same date in any browser time zone. */
const toDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toKey = (date: Date) => format(date, "yyyy-MM-dd");

interface DatePickerProps {
  id: string;
  /** "YYYY-MM-DD" or "" when empty. */
  value: string;
  onChange: (value: string) => void;
  /** Today's date in church time, "YYYY-MM-DD". */
  today: string;
  placeholder?: string;
  /** Earliest selectable date, "YYYY-MM-DD". */
  min?: string;
  clearable?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/** A date field that opens a small month calendar (react-day-picker: keyboard and screen-reader friendly). */
export function DatePicker({ id, value, onChange, today, placeholder = "Choose a date", min, clearable, invalid, describedBy }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const selected = value ? toDate(value) : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-describedby={describedBy}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex h-11 w-full items-center gap-2.5 rounded-md border bg-surface px-3 text-left text-[15px] transition-colors",
            invalid ? "border-denied" : "border-line-strong hover:border-ink/40",
            "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20",
            clearable && value && "pr-10",
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden />
          <span className={value ? "text-ink" : "text-subtle"}>{selected ? format(selected, "EEE, d MMM yyyy") : placeholder}</span>
        </button>
        {clearable && value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-muted hover:bg-sunken hover:text-ink"
            aria-label="Clear date"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose a date"
          className="absolute top-full left-0 z-30 mt-2 w-[18.5rem] animate-fade-in rounded-lg border border-line bg-surface p-3 shadow-[0_12px_32px_-12px_rgb(22_24_29/0.25)]"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <DayPicker
            mode="single"
            required={false}
            autoFocus
            selected={selected}
            defaultMonth={selected ?? toDate(today)}
            today={toDate(today)}
            disabled={min ? { before: toDate(min) } : undefined}
            showOutsideDays
            onSelect={(date) => {
              if (date) onChange(toKey(date));
              close();
            }}
            classNames={{
              root: "relative text-sm",
              months: "relative",
              month: "space-y-2",
              month_caption: "flex h-9 items-center px-1",
              caption_label: "text-[15px] font-extrabold text-ink",
              nav: "absolute top-0 right-0 flex h-9 items-center gap-1",
              button_previous: "inline-flex size-8 items-center justify-center rounded-md text-ink-soft hover:bg-sunken disabled:opacity-30",
              button_next: "inline-flex size-8 items-center justify-center rounded-md text-ink-soft hover:bg-sunken disabled:opacity-30",
              chevron: "size-4 fill-current",
              month_grid: "w-full border-collapse",
              weekdays: "",
              weekday: "h-8 w-9 text-center text-[11px] font-bold text-muted",
              week: "",
              day: "p-0 text-center",
              day_button:
                "mx-auto flex size-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
              selected: "[&>button]:bg-brand [&>button]:font-bold [&>button]:text-white [&>button]:hover:bg-brand-hover",
              today: "[&>button]:font-extrabold [&>button]:text-brand [&[aria-selected=true]>button]:text-white",
              outside: "[&>button]:text-subtle",
              disabled: "[&>button]:pointer-events-none [&>button]:opacity-35",
              hidden: "invisible",
            }}
          />
        </div>
      )}
    </div>
  );
}
