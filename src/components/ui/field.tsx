import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const control =
  "block w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-subtle transition-[border-color,box-shadow] " +
  "hover:border-ink/35 focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/12 " +
  "aria-[invalid=true]:border-denied aria-[invalid=true]:focus:ring-denied/12 disabled:bg-sunken disabled:text-subtle";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />;
}

const chevron =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5.5 7.75 10 12.25l4.5-4.5' stroke='%23646972' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(control, "h-11 appearance-none bg-[length:18px] bg-[right_0.7rem_center] bg-no-repeat pr-9", className)}
      style={{ backgroundImage: chevron }}
      {...props}
    >
      {children}
    </select>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}

/** Label + control + hint/error, wired with ids so errors are announced. */
export function Field({ id, label, hint, error, optional, children, className }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-[13px] font-bold text-ink">
        {label}
        {optional && <span className="text-xs font-semibold text-muted">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-semibold text-denied">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}
