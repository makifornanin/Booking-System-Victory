import Link from "next/link";
import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}

/** URL-driven tabs: shareable, work without JavaScript, and survive refresh. */
export function LinkTabs({ tabs, label, className }: { tabs: Tab[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="flex min-w-max gap-6 border-b border-line">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              scroll={false}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 pt-1 pb-3 text-sm font-bold transition-colors",
                tab.active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn("text-xs font-semibold tabular-nums", tab.active ? "text-ink-soft" : "text-subtle")}>{tab.count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
