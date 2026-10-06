import { NextResponse, type NextRequest } from "next/server";
import { DEMO_SESSION_COOKIE, PROTECTED_PREFIXES } from "@/lib/auth/constants";
import { getNeonAuth } from "@/lib/auth/neon-instance";

function loginRedirect(request: NextRequest): NextResponse {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

/**
 * Redirects signed-out visitors away from protected pages and refreshes the
 * Neon Auth session. This is a convenience layer only: every page and server
 * action verifies the user (and admin role) again on the server.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!isProtected) return NextResponse.next();

  const isDevelopment = process.env.NODE_ENV !== "production";
  const hasNeon = Boolean(process.env.DATABASE_URL?.trim() || process.env.NEON_AUTH_BASE_URL?.trim());
  const demo = isDevelopment && (process.env.DEMO_MODE === "true" || !hasNeon);

  if (demo) {
    return request.cookies.has(DEMO_SESSION_COOKIE) ? NextResponse.next() : loginRedirect(request);
  }

  let response: NextResponse;
  try {
    response = await getNeonAuth().middleware({ loginUrl: "/login" })(request);
  } catch (error) {
    // Misconfigured auth: let the page render its configuration error.
    console.error("[proxy] auth middleware failed:", error instanceof Error ? error.message : error);
    return NextResponse.next();
  }

  // Keep the page the visitor wanted so sign-in can return them there.
  const location = response.headers.get("location");
  if (location && new URL(location, request.url).pathname === "/login") {
    const redirect = loginRedirect(request);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|demo/|api/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
