import { createHash } from "node:crypto";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { ConfigError } from "@/lib/config-error";

type NeonAuthInstance = ReturnType<typeof createNeonAuth>;

const globalForAuth = globalThis as typeof globalThis & { __victoryNeonAuth?: NeonAuthInstance };

function cookieSecret(): string {
  const configured = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) throw new ConfigError("NEON_AUTH_COOKIE_SECRET must be at least 32 characters.");
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new ConfigError("Missing NEON_AUTH_COOKIE_SECRET. Generate one with `openssl rand -base64 32`.");
  }
  // Development only: a stable per-developer secret derived from local config, so
  // sessions survive restarts and the proxy and app agree without extra setup.
  return createHash("sha256").update(`victory-rooms-dev-cookie:${process.env.DATABASE_URL ?? ""}`).digest("hex");
}

/**
 * Lazily created Neon Auth (Better Auth) instance. Created on first use rather
 * than at import time, so builds don't need auth secrets.
 */
export function getNeonAuth(): NeonAuthInstance {
  if (!globalForAuth.__victoryNeonAuth) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
    if (!baseUrl) throw new ConfigError("Missing NEON_AUTH_BASE_URL.");
    if (!process.env.NEON_AUTH_COOKIE_SECRET?.trim() && process.env.NODE_ENV !== "production") {
      console.warn("[auth] NEON_AUTH_COOKIE_SECRET is not set; using a development-only secret.");
    }
    globalForAuth.__victoryNeonAuth = createNeonAuth({
      baseUrl: baseUrl.replace(/\/$/, ""),
      cookies: { secret: cookieSecret(), sameSite: "lax" },
    });
  }
  return globalForAuth.__victoryNeonAuth;
}
