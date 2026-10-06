import "server-only";
import { NextResponse } from "next/server";
import { isAuthorizedBotRequest } from "@/lib/bot/auth";
import { botError, type BotResponse } from "@/lib/bot/errors";
import { normalizeSenderPhone } from "@/lib/bot/input";
import { botLimits } from "@/lib/bot/rate-limit";
import type { BotDeps } from "@/lib/bot/tools";

const MAX_BODY_BYTES = 16 * 1024;
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

const json = (body: BotResponse, status = 200, extra: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...HEADERS, ...extra } });

function clientIp(request: Request): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

type Tool = (body: unknown, deps: BotDeps) => Promise<BotResponse>;

/**
 * Wraps one bot tool as a POST route: API key, rate limits, a small JSON body,
 * then the tool. Business outcomes (including errors such as ROOM_NOT_FOUND)
 * come back as HTTP 200 with `ok: false` so the n8n AI Agent always receives the
 * JSON; only auth (401), rate limits (429), malformed requests (400) and
 * unexpected failures (500) use other statuses.
 */
export function botRoute(name: string, tool: Tool, options: { createsBooking?: boolean } = {}) {
  return async function POST(request: Request): Promise<NextResponse> {
    const ip = clientIp(request);

    if (!isAuthorizedBotRequest(request)) {
      const limited = botLimits.failedAuth.take(ip);
      if (!limited.ok) return json(botError("RATE_LIMITED", "Too many requests.", { retryAfterSeconds: limited.retryAfterSeconds }), 429, { "Retry-After": String(limited.retryAfterSeconds) });
      return json(botError("UNAUTHORIZED_BOT", "Missing or invalid API key."), 401, { "WWW-Authenticate": "Bearer" });
    }

    const global = botLimits.global.take("all");
    if (!global.ok) return json(botError("RATE_LIMITED", "Too many requests.", { retryAfterSeconds: global.retryAfterSeconds }), 429, { "Retry-After": String(global.retryAfterSeconds) });

    const raw = await request.text().catch(() => "");
    if (raw.length > MAX_BODY_BYTES) return json(botError("INVALID_REQUEST", "Request body is too large."), 400);
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(botError("INVALID_REQUEST", "Request body must be JSON."), 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return json(botError("INVALID_REQUEST", "Request body must be a JSON object."), 400);

    const phone = normalizeSenderPhone((body as { phone?: unknown }).phone) ?? "invalid";
    for (const limiter of options.createsBooking ? [botLimits.perPhone, botLimits.bookingsPerPhone] : [botLimits.perPhone]) {
      const limited = limiter.take(`${limiter === botLimits.perPhone ? "phone" : "book"}:${phone}`);
      if (!limited.ok) return json(botError("RATE_LIMITED", "Too many requests from this sender. Wait a moment.", { retryAfterSeconds: limited.retryAfterSeconds }), 429, { "Retry-After": String(limited.retryAfterSeconds) });
    }

    try {
      const { getBotDeps } = await import("@/lib/bot/deps");
      return json(await tool(body, await getBotDeps()));
    } catch (error) {
      // Never log the request body or headers: they carry phone numbers and the API key.
      console.error(`[bot] ${name} failed:`, error instanceof Error ? error.message : error);
      return json(botError("INTERNAL_ERROR", "Something went wrong. Try again shortly.", { retryable: true }), 500);
    }
  };
}
