import "server-only";
import type { TimeRange } from "@/lib/domain/availability";
import type { AccessChange, AccessStatus, Announcement, Booking, Role, Room } from "@/lib/data/types";
import { isProduction } from "@/lib/env";
import { createDemoSeed } from "@/lib/demo/seed";

export interface DemoUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  accessStatus: AccessStatus;
  accessReason: string | null;
  accessReviewedAt: string | null;
  accessNotificationError: string | null;
  ghlContactId: string | null;
  passwordHash: string;
  createdAt: string;
}

export interface DemoAccessEvent {
  id: string;
  userId: string;
  change: AccessChange;
  reason: string | null;
  actorId: string | null;
  notificationError: string | null;
  notifiedAt: string | null;
  createdAt: string;
}

export interface DemoState {
  users: DemoUser[];
  accessEvents: DemoAccessEvent[];
  rooms: Room[];
  bookings: Booking[];
  announcements: Announcement[];
  files: Map<string, { bytes: Uint8Array; contentType: string }>;
  /** Simulated GHL appointments, keyed by appointment id. */
  appointments: Map<string, { calendarId: string; range: TimeRange; title: string; assignedUserId: string; status: string }>;
  /** Simulated GHL contacts, keyed by lower-cased email. */
  ghlContacts: Map<string, { id: string; fullName: string; phone: string | null; tags: string[]; fields: Record<string, string> }>;
  /** Simulated Google Calendar connections and events. */
  googleConnections: Set<string>;
  googleEvents: Map<string, { userId: string; summary: string; start: string; end: string }>;
  sessionSecret: Buffer;
}

const globalForDemo = globalThis as typeof globalThis & { __victoryDemoState?: DemoState };

/**
 * In-memory state for local development without credentials. Kept on
 * globalThis so it survives hot reloads and is shared across route bundles.
 */
export function getDemoState(): DemoState {
  if (isProduction()) {
    throw new Error("Demo data is not available in production.");
  }
  globalForDemo.__victoryDemoState ??= createDemoSeed();
  return globalForDemo.__victoryDemoState;
}
