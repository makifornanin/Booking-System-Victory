import { describe, expect, it } from "vitest";
import { announcementStatus, selectLiveAnnouncements } from "@/lib/domain/announcements";
import { canMemberCancel, validateBookingWindow } from "@/lib/domain/booking-rules";
import { addDaysToKey, dateKeyInZone, formatTime, parseLocalDateTimeInput, zonedDateTime } from "@/lib/domain/time";
import { safeRedirectPath } from "@/lib/utils";

const now = new Date("2030-03-01T00:00:00Z"); // 08:00 in Manila
const day = "2030-03-12";
const at = (time: string) => zonedDateTime(day, time);

describe("time zone handling", () => {
  it("interprets dates in Asia/Manila (UTC+8)", () => {
    expect(zonedDateTime("2030-03-12", "09:00").toISOString()).toBe("2030-03-12T01:00:00.000Z");
    expect(dateKeyInZone(new Date("2030-03-11T17:00:00Z"))).toBe("2030-03-12");
    expect(formatTime(new Date("2030-03-12T01:00:00Z"))).toBe("9:00 AM");
  });

  it("parses datetime-local input as church time", () => {
    expect(parseLocalDateTimeInput("2030-03-12T18:30")?.toISOString()).toBe("2030-03-12T10:30:00.000Z");
    expect(parseLocalDateTimeInput("2030-02-30T18:30")).toBeNull();
    expect(parseLocalDateTimeInput("nonsense")).toBeNull();
  });
});

describe("booking window rules", () => {
  it("accepts a valid booking", () => {
    expect(validateBookingWindow({ start: at("09:00"), end: at("11:00"), now })).toBeNull();
  });

  it("rejects an end time before the start time", () => {
    expect(validateBookingWindow({ start: at("11:00"), end: at("09:00"), now })).toMatch(/after the start/);
    expect(validateBookingWindow({ start: at("11:00"), end: at("11:00"), now })).toMatch(/after the start/);
  });

  it("rejects times in the past", () => {
    expect(validateBookingWindow({ start: at("09:00"), end: at("10:00"), now: at("09:30") })).toMatch(/passed/);
  });

  it("rejects off-grid, overlong, after-hours and far-future bookings", () => {
    expect(validateBookingWindow({ start: at("09:10"), end: at("10:10"), now })).toMatch(/minute mark/);
    expect(validateBookingWindow({ start: at("08:00"), end: at("17:00"), now })).toMatch(/at most/);
    expect(validateBookingWindow({ start: at("21:30"), end: at("22:30"), now })).toMatch(/outside bookable hours/);
    const farDay = addDaysToKey(dateKeyInZone(now), 120);
    expect(
      validateBookingWindow({ start: zonedDateTime(farDay, "09:00"), end: zonedDateTime(farDay, "10:00"), now }),
    ).toMatch(/days ahead/);
  });

  it("lets members cancel only their future pending or approved bookings", () => {
    const startTime = at("09:00").toISOString();
    expect(canMemberCancel({ status: "pending", startTime }, now)).toBe(true);
    expect(canMemberCancel({ status: "approved", startTime }, now)).toBe(true);
    expect(canMemberCancel({ status: "denied", startTime }, now)).toBe(false);
    expect(canMemberCancel({ status: "pending", startTime }, at("10:00"))).toBe(false);
  });
});

describe("announcement visibility", () => {
  const base = { isPublished: true, publishAt: "2030-02-01T00:00:00Z", expiresAt: null as string | null };

  it("derives draft / scheduled / published / expired", () => {
    expect(announcementStatus({ ...base, isPublished: false }, now)).toBe("draft");
    expect(announcementStatus({ ...base, publishAt: "2030-04-01T00:00:00Z" }, now)).toBe("scheduled");
    expect(announcementStatus(base, now)).toBe("published");
    expect(announcementStatus({ ...base, expiresAt: "2030-02-15T00:00:00Z" }, now)).toBe("expired");
  });

  it("filters out expired, draft and scheduled posters and sorts newest first", () => {
    const items = [
      { id: "old", ...base },
      { id: "new", ...base, publishAt: "2030-02-20T00:00:00Z" },
      { id: "expired", ...base, expiresAt: "2030-02-28T23:59:59Z" },
      { id: "draft", ...base, isPublished: false },
      { id: "future", ...base, publishAt: "2030-03-02T00:00:00Z" },
    ];
    expect(selectLiveAnnouncements(items, now).map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("treats the exact expiry instant as expired", () => {
    expect(announcementStatus({ ...base, expiresAt: now.toISOString() }, now)).toBe("expired");
  });
});

describe("safe redirects", () => {
  it("allows only same-site relative paths", () => {
    expect(safeRedirectPath("/rooms/room-a")).toBe("/rooms/room-a");
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.example")).toBe("/dashboard");
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
  });
});
