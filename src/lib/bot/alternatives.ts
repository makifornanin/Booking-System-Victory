import { isRangeBookable, type DaySlot } from "@/lib/domain/availability";

export interface AlternativeWindow {
  start: number;
  end: number;
  /** False when no window of the requested length exists and a shorter one is offered instead. */
  preservesDuration: boolean;
}

const MAX_ALTERNATIVES = 3;

/**
 * Deterministic alternatives for one room and day, computed from the same slot
 * statuses the booking engine uses (GHL availability, local pending/approved
 * bookings, opening hours, past times). Order: the nearest later start, the
 * nearest earlier start, then another same-day option that doesn't overlap the
 * first two. When nothing of the requested length fits, the longest free windows
 * (capped at the requested length) closest to the requested time are offered.
 */
export function findAlternativeWindows(slots: DaySlot[], requestedStart: number, durationMinutes: number): AlternativeWindow[] {
  const durationMs = durationMinutes * 60_000;
  const candidates = slots
    .map((slot) => new Date(slot.start).getTime())
    .filter((start) => start !== requestedStart && isRangeBookable(slots, { start, end: start + durationMs }))
    .map((start) => ({ start, end: start + durationMs, preservesDuration: true }));

  if (candidates.length > 0) {
    const later = candidates.filter((c) => c.start > requestedStart);
    const earlier = candidates.filter((c) => c.start < requestedStart).reverse();
    const picked: AlternativeWindow[] = [];
    const overlapsPicked = (c: AlternativeWindow) => picked.some((p) => c.start < p.end && p.start < c.end);
    if (later[0]) picked.push(later[0]);
    if (earlier[0]) picked.push(earlier[0]);
    const byDistance = [...candidates].sort((a, b) => Math.abs(a.start - requestedStart) - Math.abs(b.start - requestedStart) || a.start - b.start);
    for (const candidate of byDistance) {
      if (picked.length >= MAX_ALTERNATIVES) break;
      if (!picked.includes(candidate) && !overlapsPicked(candidate)) picked.push(candidate);
    }
    for (const candidate of byDistance) {
      if (picked.length >= MAX_ALTERNATIVES) break;
      if (!picked.includes(candidate)) picked.push(candidate);
    }
    return picked;
  }

  // No window of the full length: offer the longest free runs, nearest first.
  const runs: AlternativeWindow[] = [];
  let runStart: number | null = null;
  let runEnd = 0;
  for (const slot of slots) {
    const start = new Date(slot.start).getTime();
    const end = new Date(slot.end).getTime();
    if (slot.status === "available" && runStart !== null && start === runEnd) runEnd = end;
    else if (slot.status === "available") {
      if (runStart !== null) runs.push({ start: runStart, end: runEnd, preservesDuration: false });
      runStart = start;
      runEnd = end;
    } else if (runStart !== null) {
      runs.push({ start: runStart, end: runEnd, preservesDuration: false });
      runStart = null;
    }
  }
  if (runStart !== null) runs.push({ start: runStart, end: runEnd, preservesDuration: false });

  return runs
    .map((run) => ({ ...run, end: Math.min(run.end, run.start + durationMs) }))
    .sort((a, b) => b.end - b.start - (a.end - a.start) || Math.abs(a.start - requestedStart) - Math.abs(b.start - requestedStart))
    .slice(0, MAX_ALTERNATIVES);
}
