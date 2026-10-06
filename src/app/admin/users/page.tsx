import type { Metadata } from "next";
import Link from "next/link";
import { Search, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { getRepositoryForRequest, getUserCounts } from "@/lib/data/queries";
import type { AccessStatus } from "@/lib/data/types";
import { formatPhone } from "@/lib/domain/phone";
import { formatDate } from "@/lib/domain/time";
import { adminUserTabSchema, firstParam } from "@/lib/validation/params";
import { AccessActions } from "@/components/admin/access-actions";
import { Avatar } from "@/components/shell/account-link";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { AccessStatusMark } from "@/components/ui/status";

export const metadata: Metadata = { title: "Users" };

const tabs: { status: AccessStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "active", label: "Active" },
  { status: "denied", label: "Denied" },
  { status: "revoked", label: "Revoked" },
];

const empty: Record<AccessStatus, { title: string; description: string }> = {
  pending: { title: "No one is waiting", description: "New sign-ups appear here for approval before they can book." },
  active: { title: "No active members", description: "Approved accounts are listed here." },
  denied: { title: "No denied accounts", description: "Accounts you deny are kept here with the reason." },
  revoked: { title: "No revoked accounts", description: "Members whose access you revoke are kept here and can be restored." },
};

function tabHref(status: AccessStatus, query: string) {
  const params = new URLSearchParams({ status });
  if (query) params.set("q", query);
  return `/admin/users?${params}`;
}

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  await requireAdmin();
  const params = await searchParams;
  const query = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const counts = await getUserCounts();
  const requested = firstParam(params.status);
  // With no tab chosen, open the queue that needs attention.
  const status = requested ? adminUserTabSchema.parse(requested) : counts.pending > 0 ? "pending" : "active";
  const users = await (await getRepositoryForRequest()).listUsers(status);
  const needle = query.toLowerCase();
  const digits = needle.replace(/\D/g, "").replace(/^0/, "");
  const list = needle
    ? users.filter(
        (u) =>
          u.fullName.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle) || (digits.length >= 3 && (u.phone ?? "").includes(digits)),
      )
    : users;
  const total = counts.pending + counts.active + counts.denied + counts.revoked;

  return (
    <div>
      <PageHeader
        variant="operational"
        title="Users"
        description={`${total} ${total === 1 ? "account" : "accounts"}. New sign-ups can't book until you approve them. Accounts are never deleted.`}
        actions={
          <form role="search" className="flex w-full gap-2 sm:w-80">
            <input type="hidden" name="status" value={status} />
            <label htmlFor="q" className="sr-only">
              Search by name, email or phone
            </label>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Input id="q" name="q" type="search" defaultValue={query} placeholder="Name, email or phone" className="h-10 pl-9" />
            </div>
            <button type="submit" className={buttonStyles({ variant: "secondary", size: "sm", className: "h-10" })}>
              Search
            </button>
          </form>
        }
      />

      <LinkTabs label="Account status" tabs={tabs.map((tab) => ({ href: tabHref(tab.status, query), label: tab.label, count: counts[tab.status], active: tab.status === status }))} />

      {list.length === 0 ? (
        <EmptyState className="mt-10" {...(query ? { title: "No matching accounts", description: "Try a different name, email or phone number." } : empty[status])} />
      ) : (
        <ul className="divide-y divide-line border-b border-line">
          <li className="hidden grid-cols-[minmax(0,1fr)_10rem_7rem_5rem_minmax(0,12rem)] gap-6 py-2.5 text-xs font-bold text-muted lg:grid" aria-hidden>
            <span>Name</span>
            <span>Mobile</span>
            <span>Joined</span>
            <span className="text-right">Bookings</span>
            <span className="text-right">{status === "pending" ? "Decision" : "Status"}</span>
          </li>
          {list.map((user) => (
            <li
              key={user.id}
              className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-4 transition-colors hover:bg-sunken/40 lg:grid-cols-[minmax(0,1fr)_10rem_7rem_5rem_minmax(0,12rem)] lg:py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={user.fullName || user.email} />
                <div className="min-w-0">
                  <Link href={`/admin/users/${user.id}`} className="flex items-center gap-1.5 truncate text-[15px] font-extrabold after:absolute after:inset-0 group-hover:text-brand">
                    <span className="truncate">{user.fullName || "Unnamed"}</span>
                    {user.role === "admin" && <ShieldCheck className="size-4 shrink-0 text-brand" aria-label="Admin" />}
                  </Link>
                  <p className="truncate text-[13px] text-muted">{user.email}</p>
                </div>
              </div>
              <p className="col-start-1 text-sm text-ink-soft tabular-nums lg:col-start-auto">
                {formatPhone(user.phone)}
                <span className="text-muted lg:hidden"> · Joined {formatDate(user.createdAt, "d MMM yyyy")} · {user.bookingCount} bookings</span>
              </p>
              <p className="hidden text-sm text-muted tabular-nums lg:block">{formatDate(user.createdAt, "d MMM yyyy")}</p>
              <p className="hidden text-right text-sm font-bold tabular-nums lg:block">{user.bookingCount}</p>
              <div className="relative z-10 col-start-2 row-span-2 row-start-1 flex justify-end lg:col-start-auto lg:row-span-1 lg:row-start-auto">
                {status === "pending" ? <AccessActions userId={user.id} userName={user.fullName || user.email} status={user.accessStatus} compact /> : <AccessStatusMark status={user.accessStatus} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
