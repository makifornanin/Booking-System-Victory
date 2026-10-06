import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateKeyInZone, zonedDateTime, zonedDayRange } from "@/lib/domain/time";
import { getFreeSlots } from "@/lib/ghl/calendars";
import { resolveCalendarId, type CalendarGateway } from "@/lib/ghl/gateway";
import { getRoomDayAvailability } from "@/lib/services/availability";

const DAY = "2026-10-07";
const NOW = new Date("2026-10-06T14:03:00Z"); // 22:03 on 6 October in Manila

/** Hourly-ish slot starts in Manila time for one calendar. */
const starts = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = zonedDateTime(DAY, from).getTime(); t < zonedDateTime(DAY, to).getTime(); t += 30 * 60_000) out.push(new Date(t).toISOString());
  return out;
};

const ROOMS = [
  { id: "room-a", slug: "room-a", ghlCalendarId: "cal-a", open: ["08:00", "10:00"] },
  { id: "room-b", slug: "room-b", ghlCalendarId: "cal-b", open: ["10:00", "12:00"] },
  { id: "room-c", slug: "room-c", ghlCalendarId: "cal-c", open: ["12:00", "14:00"] },
  { id: "room-d", slug: "room-d", ghlCalendarId: "cal-d", open: ["14:00", "16:00"] },
  { id: "events-place-a", slug: "events-place-a", ghlCalendarId: "cal-e", open: ["16:00", "18:00"] },
] as const;

function gateway(slotsByCalendar: Record<string, string[]>, calls: string[] = []): CalendarGateway {
  return {
    mode: "ghl",
    async getFreeSlotStarts(calendarId: string) {
      calls.push(calendarId);
      return slotsByCalendar[calendarId] ?? [];
    },
    async getCalendarInfo(calendarId: string) {
      return { id: calendarId, name: calendarId, isActive: true, slotIntervalMinutes: 30, slotDurationMinutes: 30, assignedUserId: "staff" };
    },
  } as unknown as CalendarGateway;
}

const deps = (calendar: CalendarGateway) => ({ repo: { getBusyRanges: async () => [] }, calendar, now: () => NOW });
const available = (slots: { start: string; status: string }[]) => slots.filter((s) => s.status === "available").map((s) => s.start);

describe("Asia/Manila date boundaries", () => {
  it("a selected date stays the same Philippine calendar date", () => {
    const { start, end } = zonedDayRange(DAY);
    expect(start.toISOString()).toBe("2026-10-06T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-07T16:00:00.000Z");
    expect(dateKeyInZone(start)).toBe(DAY);
    expect(dateKeyInZone(new Date(end.getTime() - 1))).toBe(DAY);
    expect(dateKeyInZone(zonedDateTime(DAY, "00:00"))).toBe(DAY);
    expect(dateKeyInZone(zonedDateTime(DAY, "23:30"))).toBe(DAY);
  });

  it("only offers slots on the selected date, even if GHL returns neighbouring days", async () => {
    const neighbours = [new Date(zonedDateTime(DAY, "09:00").getTime() - 86_400_000).toISOString(), ...starts("09:00", "10:00"), new Date(zonedDateTime(DAY, "09:00").getTime() + 86_400_000).toISOString()];
    const result = await getRoomDayAvailability(ROOMS[0], DAY, deps(gateway({ "cal-a": neighbours })));
    expect(available(result.slots)).toEqual(starts("09:00", "10:00"));
    expect(result.slots.every((slot) => dateKeyInZone(new Date(slot.start)) === DAY)).toBe(true);
  });
});

describe("room calendars", () => {
  it("every correctly configured room exposes its own valid slots", async () => {
    const slotsByCalendar = Object.fromEntries(ROOMS.map((room) => [room.ghlCalendarId, starts(room.open[0], room.open[1])]));
    for (const room of ROOMS) {
      const calls: string[] = [];
      const result = await getRoomDayAvailability(room, DAY, deps(gateway(slotsByCalendar, calls)));
      expect(result.problem).toBeNull();
      expect(calls).toEqual([room.ghlCalendarId]);
      expect(available(result.slots)).toEqual(starts(room.open[0], room.open[1]));
    }
  });

  it("a room never uses another room's calendar ID", async () => {
    expect(resolveCalendarId(gateway({}), { slug: "room-b", ghlCalendarId: "cal-b" })).toBe("cal-b");
    expect(resolveCalendarId(gateway({}), { slug: "room-c", ghlCalendarId: null })).toBeNull();

    const calls: string[] = [];
    const result = await getRoomDayAvailability({ id: "room-c", slug: "room-c", ghlCalendarId: null }, DAY, deps(gateway({ "cal-a": starts("08:00", "20:00") }, calls)));
    expect(result.problem).toBe("calendar_not_configured");
    expect(available(result.slots)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("free-slot cache", () => {
  beforeEach(() => {
    vi.stubEnv("GHL_PRIVATE_INTEGRATION_TOKEN", "pit-test-token-123");
    vi.stubEnv("GHL_LOCATION_ID", "loc-test-123");
    (globalThis as { __victoryFreeSlots?: Map<string, unknown> }).__victoryFreeSlots = new Map();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("queries GHL with the exact Manila day and keeps each calendar's slots separate", async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        requested.push(url);
        const calendarId = url.pathname.split("/")[2];
        const slot = calendarId === "cal-a" ? "2026-10-07T08:00:00+08:00" : "2026-10-07T15:00:00+08:00";
        return new Response(JSON.stringify({ [DAY]: { slots: [slot] }, traceId: "t" }), { status: 200 });
      }),
    );
    const { start, end } = zonedDayRange(DAY);

    const a = await getFreeSlots("cal-a", start, end, 30_000);
    const b = await getFreeSlots("cal-b", start, end, 30_000);
    const aAgain = await getFreeSlots("cal-a", start, end, 30_000);

    expect(a).toEqual(["2026-10-07T08:00:00+08:00"]);
    expect(b).toEqual(["2026-10-07T15:00:00+08:00"]);
    expect(aAgain).toEqual(a);
    expect(requested).toHaveLength(2); // the third call was served from cache, for the same calendar only
    expect(requested[0].searchParams.get("startDate")).toBe(String(start.getTime()));
    expect(requested[0].searchParams.get("endDate")).toBe(String(end.getTime()));
    expect(requested[0].searchParams.get("timezone")).toBe("Asia/Manila");
  });

  it("booking checks bypass the display cache", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ [DAY]: { slots: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { start, end } = zonedDayRange(DAY);
    await getFreeSlots("cal-d", start, end, 30_000);
    await getFreeSlots("cal-d", start, end, 0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
