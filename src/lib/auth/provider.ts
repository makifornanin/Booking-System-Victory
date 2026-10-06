import "server-only";
import { connection } from "next/server";
import type { AccessStatus, Role } from "@/lib/data/types";
import { getDataMode } from "@/lib/env";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  /** Always read from the database, never from client-provided state. */
  role: Role;
  /** Only "active" accounts may use the portal; others see the waiting screen. */
  accessStatus: AccessStatus;
  accessReason: string | null;
}

export type AuthResult = { ok: true; message?: string; needsConfirmation?: boolean } | { ok: false; error: string };

export interface AuthProvider {
  getCurrentUser(): Promise<SessionUser | null>;
  signIn(email: string, password: string): Promise<AuthResult>;
  /** Creates the account and its profile (phone, pending access). */
  signUp(input: { fullName: string; email: string; phone: string; password: string }): Promise<AuthResult>;
  signOut(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<AuthResult>;
  sendPasswordReset(email: string, redirectTo: string): Promise<AuthResult>;
  resetPassword(token: string, newPassword: string): Promise<AuthResult>;
}

/** Auth is per request; `connection()` keeps pages that use it out of build-time prerendering. */
export async function getAuthProvider(): Promise<AuthProvider> {
  await connection();
  if (getDataMode() === "demo") {
    const { createDemoAuthProvider } = await import("@/lib/demo/auth");
    return createDemoAuthProvider();
  }
  const { createNeonAuthProvider } = await import("@/lib/auth/neon-auth");
  return createNeonAuthProvider();
}
