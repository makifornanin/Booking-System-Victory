import "server-only";
import { z } from "zod";
import { SLOT_MINUTES, TIME_ZONE } from "@/lib/config";
import { formatInZone } from "@/lib/domain/time";
import { getGhlEnv } from "@/lib/env";
import { GHL_API_VERSION, ghlRequest } from "@/lib/ghl/client";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Response is keyed by date ("2026-10-07": { slots: [...] }) plus metadata like traceId. */
const freeSlotsResponseSchema = z.record(z.string(), z.unknown());
const daySlotsSchema = z.object({ slots: z.array(z.string()) });

export function parseFreeSlots(payload: Record<string, unknown>): string[] {
  const slots: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!DATE_KEY.test(key)) continue;
    const day = daySlotsSchema.safeParse(value);
    if (day.success) slots.push(...day.data.slots);
  }
  return slots;
}

// --- Free slots -------------------------------------------------------------

const FREE_SLOTS_DISPLAY_TTL_MS = 30_000;
const globalForSlots = globalThis as typeof globalThis & { __victoryFreeSlots?: Map<string, { at: number; slots: string[] }> };

/**
 * Free slot start times (ISO strings) for a calendar between two instants.
 * `maxAgeMs` > 0 allows a very short cache for browsing the schedule; booking
 * submission and approval always pass 0 so they re-check live.
 */
export async function getFreeSlots(calendarId: string, start: Date, end: Date, maxAgeMs = 0): Promise<string[]> {
  const cache = (globalForSlots.__victoryFreeSlots ??= new Map());
  const key = `${calendarId}:${start.getTime()}:${end.getTime()}`;
  const cached = cache.get(key);
  if (maxAgeMs > 0 && cached && Date.now() - cached.at < Math.min(maxAgeMs, FREE_SLOTS_DISPLAY_TTL_MS)) return cached.slots;

  const payload = await ghlRequest(`/calendars/${encodeURIComponent(calendarId)}/free-slots`, {
    version: GHL_API_VERSION.calendars,
    query: { startDate: start.getTime(), endDate: end.getTime(), timezone: TIME_ZONE },
    schema: freeSlotsResponseSchema,
  });
  const slots = parseFreeSlots(payload);
  cache.set(key, { at: Date.now(), slots });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return slots;
}

// --- Calendar metadata (team member, slot sizes) ---------------------------

const teamMemberSchema = z
  .object({
    userId: z.string().nullish(),
    isPrimary: z.boolean().nullish(),
    selected: z.boolean().nullish(),
    priority: z.number().nullish(),
  })
  .loose();

const calendarSchema = z.object({
  calendar: z
    .object({
      id: z.string(),
      name: z.string().nullish(),
      calendarType: z.string().nullish(),
      isActive: z.boolean().nullish(),
      slotInterval: z.number().nullish(),
      slotIntervalUnit: z.string().nullish(),
      slotDuration: z.number().nullish(),
      slotDurationUnit: z.string().nullish(),
      teamMembers: z.array(teamMemberSchema).nullish(),
    })
    .loose(),
});

export interface CalendarInfo {
  id: string;
  name: string;
  isActive: boolean;
  slotIntervalMinutes: number;
  slotDurationMinutes: number;
  /** The staff member GHL requires on appointments in this (service) calendar. */
  assignedUserId: string | null;
}

type TeamMember = z.infer<typeof teamMemberSchema>;

/**
 * Picks the calendar's assigned staff member: the primary selected member first,
 * then any selected member by priority, then any member with a user id.
 */
export function resolveAssignedUserId(teamMembers: TeamMember[] | null | undefined): string | null {
  const withUser = (teamMembers ?? []).filter((m): m is TeamMember & { userId: string } => Boolean(m.userId));
  const selected = withUser.filter((m) => m.selected !== false);
  const primary = selected.find((m) => m.isPrimary);
  if (primary) return primary.userId;
  const byPriority = [...selected].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return byPriority[0]?.userId ?? withUser[0]?.userId ?? null;
}

function toMinutes(value: number | null | undefined, unit: string | null | undefined): number {
  if (!value || value <= 0) return SLOT_MINUTES;
  return unit === "hours" ? value * 60 : value;
}

const CALENDAR_INFO_TTL_MS = 10 * 60_000;
const globalForCalendars = globalThis as typeof globalThis & { __victoryCalendarInfo?: Map<string, { at: number; info: CalendarInfo }> };

/** Calendar settings, cached per calendar for 10 minutes. */
export async function getCalendarInfo(calendarId: string): Promise<CalendarInfo> {
  const cache = (globalForCalendars.__victoryCalendarInfo ??= new Map());
  const cached = cache.get(calendarId);
  if (cached && Date.now() - cached.at < CALENDAR_INFO_TTL_MS) return cached.info;

  const { calendar } = await ghlRequest(`/calendars/${encodeURIComponent(calendarId)}`, {
    version: GHL_API_VERSION.calendars,
    schema: calendarSchema,
  });
  const info: CalendarInfo = {
    id: calendar.id,
    name: calendar.name ?? calendarId,
    isActive: calendar.isActive !== false,
    slotIntervalMinutes: toMinutes(calendar.slotInterval, calendar.slotIntervalUnit),
    slotDurationMinutes: toMinutes(calendar.slotDuration, calendar.slotDurationUnit),
    assignedUserId: resolveAssignedUserId(calendar.teamMembers),
  };
  cache.set(calendarId, { at: Date.now(), info });
  return info;
}

// --- Appointments -----------------------------------------------------------

const appointmentResponseSchema = z.object({ id: z.string().min(1) }).loose();

function toGhlDateTime(date: Date): string {
  return formatInZone(date, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export interface CreateAppointmentInput {
  calendarId: string;
  contactId: string;
  assignedUserId: string;
  start: Date;
  end: Date;
  title: string;
  description?: string;
}

export function buildAppointmentBody(input: CreateAppointmentInput, locationId: string) {
  return {
    calendarId: input.calendarId,
    locationId,
    contactId: input.contactId,
    // Service calendars reject appointments without the assigned team member.
    assignedUserId: input.assignedUserId,
    startTime: toGhlDateTime(input.start),
    endTime: toGhlDateTime(input.end),
    title: input.title,
    description: input.description,
    // A confirmed appointment created by the API starts the "Room Booking - Approved" workflow.
    appointmentStatus: "confirmed",
    toNotify: true,
    // Availability is re-verified against free slots right before this call; this flag
    // lets a booking span several consecutive slots instead of one slot duration.
    ignoreFreeSlotValidation: true,
  };
}

export async function createAppointment(input: CreateAppointmentInput): Promise<{ id: string }> {
  const { GHL_LOCATION_ID } = getGhlEnv();
  const result = await ghlRequest("/calendars/events/appointments", {
    method: "POST",
    version: GHL_API_VERSION.calendars,
    body: buildAppointmentBody(input, GHL_LOCATION_ID),
    schema: appointmentResponseSchema,
    timeoutMs: 20_000,
  });
  return { id: result.id };
}

/** Marks an appointment cancelled (keeps GHL history; frees the slot). */
export async function cancelAppointment(appointmentId: string): Promise<void> {
  await ghlRequest(`/calendars/events/appointments/${encodeURIComponent(appointmentId)}`, {
    method: "PUT",
    version: GHL_API_VERSION.calendars,
    body: { appointmentStatus: "cancelled" },
    schema: z.unknown(),
  });
}

export async function deleteAppointment(eventId: string): Promise<void> {
  await ghlRequest(`/calendars/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    version: GHL_API_VERSION.calendars,
    body: {},
    schema: z.unknown(),
  });
}
