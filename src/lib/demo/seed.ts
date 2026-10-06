import "server-only";
import { randomBytes } from "node:crypto";
import type { Announcement, Booking, Room } from "@/lib/data/types";
import { addDaysToKey, dateKeyInZone, zonedDateTime } from "@/lib/domain/time";
import { hashDemoPassword } from "@/lib/demo/passwords";
import type { DemoState, DemoUser } from "@/lib/demo/store";

export const DEMO_PASSWORD = "victory-demo";

export const DEMO_ACCOUNTS = {
  admin: { email: "admin@victory.test", fullName: "Andrea Santos" },
  member: { email: "member@victory.test", fullName: "Jamie Cruz" },
  pending: { email: "pending@victory.test", fullName: "Lia Mendoza" },
} as const;

const ids = {
  admin: "8f3c1a52-1b7e-4c1a-9a51-0a0000000001",
  member: "8f3c1a52-1b7e-4c1a-9a51-0a0000000002",
  memberTwo: "8f3c1a52-1b7e-4c1a-9a51-0a0000000003",
  pending: "8f3c1a52-1b7e-4c1a-9a51-0a0000000004",
};

function room(index: number, fields: Omit<Room, "id" | "isActive" | "displayOrder" | "imagePath" | "mapImagePath" | "ghlCalendarId">): Room {
  return {
    id: `5b0d7e10-3c2a-4f1e-8b6d-10000000000${index}`,
    imagePath: null,
    mapImagePath: null,
    ghlCalendarId: `demo-calendar-${fields.slug}`,
    isActive: true,
    displayOrder: index,
    ...fields,
  };
}

/** Mirrors db/migrations/0003_seed_rooms.sql so demo and real data look alike. */
const rooms: Room[] = [
  room(1, {
    name: "Room A",
    slug: "room-a",
    shortDescription: "Large classroom for Sunday school and workshops.",
    fullDescription:
      "Room A is the largest classroom on the floor, set up with movable tables and chairs. Replace this text with the actual room description.",
    capacity: 40,
    bestFor: ["Sunday school", "Workshops", "Training"],
    locationLabel: "2nd floor, east wing",
  }),
  room(2, {
    name: "Room B",
    slug: "room-b",
    shortDescription: "Flexible room for youth and teen activities.",
    fullDescription:
      "Room B has open floor space suited to youth and teen programs. Replace this text with the actual room description.",
    capacity: 30,
    bestFor: ["Youth activities", "Teen gatherings", "Games"],
    locationLabel: "2nd floor, east wing",
  }),
  room(3, {
    name: "Room C",
    slug: "room-c",
    shortDescription: "Meeting room for ministry teams.",
    fullDescription:
      "Room C has a central table and a display screen for ministry meetings. Replace this text with the actual room description.",
    capacity: 16,
    bestFor: ["Ministry meetings", "Planning sessions"],
    locationLabel: "2nd floor, west wing",
  }),
  room(4, {
    name: "Room D",
    slug: "room-d",
    shortDescription: "Comfortable room for small groups.",
    fullDescription:
      "Room D is a smaller, quieter room arranged for discussion. Replace this text with the actual room description.",
    capacity: 12,
    bestFor: ["Small groups", "Prayer meetings", "Mentoring"],
    locationLabel: "2nd floor, west wing",
  }),
  room(5, {
    name: "Event's Place - A",
    slug: "events-place-a",
    shortDescription: "Multipurpose space for church activities and events.",
    fullDescription:
      "Event's Place - A is a multipurpose space for internal events and church activities. Replace this text with the actual room description.",
    capacity: 50,
    bestFor: ["Church activities", "Internal events", "Rehearsals"],
    locationLabel: "Ground floor, beside the lobby",
  }),
];

export function createDemoSeed(): DemoState {
  const now = new Date();
  const nowIso = now.toISOString();
  const today = dateKeyInZone(now);
  const day = (offset: number) => addDaysToKey(today, offset);
  const passwordHash = hashDemoPassword(DEMO_PASSWORD);

  const user = (id: string, email: string, fullName: string, phone: string, role: DemoUser["role"], accessStatus: DemoUser["accessStatus"]): DemoUser => ({
    id,
    email,
    fullName,
    phone,
    role,
    accessStatus,
    accessReason: null,
    accessReviewedAt: accessStatus === "pending" ? null : nowIso,
    accessNotificationError: null,
    ghlContactId: null,
    passwordHash,
    createdAt: nowIso,
  });

  const users: DemoUser[] = [
    user(ids.admin, DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.fullName, "+639170000001", "admin", "active"),
    user(ids.member, DEMO_ACCOUNTS.member.email, DEMO_ACCOUNTS.member.fullName, "+639170000002", "user", "active"),
    user(ids.memberTwo, "paolo@victory.test", "Paolo Reyes", "+639170000003", "user", "active"),
    user(ids.pending, DEMO_ACCOUNTS.pending.email, DEMO_ACCOUNTS.pending.fullName, "+639170000004", "user", "pending"),
  ];

  const booking = (
    n: number,
    fields: Pick<Booking, "userId" | "roomId" | "eventName" | "eventType" | "purpose" | "attendeeCount" | "status"> & {
      date: string;
      from: string;
      to: string;
      denialReason?: string;
    },
  ): Booking => ({
    id: `c7a1e2d4-6b3f-4a8e-9c2d-20000000000${n}`,
    userId: fields.userId,
    roomId: fields.roomId,
    eventName: fields.eventName,
    eventType: fields.eventType,
    purpose: fields.purpose,
    attendeeCount: fields.attendeeCount,
    startTime: zonedDateTime(fields.date, fields.from).toISOString(),
    endTime: zonedDateTime(fields.date, fields.to).toISOString(),
    status: fields.status,
    denialReason: fields.denialReason ?? null,
    ghlAppointmentId: fields.status === "approved" ? `demo-appt-seed-${n}` : null,
    googleCalendarEventId: null,
    googleCalendarSyncError: null,
    source: "web",
    whatsappMessageId: null,
    statusNotificationStatus: null,
    statusNotificationError: null,
    statusNotifiedAt: null,
    reviewedBy: fields.status === "approved" || fields.status === "denied" ? ids.admin : null,
    reviewedAt: fields.status === "approved" || fields.status === "denied" ? nowIso : null,
    reviewLockedAt: null,
    reviewLockedBy: null,
    createdAt: nowIso,
  });

  const bookings: Booking[] = [
    booking(1, {
      userId: ids.memberTwo, roomId: rooms[0].id, eventName: "Kids Ministry Teachers Huddle", eventType: "ministry_meeting",
      purpose: "Monthly planning for the kids ministry teaching team.", attendeeCount: 14, status: "approved",
      date: day(1), from: "18:00", to: "20:00",
    }),
    booking(2, {
      userId: ids.memberTwo, roomId: rooms[1].id, eventName: "Youth Worship Practice", eventType: "youth",
      purpose: "Band and vocals rehearsal for Friday youth service.", attendeeCount: 10, status: "pending",
      date: day(2), from: "16:00", to: "18:00",
    }),
    booking(3, {
      userId: ids.member, roomId: rooms[2].id, eventName: "Victory Group Leaders Meeting", eventType: "small_group",
      purpose: "Quarterly alignment for small group leaders.", attendeeCount: 12, status: "approved",
      date: day(3), from: "19:00", to: "21:00",
    }),
    booking(4, {
      userId: ids.member, roomId: rooms[3].id, eventName: "Prayer Team Gathering", eventType: "church_activity",
      purpose: "Weekly intercession meeting.", attendeeCount: 8, status: "denied",
      date: day(4), from: "07:00", to: "08:00",
      denialReason: "Room D is reserved for facility maintenance that morning. Please try Room C.",
    }),
  ];

  const poster = (n: number, title: string, file: string, fields: Partial<Announcement>): Announcement => ({
    id: `e4b2c9a1-7d3e-4f2a-8b1c-30000000000${n}`,
    internalTitle: title,
    imagePath: `demo/posters/${file}`,
    orientation: "portrait",
    publishAt: new Date(now.getTime() - n * 86_400_000).toISOString(),
    expiresAt: null,
    isPublished: true,
    createdBy: ids.admin,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...fields,
  });

  const announcements: Announcement[] = [
    poster(7, "Worship Night", "worship-night.svg", { orientation: "landscape", publishAt: new Date(now.getTime() - 3_600_000).toISOString() }),
    poster(1, "Sunday Celebration – this week", "sunday-celebration.svg", {}),
    poster(2, "Youth Night", "youth-night.svg", {}),
    poster(3, "Volunteer Orientation", "volunteer-orientation.svg", {}),
    poster(4, "Small Group Season Launch", "small-groups.svg", {
      publishAt: zonedDateTime(day(7), "09:00").toISOString(),
    }),
    poster(5, "Prayer and Fasting Week (draft)", "prayer-fasting.svg", { isPublished: false }),
    poster(6, "Summer Camp Registration", "summer-camp.svg", {
      publishAt: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      expiresAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
    }),
  ];

  return {
    users,
    accessEvents: [],
    rooms,
    bookings,
    reschedules: [],
    announcements,
    files: new Map(),
    appointments: new Map(),
    ghlContacts: new Map(),
    // The seeded member has already connected Google Calendar; new accounts have not.
    googleConnections: new Set([ids.member]),
    googleEvents: new Map(),
    sessionSecret: randomBytes(32),
  };
}
