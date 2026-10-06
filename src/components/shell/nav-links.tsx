"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, Home, LayoutGrid, ListChecks, Megaphone, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "book" | "bookings" | "overview" | "requests" | "users" | "announcements";
  /** Match nested routes too (e.g. /rooms/room-a). */
  matchPrefix?: boolean;
  count?: number;
}

const icons: Record<NavItem["icon"], LucideIcon> = {
  home: Home,
  book: CalendarPlus,
  bookings: ListChecks,
  overview: LayoutGrid,
  requests: ListChecks,
  users: Users,
  announcements: Megaphone,
};

function isActive(pathname: string, item: NavItem) {
  return item.matchPrefix ? pathname === item.href || pathname.startsWith(`${item.href}/`) : pathname === item.href;
}

/** Member top navigation: text links with an underline marker. */
export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="hidden md:block">
      <ul className="flex items-center gap-7">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-16 items-center text-sm font-bold transition-colors", active ? "text-ink" : "text-muted hover:text-ink")}
              >
                {item.label}
                <span
                  className={cn("absolute inset-x-0 bottom-0 h-[2px] origin-left bg-brand transition-transform duration-300 ease-out", active ? "scale-x-100" : "scale-x-0")}
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Bottom tab bar for members on phones (thumb-reachable primary navigation). */
export function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-3">
        {items.map((item) => {
          const active = isActive(pathname, item);
          const Icon = icons[item.icon];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-bold", active ? "text-brand" : "text-muted")}
              >
                <Icon className="size-5" aria-hidden strokeWidth={active ? 2.3 : 1.7} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Admin sidebar list (desktop) — compact rows with counts. */
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin">
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item);
          const Icon = icons[item.icon];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-bold transition-colors",
                  active ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-soft hover:bg-surface/70 hover:text-ink",
                )}
              >
                <Icon className={cn("size-4", active ? "text-brand" : "text-muted")} aria-hidden />
                <span className="flex-1">{item.label}</span>
                {item.count ? (
                  <span className="min-w-5 rounded-sm bg-accent/20 px-1.5 text-center text-xs font-extrabold text-accent-ink tabular-nums">
                    {item.count}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Admin navigation on phones and tablets: a scrolling row under the top bar. */
export function ScrollNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="border-t border-line lg:hidden">
      <ul className="flex gap-5 overflow-x-auto px-4 sm:px-6">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-1.5 border-b-2 py-2.5 text-sm font-bold", active ? "border-ink text-ink" : "border-transparent text-muted")}
              >
                {item.label}
                {item.count ? <span className="text-xs font-extrabold text-accent-ink tabular-nums">{item.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
