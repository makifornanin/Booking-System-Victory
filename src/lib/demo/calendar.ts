import "server-only";
import { randomUUID } from "node:crypto";
import { SLOT_MINUTES } from "@/lib/config";
import { rangesOverlap } from "@/lib/domain/availability";
import { addDaysToKey, dateKeyInZone, zonedDateTime } from "@/lib/domain/time";
import { GhlError } from "@/lib/ghl/errors";
import type { CalendarGateway } from "@/lib/ghl/gateway";
import { getDemoState } from "@/lib/demo/store";

/** Event names containing this marker make the simulated GHL reject the appointment. */
export const DEMO_GHL_FAILURE_MARKER = "[ghl-fail]";

const OPEN_HOUR = 8;
const CLOSE_HOUR = 21;

/** Sunday mornings are held for worship services, simulating time blocked directly in GHL. */
function isHeldForServices(dateKey: string, hour: number): boolean {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).getDay() === 0 && hour < 13;
}

/**
 * Simulated GHL for development: service calendars open 8:00–21:00 local with
 * one assigned staff member, plus in-memory contacts, custom fields and tags.
 */
export function createDemoCalendarGateway(): CalendarGateway {
  const state = getDemoState();
  const contactById = (id: string) => [...state.ghlContacts.values()].find((c) => c.id === id);

  return {
    mode: "demo",
    bookingDeniedTag: "room-booking-denied",

    async getCalendarInfo(calendarId) {
      return { id: calendarId, name: calendarId, isActive: true, slotIntervalMinutes: SLOT_MINUTES, slotDurationMinutes: SLOT_MINUTES, assignedUserId: "demo-staff" };
    },

    async getFreeSlotStarts(calendarId, from, to) {
      const slots: string[] = [];
      const appointments = [...state.appointments.values()].filter((a) => a.calendarId === calendarId && a.status !== "cancelled");
      for (let dateKey = dateKeyInZone(from); zonedDateTime(dateKey, "00:00") < to; dateKey = addDaysToKey(dateKey, 1)) {
        for (let minutes = OPEN_HOUR * 60; minutes < CLOSE_HOUR * 60; minutes += SLOT_MINUTES) {
          const hour = Math.floor(minutes / 60);
          if (isHeldForServices(dateKey, hour)) continue;
          const start = zonedDateTime(dateKey, `${String(hour).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
          const range = { start: start.getTime(), end: start.getTime() + SLOT_MINUTES * 60_000 };
          if (range.start < from.getTime() || range.start >= to.getTime()) continue;
          if (appointments.some((a) => rangesOverlap(a.range, range))) continue;
          slots.push(start.toISOString());
        }
      }
      return slots;
    },

    async findOrCreateContact({ email, fullName, phone }) {
      const key = email.toLowerCase();
      let contact = state.ghlContacts.get(key);
      if (!contact) {
        contact = { id: `demo-contact-${randomUUID()}`, fullName, phone: phone ?? null, tags: [], fields: {} };
        state.ghlContacts.set(key, contact);
      }
      return { id: contact.id, tags: [...contact.tags] };
    },

    async updateContact(contactId, update) {
      const contact = contactById(contactId);
      if (!contact) throw new GhlError("not_found", "Contact not found (demo).");
      if (update.person) Object.assign(contact, { fullName: update.person.fullName, phone: update.person.phone ?? contact.phone });
      if (update.fields) Object.assign(contact.fields, update.fields);
    },

    async createAppointment(request) {
      if (request.title.toLowerCase().includes(DEMO_GHL_FAILURE_MARKER)) {
        throw new GhlError("unavailable", "Simulated GHL outage (demo).");
      }
      const id = `demo-appt-${randomUUID()}`;
      state.appointments.set(id, {
        calendarId: request.calendarId,
        range: { start: request.start.getTime(), end: request.end.getTime() },
        title: request.title,
        assignedUserId: request.assignedUserId,
        status: "confirmed",
      });
      return { id };
    },

    async moveAppointment(appointmentId, request) {
      if (request.title.toLowerCase().includes(DEMO_GHL_FAILURE_MARKER)) {
        throw new GhlError("unavailable", "Simulated GHL outage (demo).");
      }
      const appointment = state.appointments.get(appointmentId);
      if (!appointment) throw new GhlError("not_found", "Appointment not found (demo).");
      appointment.range = { start: request.start.getTime(), end: request.end.getTime() };
      appointment.calendarId = request.calendarId;
      appointment.assignedUserId = request.assignedUserId;
      appointment.status = "confirmed";
    },

    async cancelAppointment(appointmentId) {
      const appointment = state.appointments.get(appointmentId);
      if (appointment) appointment.status = "cancelled";
    },

    async deleteAppointment(appointmentId) {
      state.appointments.delete(appointmentId);
    },

    async addTriggerTag(ref, tag) {
      const contact = contactById(ref.id);
      if (!contact) throw new GhlError("not_found", "Contact not found (demo).");
      contact.tags = [...contact.tags.filter((existing) => existing !== tag), tag];
    },

    async removeTag(ref, tag) {
      const contact = contactById(ref.id);
      if (contact) contact.tags = contact.tags.filter((existing) => existing !== tag);
    },
  };
}
