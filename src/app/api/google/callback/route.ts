import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getGoogleMode } from "@/lib/env";
import { GOOGLE_CALENDAR_SCOPE, exchangeAuthorizationCode } from "@/lib/google/api";
import { getGoogleCalendar } from "@/lib/google/gateway";
import { GOOGLE_OAUTH_COOKIE, readOAuthState } from "@/lib/google/oauth-state";

function sameValue(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Google redirects here after consent. The refresh token is encrypted and stored
 * server-side; it never reaches the browser.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = getGoogleMode() === "google" ? readOAuthState(request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value) : null;
  const returnTo = saved?.returnTo ?? "/account";

  const finish = (status: string) => {
    const url = new URL(returnTo, request.url);
    url.searchParams.set("google", status);
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: GOOGLE_OAUTH_COOKIE, path: "/api/google" });
    return response;
  };

  const user = await getCurrentUser();
  const state = params.get("state");
  if (!saved || !user || !state || !sameValue(state, saved.state) || saved.userId !== user.id) return finish("error");
  if (params.get("error")) return finish(params.get("error") === "access_denied" ? "declined" : "error");

  const code = params.get("code");
  if (!code) return finish("error");

  try {
    const tokens = await exchangeAuthorizationCode(code, saved.verifier);
    const granted = (tokens.scope ?? "").split(/\s+/);
    if (!granted.includes(GOOGLE_CALENDAR_SCOPE)) return finish("scope");
    if (!tokens.refresh_token) return finish("no_refresh");
    await (await getGoogleCalendar()).saveConnection(user.id, tokens.refresh_token, tokens.scope ?? GOOGLE_CALENDAR_SCOPE);
    return finish("connected");
  } catch (error) {
    console.error("[google] OAuth callback failed:", error instanceof Error ? error.message : error);
    return finish("error");
  }
}
