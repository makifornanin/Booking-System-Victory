import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** "editorial" uses the serif headline (member side); "operational" is compact (admin). */
  variant?: "editorial" | "operational";
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, variant = "editorial", className }: PageHeaderProps) {
  const editorial = variant === "editorial";
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", editorial ? "pb-8" : "pb-5", className)}>
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow text-muted">{eyebrow}</p>}
        <h1 className={cn(editorial ? "headline mt-2 text-[2.5rem] sm:text-5xl" : "title mt-1 text-2xl")}>{title}</h1>
        {description && <p className={cn("leading-relaxed text-muted", editorial ? "mt-3 text-base" : "mt-1.5 text-sm")}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
