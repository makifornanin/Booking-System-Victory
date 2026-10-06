import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Key/value facts with hairline rows (GOV.UK summary-list pattern). */
export function SummaryList({ items, className, dense }: { items: { label: string; value: ReactNode }[]; className?: string; dense?: boolean }) {
  return (
    <dl className={cn("divide-y divide-line border-y border-line", className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("grid grid-cols-[7.5rem_minmax(0,1fr)] gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]", dense ? "py-2.5" : "py-3.5")}>
          <dt className="text-sm text-muted">{item.label}</dt>
          <dd className="text-sm font-semibold text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
