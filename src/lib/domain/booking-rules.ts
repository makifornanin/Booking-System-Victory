import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  MAX_BOOKING_MINUTES,
  MAX_DAYS_AHEAD,
  SLOT_MINUTES,
} from "@/lib/config";
import { addDaysToKey, dateKeyInZone, minutesSinceLocalMidnight } from "@/lib/domain/time";

export type BookingStatus = "pending" | "approved" | "denied" | "cancelled";

/** Statuses that hold a room/time. Mirrors the database exclusion constraint. */
export const BLOCKING_STATUSES: readonly BookingStatus[] = ["pending", "approved"];

export function isBlockingStatus(status: BookingStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

/** Members may cancel their own future pending or approved bookings. */
export function canMemberCancel(booking: { status: BookingStatus; startTime: string }, now: Date): boolean {
  return (booking.status === "pending" || booking.status === "approved") && new Date(booking.startTime).getTime() > now.getTime();
}

/** Members may ask to move their own future approved bookings (a request, reviewed by an admin). */
export function canRequestReschedule(booking: { status: BookingStatus; startTime: string }, now: Date): boolean {
  return booking.status === "approved" && new Date(booking.startTime).getTime() > now.getTime();
}

interface WindowInput {
  start: Date;
  end: Date;
  now: Date;
}

/** Returns a user-facing problem with the requested window, or null when it is acceptable. */
export function validateBookingWindow({ start, end, now }: WindowInput): string | null {
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "Choose a valid date and time.";
  if (endMs <= startMs) return "End time must be after the start time.";
  if (startMs <= now.getTime()) return "That time has already passed. Choose a future time.";

  const durationMinutes = (endMs - startMs) / 60_000;
  if (durationMinutes % SLOT_MINUTES !== 0) return `Bookings use ${SLOT_MINUTES}-minute steps.`;
  if (durationMinutes > MAX_BOOKING_MINUTES) {
    return `Bookings can be at most ${MAX_BOOKING_MINUTES / 60} hours long.`;
  }

  const dateKey = dateKeyInZone(start);
  const endMinutes = minutesSinceLocalMidnight(end);
  const endsSameDay = dateKeyInZone(end) === dateKey || (endMinutes === 0 && endMs - startMs <= 24 * 60 * 60_000);
  if (!endsSameDay) return "A booking must start and end on the same day.";

  const startMinutes = minutesSinceLocalMidnight(start);
  if (startMinutes % SLOT_MINUTES !== 0) return `Start times must be on a ${SLOT_MINUTES}-minute mark.`;
  const effectiveEnd = endMinutes === 0 ? 24 * 60 : endMinutes;
  if (startMinutes < DAY_START_HOUR * 60 || effectiveEnd > DAY_END_HOUR * 60) {
    return "That time is outside bookable hours.";
  }

  const lastBookableDay = addDaysToKey(dateKeyInZone(now), MAX_DAYS_AHEAD);
  if (dateKey > lastBookableDay) return `Bookings open up to ${MAX_DAYS_AHEAD} days ahead.`;

  return null;
}
