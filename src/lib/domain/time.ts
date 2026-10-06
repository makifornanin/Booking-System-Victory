import { TZDate, tz } from "@date-fns/tz";
import { addDays, format, isValid, parse } from "date-fns";
import { TIME_ZONE } from "@/lib/config";

const zone = tz(TIME_ZONE);

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
}

export function isValidTimeKey(value: string): boolean {
  return TIME_KEY.test(value);
}

/** Absolute instant for a local (church time zone) date + "HH:mm". */
export function zonedDateTime(dateKey: string, timeKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hours, minutes] = timeKey.split(":").map(Number);
  return new Date(new TZDate(year, month - 1, day, hours, minutes, 0, 0, TIME_ZONE).getTime());
}

export function zonedDayRange(dateKey: string): { start: Date; end: Date } {
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = new TZDate(year, month - 1, day, 0, 0, 0, 0, TIME_ZONE);
  return { start: new Date(start.getTime()), end: new Date(addDays(start, 1).getTime()) };
}

export function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function dateKeyInZone(value: Date | string | number = new Date()): string {
  return format(toDate(value), "yyyy-MM-dd", { in: zone });
}

export function timeKeyInZone(value: Date | string | number): string {
  return format(toDate(value), "HH:mm", { in: zone });
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return format(addDays(new Date(year, month - 1, day), days), "yyyy-MM-dd");
}

export function formatInZone(value: Date | string | number, pattern: string): string {
  return format(toDate(value), pattern, { in: zone });
}

export function formatTime(value: Date | string | number): string {
  return formatInZone(value, "h:mm a");
}

export function formatDate(value: Date | string | number, pattern = "EEE, MMM d, yyyy"): string {
  return formatInZone(value, pattern);
}

export function formatTimeRange(start: Date | string | number, end: Date | string | number): string {
  const startMeridiem = formatInZone(start, "a");
  const endMeridiem = formatInZone(end, "a");
  const startLabel = startMeridiem === endMeridiem ? formatInZone(start, "h:mm") : formatTime(start);
  return `${startLabel} – ${formatTime(end)}`;
}

/** Formats a date key ("2026-10-07") without shifting it through UTC. */
export function formatDateKey(dateKey: string, pattern = "EEEE, MMMM d"): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return format(new Date(year, month - 1, day), pattern);
}

/** Parses a `<input type="datetime-local">` value as church-local time. */
export function parseLocalDateTimeInput(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match || !isValidDateKey(match[1]) || !isValidTimeKey(match[2])) return null;
  return zonedDateTime(match[1], match[2]);
}

export function toLocalDateTimeInput(value: Date | string | number): string {
  return formatInZone(value, "yyyy-MM-dd'T'HH:mm");
}

export function minutesSinceLocalMidnight(value: Date | string | number): number {
  const [hours, minutes] = timeKeyInZone(value).split(":").map(Number);
  return hours * 60 + minutes;
}
