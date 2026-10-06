import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAppointmentBody, resolveAssignedUserId } from "@/lib/ghl/calendars";
import { bookingEventId, buildEventBody } from "@/lib/google/api";
import { decryptSecret, encryptSecret, signValue, verifySignedValue } from "@/lib/google/crypto";
import { cleanPassage, esvReadingUrl, referenceForDate, VERSE_REFERENCES } from "@/lib/verse/references";
import { getVerseForDate, type VerseStore } from "@/lib/verse/service";

describe("GHL assigned team member", () => {
  it("prefers the primary selected member, then priority, then any member", () => {
    expect(resolveAssignedUserId([{ userId: "a", selected: true, priority: 1 }, { userId: "b", isPrimary: true, selected: true }])).toBe("b");
    expect(resolveAssignedUserId([{ userId: "a", selected: true, priority: 0.2 }, { userId: "b", selected: true, priority: 0.8 }])).toBe("b");
    expect(resolveAssignedUserId([{ userId: "a", selected: false }])).toBe("a");
    expect(resolveAssignedUserId([{ userId: null, isPrimary: true }])).toBeNull();
    expect(resolveAssignedUserId([])).toBeNull();
    expect(resolveAssignedUserId(undefined)).toBeNull();
  });

  it("puts assignedUserId and a confirmed status on the appointment payload", () => {
    const body = buildAppointmentBody(
      {
        calendarId: "cal-1",
        contactId: "contact-1",
        assignedUserId: "staff-9",
        start: new Date("2030-03-12T02:00:00Z"),
        end: new Date("2030-03-12T04:30:00Z"),
        title: "Youth Practice — Jamie",
      },
      "loc-1",
    );
    expect(body).toMatchObject({
      calendarId: "cal-1",
      locationId: "loc-1",
      contactId: "contact-1",
      assignedUserId: "staff-9",
      startTime: "2030-03-12T10:00:00+08:00",
      endTime: "2030-03-12T12:30:00+08:00",
      appointmentStatus: "confirmed",
      toNotify: true,
    });
  });
});

describe("Google token protection", () => {
  const key = "k".repeat(40);

  it("encrypts refresh tokens at rest and detects tampering or the wrong key", () => {
    const sealed = encryptSecret("1//refresh-token", key);
    expect(sealed).not.toContain("refresh-token");
    expect(decryptSecret(sealed, key)).toBe("1//refresh-token");
    expect(() => decryptSecret(sealed, "x".repeat(40))).toThrow();
    const [v, iv, tag, data] = sealed.split(".");
    expect(() => decryptSecret([v, iv, tag, data.slice(0, -2) + "AA"].join("."), key)).toThrow();
  });

  it("signs the OAuth state cookie", () => {
    const signed = signValue('{"state":"abc"}', key);
    expect(verifySignedValue(signed, key)).toBe('{"state":"abc"}');
    expect(verifySignedValue(signed.replace(/.$/, signed.endsWith("A") ? "B" : "A"), key)).toBeNull();
    expect(verifySignedValue(undefined, key)).toBeNull();
  });

  it("builds a deterministic, valid event id and a Manila-time event", () => {
    const id = bookingEventId("c7a1e2d4-6b3f-4a8e-9c2d-200000000001");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(bookingEventId("c7a1e2d4-6b3f-4a8e-9c2d-200000000001")).toBe(id);
    const body = buildEventBody({
      bookingId: "c7a1e2d4-6b3f-4a8e-9c2d-200000000001",
      summary: "Youth Practice",
      description: "Victory Church Room Booking",
      location: "Room A",
      start: new Date("2030-03-12T02:00:00Z"),
      end: new Date("2030-03-12T03:00:00Z"),
    });
    expect(body).toMatchObject({
      id,
      summary: "Youth Practice",
      start: { dateTime: "2030-03-12T10:00:00", timeZone: "Asia/Manila" },
      end: { dateTime: "2030-03-12T11:00:00", timeZone: "Asia/Manila" },
    });
  });
});

describe("Google OAuth callback", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@host/db");
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.com/neondb/auth");
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id-123");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret-123");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/google/callback");
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", "e".repeat(40));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@/lib/auth/session");
    vi.doUnmock("@/lib/google/gateway");
    vi.unstubAllGlobals();
  });

  async function setup(userId: string | null) {
    const saved: { userId: string; refreshToken: string }[] = [];
    vi.doMock("@/lib/auth/session", () => ({
      getCurrentUser: async () => (userId ? { id: userId, accessStatus: "active" } : null),
    }));
    vi.doMock("@/lib/google/gateway", () => ({
      getGoogleCalendar: async () => ({ saveConnection: async (id: string, token: string) => saved.push({ userId: id, refreshToken: token }) }),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ access_token: "at", expires_in: 3600, refresh_token: "1//rt", scope: "https://www.googleapis.com/auth/calendar.events.owned" }),
      ),
    );
    const { createOAuthState, GOOGLE_OAUTH_COOKIE } = await import("@/lib/google/oauth-state");
    const { GET } = await import("@/app/api/google/callback/route");
    const { NextRequest } = await import("next/server");
    return { saved, createOAuthState, GOOGLE_OAUTH_COOKIE, GET, NextRequest };
  }

  it("stores the refresh token for the signed-in user and returns to the booking flow", async () => {
    const { saved, createOAuthState, GOOGLE_OAUTH_COOKIE, GET, NextRequest } = await setup("user-1");
    const { state, cookie } = createOAuthState("user-1", "verifier", "/rooms/room-a?date=2030-03-12");
    const request = new NextRequest(`http://localhost:3000/api/google/callback?code=abc&state=${state}`, {
      headers: { cookie: `${GOOGLE_OAUTH_COOKIE}=${cookie}` },
    });
    const response = await GET(request);
    expect(response.headers.get("location")).toBe("http://localhost:3000/rooms/room-a?date=2030-03-12&google=connected");
    expect(saved).toEqual([{ userId: "user-1", refreshToken: "1//rt" }]);
    expect(response.headers.get("location")).not.toContain("1//rt");
  });

  it("rejects a mismatched state or a different signed-in user", async () => {
    const { saved, createOAuthState, GOOGLE_OAUTH_COOKIE, GET, NextRequest } = await setup("someone-else");
    const { state, cookie } = createOAuthState("user-1", "verifier", "/account");
    const wrongUser = await GET(new NextRequest(`http://localhost:3000/api/google/callback?code=abc&state=${state}`, { headers: { cookie: `${GOOGLE_OAUTH_COOKIE}=${cookie}` } }));
    expect(wrongUser.headers.get("location")).toContain("google=error");
    const wrongState = await GET(new NextRequest("http://localhost:3000/api/google/callback?code=abc&state=forged", { headers: { cookie: `${GOOGLE_OAUTH_COOKIE}=${cookie}` } }));
    expect(wrongState.headers.get("location")).toContain("google=error");
    expect(saved).toEqual([]);
  });
});

describe("Verse of the Day", () => {
  afterEach(() => {
    (globalThis as { __victoryVerse?: unknown }).__victoryVerse = undefined;
  });

  it("chooses the same reference for a date and rotates daily", () => {
    expect(referenceForDate("2030-03-12")).toBe(referenceForDate("2030-03-12"));
    expect(referenceForDate("2030-03-12")).not.toBe(referenceForDate("2030-03-13"));
    const seen = new Set(Array.from({ length: VERSE_REFERENCES.length }, (_, i) => referenceForDate(`2030-01-${String(i + 1).padStart(2, "0")}`.slice(0, 10))));
    expect(seen.size).toBeGreaterThan(20);
  });

  it("fetches once per day and serves the cache afterwards", async () => {
    const rows = new Map<string, { reference: string; text: string }>();
    const store: VerseStore = { get: async (d) => rows.get(d) ?? null, put: async (d, v) => void rows.set(d, v) };
    const fetchVerse = vi.fn(async () => "I am the vine; you are the branches.");
    const first = await getVerseForDate("2030-03-12", { store, fetchVerse });
    const second = await getVerseForDate("2030-03-12", { store, fetchVerse });
    expect(first).toEqual(second);
    expect(fetchVerse).toHaveBeenCalledTimes(1);
    expect(rows.get("2030-03-12")?.text).toBe("I am the vine; you are the branches.");

    (globalThis as { __victoryVerse?: unknown }).__victoryVerse = undefined; // new server instance
    await getVerseForDate("2030-03-12", { store, fetchVerse });
    expect(fetchVerse).toHaveBeenCalledTimes(1);
  });

  it("falls back to the reference when the ESV API fails or no key is set", async () => {
    const failing = vi.fn(async () => {
      throw new Error("ESV down");
    });
    expect(await getVerseForDate("2030-03-14", { store: null, fetchVerse: failing })).toEqual({ reference: referenceForDate("2030-03-14"), text: null });
    expect(await getVerseForDate("2030-03-15", { store: null, fetchVerse: null })).toMatchObject({ text: null });
    expect(esvReadingUrl("John 15:5")).toBe("https://www.esv.org/John+15%3A5/");
    expect(cleanPassage("  I am the vine;\n\n  you are\nthe branches.  ")).toBe("I am the vine; you are the branches.");
  });
});
