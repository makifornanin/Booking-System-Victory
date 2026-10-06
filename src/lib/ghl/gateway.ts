import "server-only";
import { connection } from "next/server";
import type { AccessChange } from "@/lib/data/types";
import { getCalendarMode, getGhlEnv } from "@/lib/env";
import type { CalendarInfo } from "@/lib/ghl/calendars";
import type { GhlContactRef, GhlPerson } from "@/lib/ghl/contacts";
import type { BookingFieldValues, ContactFieldValues } from "@/lib/ghl/fields";

export type { BookingFieldValues, CalendarInfo, ContactFieldValues, GhlContactRef, GhlPerson };

/** Tags that start the account-status email workflows in GHL. */
export const ACCOUNT_TAGS: Record<AccessChange, string> = {
  approved: "booking-system-user-approved",
  denied: "booking-system-user-denied",
  revoked: "booking-system-user-revoked",
  restored: "booking-system-user-restored",
};

/** Starts the internal "New Account Pending Review" workflow; removed again once the account is reviewed. */
export const PENDING_ACCOUNT_TAG = "booking-system-user-pending";

/** Internal admin alerts while a request waits for review (removed once it's approved or denied). */
export const REVIEW_ALERT_TAGS = {
  booking: "room-booking-pending-review",
  reschedule: "room-booking-reschedule-pending-review",
} as const;

/** Start the reschedule email workflows (contact booking fields hold the new/requested time first). */
export const RESCHEDULE_TAGS = {
  approved: "room-booking-reschedule-approved",
  denied: "room-booking-reschedule-denied",
} as const;

export interface AppointmentRequest {
  calendarId: string;
  contactId: string;
  assignedUserId: string;
  start: Date;
  end: Date;
  title: string;
  description: string;
}

/** Everything the services need from GHL (confirmed schedule, contacts, email workflows). */
export interface CalendarGateway {
  readonly mode: "ghl" | "demo";
  readonly bookingDeniedTag: string;
  getCalendarInfo(calendarId: string): Promise<CalendarInfo>;
  /** `maxAgeMs` allows a short display cache; omit it for a live re-check. */
  getFreeSlotStarts(calendarId: string, from: Date, to: Date, options?: { maxAgeMs?: number }): Promise<string[]>;
  findOrCreateContact(person: GhlPerson): Promise<GhlContactRef>;
  updateContact(contactId: string, update: { person?: GhlPerson; fields?: ContactFieldValues }): Promise<void>;
  /** Creates a confirmed appointment, which triggers the approval workflow. */
  createAppointment(request: AppointmentRequest): Promise<{ id: string }>;
  /** Moves an existing appointment to a new time, keeping its id (approved reschedule). */
  moveAppointment(appointmentId: string, request: { calendarId: string; assignedUserId: string; start: Date; end: Date; title: string }): Promise<void>;
  cancelAppointment(appointmentId: string): Promise<void>;
  deleteAppointment(appointmentId: string): Promise<void>;
  /** Adds a tag that triggers a workflow (removing it first if it may already be there). */
  addTriggerTag(contact: GhlContactRef, tag: string): Promise<void>;
  /** Removes a tag (no-op when the contact is known not to have it). */
  removeTag(contact: GhlContactRef, tag: string): Promise<void>;
}

export function createGhlGateway(): CalendarGateway {
  const calendars = () => import("@/lib/ghl/calendars");
  const contacts = () => import("@/lib/ghl/contacts");
  return {
    mode: "ghl",
    bookingDeniedTag: getGhlEnv().GHL_DENIAL_TAG,
    getCalendarInfo: async (calendarId) => (await calendars()).getCalendarInfo(calendarId),
    getFreeSlotStarts: async (calendarId, from, to, options) => (await calendars()).getFreeSlots(calendarId, from, to, options?.maxAgeMs ?? 0),
    findOrCreateContact: async (person) => (await contacts()).findOrCreateContact(person),
    updateContact: async (contactId, update) => (await contacts()).updateContact(contactId, update),
    createAppointment: async (request) => (await calendars()).createAppointment(request),
    moveAppointment: async (appointmentId, request) => (await calendars()).moveAppointment(appointmentId, request),
    cancelAppointment: async (appointmentId) => (await calendars()).cancelAppointment(appointmentId),
    deleteAppointment: async (appointmentId) => (await calendars()).deleteAppointment(appointmentId),
    addTriggerTag: async (contact, tag) => (await contacts()).addTriggerTag(contact, tag),
    removeTag: async (contact, tag) => (await contacts()).removeTag(contact, tag),
  };
}

export async function getCalendarGateway(): Promise<CalendarGateway> {
  await connection();
  if (getCalendarMode() === "demo") {
    const { createDemoCalendarGateway } = await import("@/lib/demo/calendar");
    return createDemoCalendarGateway();
  }
  return createGhlGateway();
}

/** Calendar to use for a room. Demo calendars work without configuration. */
export function resolveCalendarId(gateway: CalendarGateway, room: { slug: string; ghlCalendarId: string | null }): string | null {
  if (room.ghlCalendarId) return room.ghlCalendarId;
  return gateway.mode === "demo" ? `demo-calendar-${room.slug}` : null;
}
