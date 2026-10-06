import type { SessionUser } from "@/lib/auth/provider";
import { zonedDateTime } from "@/lib/domain/time";
import { GhlError } from "@/lib/ghl/errors";
import type { AppointmentRequest, CalendarGateway, ContactFieldValues, GhlContactRef, GhlPerson } from "@/lib/ghl/gateway";
import type { CalendarEventInput, GoogleCalendarGateway } from "@/lib/google/gateway";

export const ROOM_A = "5b0d7e10-3c2a-4f1e-8b6d-100000000001";

export const member: SessionUser = {
  id: "8f3c1a52-1b7e-4c1a-9a51-0a0000000002",
  email: "member@victory.test",
  fullName: "Jamie Cruz",
  phone: "+639170000002",
  role: "user",
  accessStatus: "active",
  accessReason: null,
};
export const otherMember: SessionUser = { ...member, id: "8f3c1a52-1b7e-4c1a-9a51-0a0000000003", email: "paolo@victory.test", fullName: "Paolo Reyes" };
export const admin: SessionUser = { ...member, id: "8f3c1a52-1b7e-4c1a-9a51-0a0000000001", email: "admin@victory.test", fullName: "Andrea Santos", role: "admin" };
export const pendingUserId = "8f3c1a52-1b7e-4c1a-9a51-0a0000000004";

export interface FakeGhlOptions {
  day?: string;
  failCreate?: boolean | GhlError;
  failContactUpdate?: boolean;
  failTag?: boolean;
  blocked?: { from: string; to: string }[];
  assignedUserId?: string | null;
  slotDurationMinutes?: number;
}

/** In-memory GHL that records every call so tests can assert on what was sent. */
export function fakeGhl(options: FakeGhlOptions = {}) {
  const log = {
    appointments: [] as (AppointmentRequest & { id: string })[],
    cancelled: [] as string[],
    deleted: [] as string[],
    contacts: new Map<string, GhlContactRef & { person: GhlPerson }>(),
    searches: 0,
    updates: [] as { contactId: string; person?: GhlPerson; fields?: ContactFieldValues }[],
    tags: [] as { contactId: string; tag: string }[],
  };
  const gateway: CalendarGateway = {
    mode: "ghl",
    bookingDeniedTag: "room-booking-denied",
    async getCalendarInfo(calendarId) {
      return {
        id: calendarId,
        name: calendarId,
        isActive: true,
        slotIntervalMinutes: 30,
        slotDurationMinutes: options.slotDurationMinutes ?? 30,
        assignedUserId: options.assignedUserId === undefined ? "staff-user-1" : options.assignedUserId,
      };
    },
    async getFreeSlotStarts(_calendarId, from, to) {
      const day = options.day;
      const blocked = (options.blocked ?? []).map((b) => ({ start: zonedDateTime(day!, b.from).getTime(), end: zonedDateTime(day!, b.to).getTime() }));
      const starts: string[] = [];
      for (let t = from.getTime(); t < to.getTime(); t += 30 * 60_000) {
        if (!blocked.some((b) => t >= b.start && t < b.end)) starts.push(new Date(t).toISOString());
      }
      return starts;
    },
    async findOrCreateContact(person) {
      log.searches++;
      const key = person.email.toLowerCase();
      if (!log.contacts.has(key)) log.contacts.set(key, { id: `contact-${log.contacts.size + 1}`, tags: [], person });
      const contact = log.contacts.get(key)!;
      return { id: contact.id, tags: contact.tags };
    },
    async updateContact(contactId, update) {
      if (options.failContactUpdate) throw new GhlError("rejected", "field not found");
      if (![...log.contacts.values()].some((c) => c.id === contactId)) throw new GhlError("not_found", "contact not found");
      log.updates.push({ contactId, ...update });
    },
    async createAppointment(request) {
      if (options.failCreate) throw options.failCreate instanceof GhlError ? options.failCreate : new GhlError("unavailable", "GHL down");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const id = `appt-${log.appointments.length + 1}`;
      log.appointments.push({ ...request, id });
      return { id };
    },
    async cancelAppointment(id) {
      log.cancelled.push(id);
    },
    async deleteAppointment(id) {
      log.deleted.push(id);
    },
    async addTriggerTag(contact, tag) {
      if (options.failTag) throw new GhlError("unavailable", "GHL down");
      log.tags.push({ contactId: contact.id, tag });
    },
  };
  return { gateway, log };
}

export function fakeGoogle(options: { connected?: string[]; fail?: boolean; required?: boolean } = {}) {
  const connected = new Set(options.connected ?? [member.id, otherMember.id]);
  const events = new Map<string, CalendarEventInput & { userId: string }>();
  const deleted: string[] = [];
  let createCalls = 0;
  const gateway: GoogleCalendarGateway = {
    mode: "google",
    required: options.required ?? true,
    isConnected: async (userId) => connected.has(userId),
    saveConnection: async (userId) => {
      connected.add(userId);
    },
    disconnect: async (userId) => {
      connected.delete(userId);
    },
    async createBookingEvent(userId, event) {
      createCalls++;
      if (options.fail) throw new Error("Google down");
      const id = `vrb${event.bookingId.replace(/-/g, "")}`;
      if (!events.has(id)) events.set(id, { ...event, userId });
      return id;
    },
    async deleteBookingEvent(_userId, eventId) {
      deleted.push(eventId);
      events.delete(eventId);
    },
  };
  return { gateway, events, deleted, connected, createCalls: () => createCalls, setFail: (fail: boolean) => (options.fail = fail) };
}
