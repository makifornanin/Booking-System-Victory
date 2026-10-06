import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/config";
import { AccountLink } from "@/components/shell/account-link";
import { BrandMark } from "@/components/shell/brand-mark";
import { DemoBanner } from "@/components/shell/demo-banner";
import { TabBar, TopNav, type NavItem } from "@/components/shell/nav-links";

const memberNav: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/rooms", label: "Book a Room", icon: "book", matchPrefix: true },
  { href: "/bookings", label: "My Bookings", icon: "bookings" },
];

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
    >
      Skip to content
    </a>
  );
}

export function MemberShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          <div className="flex items-center gap-10">
            <BrandMark href="/dashboard" label={APP_NAME} />
            <TopNav items={memberNav} />
          </div>
          <div className="flex items-center gap-1">
            {user.role === "admin" && (
              <Link href="/admin" className="hidden items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-bold text-muted transition-colors hover:text-ink sm:flex">
                Admin
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            )}
            <AccountLink fullName={user.fullName} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-28 sm:px-6 sm:pt-12 md:pb-20">
        {children}
      </main>
      <TabBar items={memberNav} />
    </>
  );
}
