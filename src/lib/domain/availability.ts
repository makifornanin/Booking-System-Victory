import { zonedDateTime } from "@/lib/domain/time";

/** Half-open interval [start, end) in epoch milliseconds. */
export interface TimeRange {
  start: number;
  end: number;
}

export type SlotStatus = "available" | "reserved" | "unavailable" | "past";

export interface DaySlot {
  start: string;
  end: string;
  status: SlotStatus;
}

export interface ScheduleSegment {
  start: string;
  end: string;
  status: SlotStatus;
  slots: DaySlot[];
}

export function toRange(start: Date | string, end: Date | string): TimeRange {
  return { start: new Date(start).getTime(), end: new Date(end).getTime() };
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * GHL returns free slot *start* times. Each start is treated as covering one
 * slot interval, then contiguous starts are merged into free ranges.
 */
export function freeRangesFromSlotStarts(slotStarts: string[], slotMinutes: number): TimeRange[] {
  const slotMs = slotMinutes * 60_000;
  const ranges = slotStarts
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms))
    .map((start) => ({ start, end: start + slotMs }));
  return mergeRanges(ranges);
}

export function isCoveredBy(range: TimeRange, freeRanges: TimeRange[]): boolean {
  return mergeRanges(freeRanges).some((free) => free.start <= range.start && free.end >= range.end);
}

export function findOverlapping(range: TimeRange, others: TimeRange[]): TimeRange[] {
  return others.filter((other) => rangesOverlap(range, other));
}

interface BuildDaySlotsInput {
  dateKey: string;
  /** null means no external calendar constraint (all in-hours slots are free). */
  freeRanges: TimeRange[] | null;
  busy: TimeRange[];
  now: Date;
  slotMinutes: number;
  dayStartHour: number;
  dayEndHour: number;
}

export function buildDaySlots(input: BuildDaySlotsInput): DaySlot[] {
  const { dateKey, freeRanges, busy, now, slotMinutes, dayStartHour, dayEndHour } = input;
  const dayStart = zonedDateTime(dateKey, `${String(dayStartHour).padStart(2, "0")}:00`).getTime();
  const slotMs = slotMinutes * 60_000;
  const count = Math.floor(((dayEndHour - dayStartHour) * 60) / slotMinutes);
  const mergedFree = freeRanges ? mergeRanges(freeRanges) : null;
  const nowMs = now.getTime();

  const slots: DaySlot[] = [];
  for (let i = 0; i < count; i++) {
    const range = { start: dayStart + i * slotMs, end: dayStart + (i + 1) * slotMs };
    let status: SlotStatus;
    if (range.start < nowMs) status = "past";
    else if (busy.some((b) => rangesOverlap(range, b))) status = "reserved";
    else if (mergedFree && !mergedFree.some((f) => f.start <= range.start && f.end >= range.end)) status = "unavailable";
    else status = "available";

    slots.push({ start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString(), status });
  }
  return slots;
}

/** True only when [start, end) is exactly a run of contiguous available grid slots. */
export function isRangeBookable(slots: DaySlot[], range: TimeRange): boolean {
  if (range.end <= range.start) return false;
  const startIndex = slots.findIndex((slot) => new Date(slot.start).getTime() === range.start);
  if (startIndex === -1) return false;

  for (let i = startIndex; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.status !== "available") return false;
    const slotEnd = new Date(slot.end).getTime();
    if (slotEnd === range.end) return true;
    if (slotEnd > range.end) return false;
  }
  return false;
}

/** End-time options for a chosen start: contiguous available slots up to `maxMinutes`. */
export function endOptionsFrom(slots: DaySlot[], startIso: string, maxMinutes: number): string[] {
  const startIndex = slots.findIndex((slot) => slot.start === startIso);
  if (startIndex === -1 || slots[startIndex].status !== "available") return [];
  const startMs = new Date(startIso).getTime();
  const ends: string[] = [];
  for (let i = startIndex; i < slots.length; i++) {
    if (slots[i].status !== "available") break;
    if (new Date(slots[i].end).getTime() - startMs > maxMinutes * 60_000) break;
    ends.push(slots[i].end);
  }
  return ends;
}

/** Collapses consecutive slots with the same status for display. */
export function groupIntoSegments(slots: DaySlot[]): ScheduleSegment[] {
  const segments: ScheduleSegment[] = [];
  for (const slot of slots) {
    const last = segments[segments.length - 1];
    if (last && last.status === slot.status && last.end === slot.start) {
      last.end = slot.end;
      last.slots.push(slot);
    } else {
      segments.push({ start: slot.start, end: slot.end, status: slot.status, slots: [slot] });
    }
  }
  return segments;
}
