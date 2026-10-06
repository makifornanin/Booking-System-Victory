import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { ConfigError, getGoogleMode, isProduction } from "@/lib/env";
import { safeRedirectPath } from "@/lib/utils";

/** Starts the one-time Google Calendar connection (OAuth consent). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (user.accessStatus !== "active") return NextResponse.redirect(new URL("/pending", request.url));

  const returnTo = safeRedirectPath(request.nextUrl.searchParams.get("returnTo"), "/account");
  const back = (status: string) => {
    const url = new URL(returnTo, request.url);
    url.searchParams.set("google", status);
    return NextResponse.redirect(url);
  };

  let mode;
  try {
    mode = getGoogleMode();
  } catch (error) {
    if (error instanceof ConfigError) return back("unavailable");
    throw error;
  }
  if (mode === "disabled") return back("unavailable");

  if (mode === "demo") {
    // Development only: simulate a successful consent.
    const { createDemoGoogleGateway } = await import("@/lib/demo/google");
    await createDemoGoogleGateway().saveConnection(user.id, "demo", "demo");
    return back("connected");
  }

  const [{ buildAuthorizationUrl, createPkcePair }, { createOAuthState, GOOGLE_OAUTH_COOKIE }] = await Promise.all([
    import("@/lib/google/api"),
    import("@/lib/google/oauth-state"),
  ]);
  const pkce = createPkcePair();
  const { state, cookie } = createOAuthState(user.id, pkce.verifier, returnTo);
  const response = NextResponse.redirect(buildAuthorizationUrl(state, pkce.challenge));
  response.cookies.set(GOOGLE_OAUTH_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/api/google",
    maxAge: 600,
  });
  return response;
}
