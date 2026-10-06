import "server-only";
import { bookingEventId } from "@/lib/google/api";
import type { GoogleCalendarGateway } from "@/lib/google/gateway";
import { getDemoState } from "@/lib/demo/store";

/** Event names containing this marker make the simulated Google Calendar fail. */
export const DEMO_GOOGLE_FAILURE_MARKER = "[google-fail]";

/** Simulated per-member Google Calendar for development and E2E tests. */
export function createDemoGoogleGateway(): GoogleCalendarGateway {
  const state = getDemoState();
  return {
    mode: "demo",
    required: true,
    isConnected: async (userId) => state.googleConnections.has(userId),
    saveConnection: async (userId) => {
      state.googleConnections.add(userId);
    },
    disconnect: async (userId) => {
      state.googleConnections.delete(userId);
    },
    async createBookingEvent(userId, event) {
      if (!state.googleConnections.has(userId)) throw new Error("Google Calendar isn't connected.");
      if (event.summary.toLowerCase().includes(DEMO_GOOGLE_FAILURE_MARKER)) throw new Error("Simulated Google Calendar outage (demo).");
      const id = bookingEventId(event.bookingId);
      if (!state.googleEvents.has(id)) {
        state.googleEvents.set(id, { userId, summary: event.summary, start: event.start.toISOString(), end: event.end.toISOString() });
      }
      return id;
    },
    async updateBookingEvent(userId, eventId, event) {
      if (!state.googleConnections.has(userId)) throw new Error("Google Calendar isn't connected.");
      if (event.summary.toLowerCase().includes(DEMO_GOOGLE_FAILURE_MARKER)) throw new Error("Simulated Google Calendar outage (demo).");
      state.googleEvents.set(eventId, { userId, summary: event.summary, start: event.start.toISOString(), end: event.end.toISOString() });
      return eventId;
    },
    async deleteBookingEvent(_userId, eventId) {
      state.googleEvents.delete(eventId);
    },
  };
}
