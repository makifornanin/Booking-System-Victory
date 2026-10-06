import "server-only";
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { getAuthProvider, type SessionUser } from "@/lib/auth/provider";

export type { SessionUser };

/**
 * Verified current user (session checked with the auth server; role and access
 * read from the database). Memoized per request, so layouts, pages and the
 * repository share one lookup.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const provider = await getAuthProvider();
  return provider.getCurrentUser();
});

/** Signed in, any access status. Used only by the waiting screen. */
export async function requireSignedIn(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed in with active portal access; everyone else goes to the waiting screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await requireSignedIn();
  if (user.accessStatus !== "active") redirect("/pending");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") forbidden();
  return user;
}

export function isActive(user: SessionUser | null): user is SessionUser {
  return Boolean(user && user.accessStatus === "active");
}
