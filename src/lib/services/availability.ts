import { DAY_END_HOUR, DAY_START_HOUR, MAX_DAYS_AHEAD, SLOT_MINUTES } from "@/lib/config";
import type { Repository } from "@/lib/data/repository";
import type { Room } from "@/lib/data/types";
import {
  buildDaySlots,
  freeRangesFromSlotStarts,
  isCoveredBy,
  type DaySlot,
  type TimeRange,
} from "@/lib/domain/availability";
import { addDaysToKey, dateKeyInZone, zonedDayRange } from "@/lib/domain/time";
import type { CalendarGateway } from "@/lib/ghl/gateway";
import { resolveCalendarId } from "@/lib/ghl/gateway";
import { GhlError, ghlUserMessage } from "@/lib/ghl/errors";

export type AvailabilityProblem = "calendar_not_configured" | "calendar_unavailable" | "out_of_range";

export interface RoomDayAvailability {
  dateKey: string;
  slots: DaySlot[];
  problem: AvailabilityProblem | null;
  problemMessage: string | null;
}

export interface AvailabilityDeps {
  repo: Pick<Repository, "getBusyRanges">;
  calendar: CalendarGateway;
  now: () => Date;
}

export function bookableDateRange(now: Date): { first: string; last: string } {
  const first = dateKeyInZone(now);
  return { first, last: addDaysToKey(first, MAX_DAYS_AHEAD) };
}

/**
 * Final availability for one room/day: GHL free slots minus local pending and
 * approved bookings and slots held by pending reschedule requests. Used for
 * display and re-run on every submission and approval.
 */
export async function getRoomDayAvailability(
  room: Pick<Room, "id" | "slug" | "ghlCalendarId">,
  dateKey: string,
  deps: AvailabilityDeps,
  options: { forDisplay?: boolean; excludeRescheduleId?: string } = {},
): Promise<RoomDayAvailability> {
  const now = deps.now();
  const { first, last } = bookableDateRange(now);
  const build = (freeRanges: TimeRange[] | null, busy: TimeRange[]) =>
    buildDaySlots({
      dateKey,
      freeRanges,
      busy,
      now,
      slotMinutes: SLOT_MINUTES,
      dayStartHour: DAY_START_HOUR,
      dayEndHour: DAY_END_HOUR,
    });

  if (dateKey < first || dateKey > last) {
    return {
      dateKey,
      slots: build([], []),
      problem: "out_of_range",
      problemMessage: `Bookings open from today up to ${MAX_DAYS_AHEAD} days ahead.`,
    };
  }

  const { start, end } = zonedDayRange(dateKey);
  const calendarId = resolveCalendarId(deps.calendar, room);

  // Local bookings, GHL free slots and the calendar's slot size are fetched in parallel.
  const [busy, free] = await Promise.all([
    deps.repo.getBusyRanges(room.id, start, end, options.excludeRescheduleId ? { excludeRescheduleId: options.excludeRescheduleId } : undefined),
    calendarId
      ? Promise.all([
          deps.calendar.getFreeSlotStarts(calendarId, start, end, options.forDisplay ? { maxAgeMs: 30_000 } : undefined),
          deps.calendar.getCalendarInfo(calendarId),
        ]).then(
          ([slots, info]) => ({ ok: true as const, slots, slotMinutes: info.slotDurationMinutes }),
          (error: unknown) => ({ ok: false as const, error }),
        )
      : Promise.resolve(null),
  ]);

  if (!free) {
    return {
      dateKey,
      slots: build([], busy),
      problem: "calendar_not_configured",
      problemMessage: "This room isn't connected to the church calendar yet, so it can't be booked online.",
    };
  }

  if (!free.ok) {
    return {
      dateKey,
      slots: build([], busy),
      problem: "calendar_unavailable",
      problemMessage:
        free.error instanceof GhlError && free.error.kind === "not_found"
          ? ghlUserMessage(free.error)
          : "We couldn't load this room's calendar right now. Please try again in a few minutes.",
    };
  }

  return {
    dateKey,
    // Each free start covers one appointment of the calendar's slot duration.
    slots: build(freeRangesFromSlotStarts(free.slots, free.slotMinutes), busy),
    problem: null,
    problemMessage: null,
  };
}

/** Re-checks a window directly against GHL free slots (used right before approval). */
export async function isWindowFreeInCalendar(
  calendar: CalendarGateway,
  calendarId: string,
  dateKey: string,
  window: TimeRange,
): Promise<boolean> {
  const { start, end } = zonedDayRange(dateKey);
  const [slots, info] = await Promise.all([calendar.getFreeSlotStarts(calendarId, start, end), calendar.getCalendarInfo(calendarId)]);
  return isCoveredBy(window, freeRangesFromSlotStarts(slots, info.slotDurationMinutes));
}
