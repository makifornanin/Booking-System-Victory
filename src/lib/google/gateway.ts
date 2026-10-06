import "server-only";
import { connection } from "next/server";
import { getGoogleEnv, getGoogleMode, type GoogleMode } from "@/lib/env";
import type { CalendarEventInput } from "@/lib/google/api";

export type { CalendarEventInput };

/** What the booking services need from each member's Google Calendar. */
export interface GoogleCalendarGateway {
  readonly mode: GoogleMode;
  /** When false (local development without Google credentials), bookings don't require a connection. */
  readonly required: boolean;
  isConnected(userId: string): Promise<boolean>;
  saveConnection(userId: string, refreshToken: string, scope: string): Promise<void>;
  disconnect(userId: string): Promise<void>;
  /** Idempotent: returns the event id, creating the event only if it doesn't exist yet. */
  createBookingEvent(userId: string, event: CalendarEventInput): Promise<string>;
  /** Removes only the given event id. */
  deleteBookingEvent(userId: string, eventId: string): Promise<void>;
}

const globalForGoogle = globalThis as typeof globalThis & { __victoryGoogleTokens?: Map<string, { token: string; expiresAt: number }> };

function createLiveGoogleGateway(): GoogleCalendarGateway {
  const secret = () => getGoogleEnv().GOOGLE_TOKEN_ENCRYPTION_KEY;
  const accessTokens = (globalForGoogle.__victoryGoogleTokens ??= new Map());
  const deps = async () => {
    const [api, crypto, db] = await Promise.all([import("@/lib/google/api"), import("@/lib/google/crypto"), import("@/lib/db/client")]);
    return { api, crypto, db };
  };

  async function storedRefreshToken(userId: string): Promise<string | null> {
    const { crypto, db } = await deps();
    const rows = await db.systemQuery<{ refresh_token_ciphertext: string }>(
      "select refresh_token_ciphertext from public.google_calendar_connections where user_id = $1",
      [userId],
    );
    return rows[0] ? crypto.decryptSecret(rows[0].refresh_token_ciphertext, secret()) : null;
  }

  async function accessTokenFor(userId: string): Promise<string> {
    const cached = accessTokens.get(userId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const refreshToken = await storedRefreshToken(userId);
    const { api, db } = await deps();
    if (!refreshToken) throw new api.GoogleCalendarError("revoked", "Google Calendar isn't connected.");
    try {
      const tokens = await api.refreshAccessToken(refreshToken);
      accessTokens.set(userId, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 });
      return tokens.access_token;
    } catch (error) {
      if (error instanceof api.GoogleCalendarError && error.kind === "revoked") {
        // The user removed access in their Google account; forget the dead token.
        await db.systemQuery("delete from public.google_calendar_connections where user_id = $1", [userId]);
      }
      throw error;
    }
  }

  return {
    mode: "google",
    required: true,
    async isConnected(userId) {
      const { db } = await deps();
      const rows = await db.systemQuery("select 1 from public.google_calendar_connections where user_id = $1", [userId]);
      return rows.length > 0;
    },
    async saveConnection(userId, refreshToken, scope) {
      const { crypto, db } = await deps();
      await db.systemQuery(
        `insert into public.google_calendar_connections (user_id, refresh_token_ciphertext, scope) values ($1, $2, $3)
         on conflict (user_id) do update set refresh_token_ciphertext = excluded.refresh_token_ciphertext, scope = excluded.scope`,
        [userId, crypto.encryptSecret(refreshToken, secret()), scope],
      );
      accessTokens.delete(userId);
    },
    async disconnect(userId) {
      const { api, db } = await deps();
      const refreshToken = await storedRefreshToken(userId).catch(() => null);
      if (refreshToken) await api.revokeToken(refreshToken);
      await db.systemQuery("delete from public.google_calendar_connections where user_id = $1", [userId]);
      accessTokens.delete(userId);
    },
    async createBookingEvent(userId, event) {
      const { api } = await deps();
      return api.insertEvent(await accessTokenFor(userId), event);
    },
    async deleteBookingEvent(userId, eventId) {
      const { api } = await deps();
      await api.deleteEvent(await accessTokenFor(userId), eventId);
    },
  };
}

/** Local development without Google credentials: no requirement, no sync. */
const disabledGoogleGateway: GoogleCalendarGateway = {
  mode: "disabled",
  required: false,
  isConnected: async () => false,
  saveConnection: async () => undefined,
  disconnect: async () => undefined,
  createBookingEvent: async () => {
    throw new Error("Google Calendar sync is disabled in this environment.");
  },
  deleteBookingEvent: async () => undefined,
};

export async function getGoogleCalendar(): Promise<GoogleCalendarGateway> {
  await connection();
  const mode = getGoogleMode();
  if (mode === "demo") {
    const { createDemoGoogleGateway } = await import("@/lib/demo/google");
    return createDemoGoogleGateway();
  }
  return mode === "google" ? createLiveGoogleGateway() : disabledGoogleGateway;
}
