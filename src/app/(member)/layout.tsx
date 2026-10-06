import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";
import { MemberShell } from "@/components/shell/member-shell";

export default async function MemberLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <MemberShell user={user}>{children}</MemberShell>;
}
