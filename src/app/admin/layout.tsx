import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/session";
import { getBookingCounts, getUserCounts } from "@/lib/data/queries";
import { AdminShell } from "@/components/shell/admin-shell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAdmin();
  const [bookings, users] = await Promise.all([getBookingCounts(), getUserCounts()]);
  return (
    <AdminShell user={user} pendingBookings={bookings.pending} pendingUsers={users.pending}>
      {children}
    </AdminShell>
  );
}
