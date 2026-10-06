import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { TIME_ZONE } from "@/lib/config";
import { formatInZone } from "@/lib/domain/time";
import { getGoogleEnv } from "@/lib/env";

/** Minimal scope: create and manage events on calendars the user owns. */
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";

export type GoogleErrorKind = "revoked" | "unavailable" | "rejected" | "config";

export class GoogleCalendarError extends Error {
  constructor(
    public readonly kind: GoogleErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizationUrl(state: string, codeChallenge: string): string {
  const env = getGoogleEnv();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    // Offline access + consent so Google returns a refresh token for automatic sync.
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

async function tokenRequest(params: Record<string, string>) {
  const env = getGoogleEnv();
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleCalendarError("unavailable", "Google couldn't be reached.");
  }
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    // Never log the code or tokens; the error name is enough to diagnose.
    console.error(`[google] token request failed: HTTP ${response.status} ${body?.error ?? ""}`);
    if (body?.error === "invalid_grant") throw new GoogleCalendarError("revoked", "Google access was revoked or expired.", response.status);
    throw new GoogleCalendarError(response.status >= 500 ? "unavailable" : "rejected", "Google rejected the request.", response.status);
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) throw new GoogleCalendarError("unavailable", "Unexpected response from Google.");
  return parsed.data;
}

export function exchangeAuthorizationCode(code: string, codeVerifier: string) {
  return tokenRequest({ code, code_verifier: codeVerifier, grant_type: "authorization_code", redirect_uri: getGoogleEnv().GOOGLE_REDIRECT_URI });
}

export function refreshAccessToken(refreshToken: string) {
  return tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

export async function revokeToken(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/** Google event ids must be base32hex (0-9, a-v). A booking UUID's hex digits qualify. */
export function bookingEventId(bookingId: string): string {
  return `vrb${bookingId.replace(/-/g, "").toLowerCase()}`;
}

export interface CalendarEventInput {
  bookingId: string;
  summary: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
}

export function buildEventBody(input: CalendarEventInput) {
  const local = (date: Date) => formatInZone(date, "yyyy-MM-dd'T'HH:mm:ss");
  return {
    id: bookingEventId(input.bookingId),
    summary: input.summary,
    description: input.description,
    location: input.location || undefined,
    start: { dateTime: local(input.start), timeZone: TIME_ZONE },
    end: { dateTime: local(input.end), timeZone: TIME_ZONE },
  };
}

async function calendarRequest(accessToken: string, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleCalendarError("unavailable", "Google Calendar couldn't be reached.");
  }
}

/**
 * Inserts the booking's event with a deterministic id. If it already exists
 * (retry, double approval), Google answers 409 and nothing is duplicated.
 */
export async function insertEvent(accessToken: string, input: CalendarEventInput): Promise<string> {
  const body = buildEventBody(input);
  const response = await calendarRequest(accessToken, "", { method: "POST", body: JSON.stringify(body) });
  if (response.ok || response.status === 409) return body.id;
  console.error(`[google] insert event failed: HTTP ${response.status}`);
  if (response.status === 401) throw new GoogleCalendarError("revoked", "Google access was revoked.", 401);
  throw new GoogleCalendarError(response.status >= 500 ? "unavailable" : "rejected", "Google Calendar rejected the event.", response.status);
}

/** Deletes only the given event. Already-deleted events count as success. */
export async function deleteEvent(accessToken: string, eventId: string): Promise<void> {
  const response = await calendarRequest(accessToken, `/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  if (response.ok || response.status === 404 || response.status === 410) return;
  console.error(`[google] delete event failed: HTTP ${response.status}`);
  throw new GoogleCalendarError(response.status >= 500 ? "unavailable" : "rejected", "Google Calendar rejected the change.", response.status);
}
