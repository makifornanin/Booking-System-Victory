import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

type Variant = "primary" | "secondary" | "quiet" | "danger" | "danger-quiet" | "inverse";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover active:bg-brand-deep",
  secondary: "bg-surface text-ink border border-line-strong hover:border-ink/40 hover:bg-sunken/60",
  quiet: "text-ink-soft hover:bg-sunken hover:text-ink",
  danger: "bg-denied text-white hover:bg-[#8a2730]",
  "danger-quiet": "text-denied hover:bg-denied-bg",
  inverse: "bg-white text-brand-deep hover:bg-white/90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

export function buttonStyles({ variant = "primary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "inline-flex select-none items-center justify-center gap-2 rounded-md font-bold whitespace-nowrap",
    "transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.985]",
    "disabled:pointer-events-none disabled:opacity-55",
    variants[variant],
    sizes[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Disables the button and shows a spinner with `busyLabel` (or the children). */
  busy?: boolean;
  busyLabel?: ReactNode;
}

export function Button({ variant, size, className, type = "button", busy, busyLabel, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <Spinner />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
