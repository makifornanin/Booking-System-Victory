import { DAY_END_HOUR, DAY_START_HOUR, MAX_BOOKING_MINUTES, MAX_DAYS_AHEAD, SLOT_MINUTES } from "@/lib/config";
import { validateBookingWindow } from "@/lib/domain/booking-rules";
import { normalizePhone } from "@/lib/domain/phone";
import { addDaysToKey, dateKeyInZone, isValidDateKey, zonedDateTime } from "@/lib/domain/time";
import { botError, type BotFailure } from "@/lib/bot/errors";

/**
 * The WhatsApp sender number as n8n receives it ("639171234567", "+63 917 …",
 * "09171234567") normalized to E.164. Digits-only international numbers from
 * WhatsApp metadata (country code without "+") are accepted too.
 */
export function normalizeSenderPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const local = normalizePhone(input);
  if (local) return local;
  const digits = input.trim().replace(/[\s()-]/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** An explicit Asia/Manila calendar date, today or within the booking window. */
export function parseBotDate(value: unknown, now: Date): { ok: true; dateKey: string } | BotFailure {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return botError("AMBIGUOUS_DATE", "Send an explicit date as YYYY-MM-DD in Asia/Manila time (resolve words like 'Monday' or 'tomorrow' first).", {
      requiresClarification: true,
    });
  }
  const dateKey = value.trim();
  if (!isValidDateKey(dateKey)) return botError("INVALID_DATE", `${dateKey} is not a real calendar date.`, { requiresClarification: true });

  const today = dateKeyInZone(now);
  if (dateKey < today) return botError("INVALID_DATE", `${dateKey} is in the past. Today in Manila is ${today}.`, { requiresClarification: true, today });
  const last = addDaysToKey(today, MAX_DAYS_AHEAD);
  if (dateKey > last) return botError("BOOKING_TOO_FAR_AHEAD", `Bookings open up to ${MAX_DAYS_AHEAD} days ahead (until ${last}).`, { lastBookableDate: last });
  return { ok: true, dateKey };
}

/** "HH:mm" (24-hour). Also accepts "H:mm" and "HH:mm:ss". */
export function parseBotTime(value: unknown, field: string): { ok: true; time: string } | BotFailure {
  const match = typeof value === "string" ? /^(\d{1,2}):(\d{2})(?::00)?$/.exec(value.trim()) : null;
  if (!match) {
    return botError("INVALID_TIME", `${field} must be a 24-hour time like "13:00".`, { requiresClarification: true, field });
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return botError("INVALID_TIME", `${field} is not a valid time.`, { requiresClarification: true, field });
  if (minutes % SLOT_MINUTES !== 0) {
    return botError("INVALID_TIME", `Bookings use ${SLOT_MINUTES}-minute steps, so ${field} must end in :00 or :30.`, { requiresClarification: true, field });
  }
  return { ok: true, time: `${String(hours).padStart(2, "0")}:${match[2]}` };
}

export interface BotWindow {
  dateKey: string;
  startTime: string;
  endTime: string;
  start: Date;
  end: Date;
  durationMinutes: number;
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * Validates an explicit date + start/end time with the same rules as the web
 * form, returning a specific code for each problem. The booking service and the
 * database re-check everything again when a booking is created.
 */
export function parseBotWindow(input: { date: unknown; startTime: unknown; endTime: unknown }, now: Date): ({ ok: true } & BotWindow) | BotFailure {
  const date = parseBotDate(input.date, now);
  if (!date.ok) return date;
  const startTime = parseBotTime(input.startTime, "startTime");
  if (!startTime.ok) return startTime;
  const endTime = parseBotTime(input.endTime, "endTime");
  if (!endTime.ok) return endTime;

  const startMinutes = toMinutes(startTime.time);
  const endMinutes = toMinutes(endTime.time);
  const hours = { opens: `${String(DAY_START_HOUR).padStart(2, "0")}:00`, closes: `${String(DAY_END_HOUR).padStart(2, "0")}:00` };
  if (startMinutes < DAY_START_HOUR * 60 || endMinutes > DAY_END_HOUR * 60 || startMinutes >= DAY_END_HOUR * 60) {
    return botError("OUTSIDE_BOOKING_HOURS", `Rooms can be booked between ${hours.opens} and ${hours.closes} (Asia/Manila).`, { bookableHours: hours });
  }
  if (endMinutes <= startMinutes) return botError("INVALID_DURATION", "The end time must be after the start time.", { requiresClarification: true });
  const durationMinutes = endMinutes - startMinutes;
  if (durationMinutes > MAX_BOOKING_MINUTES) {
    return botError("INVALID_DURATION", `A booking can be at most ${MAX_BOOKING_MINUTES / 60} hours long.`, { maxDurationMinutes: MAX_BOOKING_MINUTES });
  }

  const start = zonedDateTime(date.dateKey, startTime.time);
  const end = zonedDateTime(date.dateKey, endTime.time);
  if (start.getTime() <= now.getTime()) return botError("INVALID_TIME", "That start time has already passed today.", { requiresClarification: true });

  // Same rules the booking service applies; anything left here is unexpected.
  const problem = validateBookingWindow({ start, end, now });
  if (problem) return botError("INVALID_TIME", problem, { requiresClarification: true });

  return { ok: true, dateKey: date.dateKey, startTime: startTime.time, endTime: endTime.time, start, end, durationMinutes };
}
