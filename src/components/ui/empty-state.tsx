import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** "quiet" sits inline inside lists; "page" fills a whole section. */
  variant?: "page" | "quiet";
}

/** Plain-language empty state: what's missing and the next step, no filler art. */
export function EmptyState({ title, description, action, className, variant = "page" }: EmptyStateProps) {
  if (variant === "quiet") {
    return (
      <div className={cn("py-10 text-center", className)}>
        <p className="font-bold text-ink">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    );
  }
  return (
    <div className={cn("border-y border-line py-16 text-center", className)}>
      <p className="headline text-2xl text-ink">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
