import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { getBotApiKey } from "@/lib/env";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * True when the request carries `Authorization: Bearer <N8N_BOOKING_API_KEY>`.
 * Both sides are hashed first so the comparison is constant-time regardless of
 * length. With no key configured every request is refused.
 */
export function isAuthorizedBotRequest(request: Request): boolean {
  const key = getBotApiKey();
  if (!key) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(key));
}
