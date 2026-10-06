export const APP_NAME = "Victory Booking System";
/** All booking dates/times are interpreted in the church's local time zone. */
export const TIME_ZONE = "Asia/Manila";

/** Grid size for the schedule. GHL room calendars should use the same slot interval. */
export const SLOT_MINUTES = 30;

/** Bookable window shown on the schedule (local time). GHL availability narrows this further. */
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 22;

export const MAX_BOOKING_MINUTES = 8 * 60;
export const MAX_DAYS_AHEAD = 90;

/** Open (future, pending) requests a member may have at once. Mirrored in the insert trigger. */
export const MAX_PENDING_PER_USER = 10;

/** A stalled approval (e.g. server crash mid-request) releases its claim after this long. */
export const REVIEW_LOCK_TTL_MS = 2 * 60 * 1000;

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const EVENT_TYPES = [
  { value: "sunday_school", label: "Sunday school" },
  { value: "youth", label: "Youth / teen activity" },
  { value: "ministry_meeting", label: "Ministry meeting" },
  { value: "workshop", label: "Workshop" },
  { value: "small_group", label: "Small group" },
  { value: "church_activity", label: "Church activity" },
  { value: "internal_event", label: "Internal event" },
  { value: "other", label: "Other" },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]["value"];

export function eventTypeLabel(value: string): string {
  return EVENT_TYPES.find((type) => type.value === value)?.label ?? value;
}
