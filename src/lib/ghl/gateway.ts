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
  cancelAppointment(appointmentId: string): Promise<void>;
  deleteAppointment(appointmentId: string): Promise<void>;
  /** Adds a tag that triggers a workflow (removing it first if it may already be there). */
  addTriggerTag(contact: GhlContactRef, tag: string): Promise<void>;
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
    cancelAppointment: async (appointmentId) => (await calendars()).cancelAppointment(appointmentId),
    deleteAppointment: async (appointmentId) => (await calendars()).deleteAppointment(appointmentId),
    addTriggerTag: async (contact, tag) => (await contacts()).addTriggerTag(contact, tag),
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
