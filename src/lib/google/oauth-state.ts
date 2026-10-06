import "server-only";
import { randomBytes } from "node:crypto";
import { getGoogleEnv } from "@/lib/env";
import { signValue, verifySignedValue } from "@/lib/google/crypto";
import { safeRedirectPath } from "@/lib/utils";

export const GOOGLE_OAUTH_COOKIE = "vr_google_oauth";

export interface OAuthState {
  state: string;
  userId: string;
  verifier: string;
  returnTo: string;
}

/** Signed, short-lived cookie that ties the Google callback to this user and browser. */
export function createOAuthState(userId: string, verifier: string, returnTo: string): { cookie: string; state: string } {
  const state = randomBytes(24).toString("base64url");
  const payload: OAuthState = { state, userId, verifier, returnTo: safeRedirectPath(returnTo, "/account") };
  return { state, cookie: signValue(JSON.stringify(payload), getGoogleEnv().GOOGLE_TOKEN_ENCRYPTION_KEY) };
}

export function readOAuthState(cookie: string | undefined): OAuthState | null {
  const value = verifySignedValue(cookie, getGoogleEnv().GOOGLE_TOKEN_ENCRYPTION_KEY);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as OAuthState;
    return typeof parsed.state === "string" && typeof parsed.userId === "string" && typeof parsed.verifier === "string"
      ? { ...parsed, returnTo: safeRedirectPath(parsed.returnTo, "/account") }
      : null;
  } catch {
    return null;
  }
}
