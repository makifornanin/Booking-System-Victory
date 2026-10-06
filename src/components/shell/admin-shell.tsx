import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/config";
import { AccountLink, Avatar } from "@/components/shell/account-link";
import { BrandMark } from "@/components/shell/brand-mark";
import { DemoBanner } from "@/components/shell/demo-banner";
import { SkipLink } from "@/components/shell/member-shell";
import { ScrollNav, SideNav, type NavItem } from "@/components/shell/nav-links";

interface AdminShellProps {
  user: SessionUser;
  pendingBookings: number;
  pendingUsers: number;
  children: ReactNode;
}

/** Operational shell: a compact sidebar on desktop, a top bar with scrolling nav below lg. */
export function AdminShell({ user, pendingBookings, pendingUsers, children }: AdminShellProps) {
  const nav: NavItem[] = [
    { href: "/admin", label: "Overview", icon: "overview" },
    { href: "/admin/bookings", label: "Booking requests", icon: "requests", matchPrefix: true, count: pendingBookings },
    { href: "/admin/users", label: "Users", icon: "users", matchPrefix: true, count: pendingUsers },
    { href: "/admin/announcements", label: "Announcements", icon: "announcements", matchPrefix: true },
  ];

  return (
    <>
      <SkipLink />
      <DemoBanner />
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-sunken/50 px-3 py-5 lg:flex">
          <div className="px-2.5">
            <BrandMark href="/admin" label={APP_NAME} sublabel="Church office" />
          </div>
          <div className="mt-8 flex-1">
            <SideNav items={nav} />
          </div>
          <div className="space-y-1 border-t border-line pt-3">
            <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-bold text-muted transition-colors hover:text-ink">
              <ArrowLeft className="size-4" aria-hidden />
              Member view
            </Link>
            <Link href="/account" className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-surface/70">
              <Avatar name={user.fullName} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{user.fullName}</span>
                <span className="block truncate text-xs text-muted">{user.email}</span>
              </span>
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md lg:hidden">
            <div className="flex h-14 items-center justify-between px-4 sm:px-6">
              <BrandMark href="/admin" label={APP_NAME} sublabel="Church office" />
              <AccountLink fullName={user.fullName} compact />
            </div>
            <ScrollNav items={[...nav, { href: "/dashboard", label: "Member view", icon: "home" }]} />
          </header>
          <main id="main" className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
