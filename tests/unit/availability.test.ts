import { describe, expect, it } from "vitest";
import {
  buildDaySlots,
  endOptionsFrom,
  findOverlapping,
  freeRangesFromSlotStarts,
  groupIntoSegments,
  isCoveredBy,
  isRangeBookable,
  mergeRanges,
  rangesOverlap,
  toRange,
} from "@/lib/domain/availability";
import { zonedDateTime } from "@/lib/domain/time";

const DATE = "2030-03-12"; // a Tuesday, far in the future
const at = (time: string) => zonedDateTime(DATE, time);
const range = (from: string, to: string) => toRange(at(from), at(to));

function slotStarts(from: string, to: string): string[] {
  const starts: string[] = [];
  for (let t = at(from).getTime(); t < at(to).getTime(); t += 30 * 60_000) starts.push(new Date(t).toISOString());
  return starts;
}

const baseInput = {
  dateKey: DATE,
  now: new Date("2030-01-01T00:00:00Z"),
  slotMinutes: 30,
  dayStartHour: 7,
  dayEndHour: 22,
};

describe("overlap detection", () => {
  it("detects overlapping ranges", () => {
    expect(rangesOverlap(range("09:00", "11:00"), range("10:00", "12:00"))).toBe(true);
    expect(rangesOverlap(range("09:00", "11:00"), range("09:30", "10:00"))).toBe(true);
  });

  it("treats touching ranges as not overlapping (half-open intervals)", () => {
    expect(rangesOverlap(range("09:00", "10:00"), range("10:00", "11:00"))).toBe(false);
  });

  it("finds all overlapping bookings", () => {
    const others = [range("08:00", "09:00"), range("09:30", "10:30"), range("11:00", "12:00")];
    expect(findOverlapping(range("09:00", "11:00"), others)).toEqual([range("09:30", "10:30")]);
  });

  it("merges adjacent and overlapping ranges", () => {
    expect(mergeRanges([range("10:00", "11:00"), range("09:00", "10:00"), range("10:30", "12:00")])).toEqual([
      range("09:00", "12:00"),
    ]);
  });
});

describe("GHL free slots", () => {
  it("turns slot starts into continuous free ranges", () => {
    const free = freeRangesFromSlotStarts([...slotStarts("09:00", "11:00"), ...slotStarts("13:00", "14:00")], 30);
    expect(free).toEqual([range("09:00", "11:00"), range("13:00", "14:00")]);
  });

  it("only covers a window that fits entirely inside free time", () => {
    const free = freeRangesFromSlotStarts(slotStarts("09:00", "11:00"), 30);
    expect(isCoveredBy(range("09:30", "11:00"), free)).toBe(true);
    expect(isCoveredBy(range("10:30", "11:30"), free)).toBe(false);
  });

  it("ignores unparseable slot strings", () => {
    expect(freeRangesFromSlotStarts(["not-a-date"], 30)).toEqual([]);
  });
});

describe("availability merging", () => {
  it("removes local pending/approved bookings from GHL free time", () => {
    const slots = buildDaySlots({
      ...baseInput,
      freeRanges: freeRangesFromSlotStarts(slotStarts("09:00", "12:00"), 30),
      busy: [range("10:00", "11:00")],
    });
    const statusAt = (time: string) => slots.find((s) => s.start === at(time).toISOString())?.status;

    expect(statusAt("08:00")).toBe("unavailable"); // not free in GHL
    expect(statusAt("09:00")).toBe("available");
    expect(statusAt("10:00")).toBe("reserved"); // local booking
    expect(statusAt("10:30")).toBe("reserved");
    expect(statusAt("11:00")).toBe("available");
    expect(statusAt("12:00")).toBe("unavailable");
  });

  it("marks elapsed slots as past", () => {
    const slots = buildDaySlots({ ...baseInput, now: at("12:15"), freeRanges: null, busy: [] });
    expect(slots.find((s) => s.start === at("12:00").toISOString())?.status).toBe("past");
    expect(slots.find((s) => s.start === at("12:30").toISOString())?.status).toBe("available");
  });

  it("with no GHL constraint, every future slot in hours is available", () => {
    const slots = buildDaySlots({ ...baseInput, freeRanges: null, busy: [] });
    expect(slots).toHaveLength(30);
    expect(slots.every((s) => s.status === "available")).toBe(true);
  });

  it("accepts only contiguous available windows", () => {
    const slots = buildDaySlots({ ...baseInput, freeRanges: null, busy: [range("13:00", "14:00")] });
    expect(isRangeBookable(slots, range("09:00", "12:00"))).toBe(true);
    expect(isRangeBookable(slots, range("12:00", "13:30"))).toBe(false);
    expect(isRangeBookable(slots, range("09:15", "10:00"))).toBe(false); // not on the grid
    expect(isRangeBookable(slots, range("21:00", "22:30"))).toBe(false); // past closing
  });

  it("offers end times only until the next unavailable slot", () => {
    const slots = buildDaySlots({ ...baseInput, freeRanges: null, busy: [range("11:00", "12:00")] });
    const ends = endOptionsFrom(slots, at("10:00").toISOString(), 8 * 60);
    expect(ends).toEqual([at("10:30").toISOString(), at("11:00").toISOString()]);
  });

  it("groups consecutive slots into schedule segments", () => {
    const slots = buildDaySlots({
      ...baseInput,
      freeRanges: freeRangesFromSlotStarts(slotStarts("09:00", "12:00"), 30),
      busy: [range("10:00", "11:00")],
    });
    const segments = groupIntoSegments(slots).map((s) => s.status);
    expect(segments).toEqual(["unavailable", "available", "reserved", "available", "unavailable"]);
  });
});
