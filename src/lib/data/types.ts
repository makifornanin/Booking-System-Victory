import type { BookingStatus } from "@/lib/domain/booking-rules";

export type Role = "user" | "admin";

export type AccessStatus = "pending" | "active" | "denied" | "revoked";
export type AccessChange = "approved" | "denied" | "revoked" | "restored";

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  accessStatus: AccessStatus;
  accessReason: string | null;
  accessReviewedAt: string | null;
  /** Set when the latest GHL account-status email failed, so it can be retried. */
  accessNotificationError: string | null;
  ghlContactId: string | null;
  createdAt: string;
}

export interface UserSummary extends Profile {
  bookingCount: number;
}

export interface AccessEvent {
  id: string;
  change: AccessChange;
  reason: string | null;
  actorName: string | null;
  notificationError: string | null;
  notifiedAt: string | null;
  createdAt: string;
}

export interface Room {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  fullDescription: string;
  capacity: number;
  bestFor: string[];
  locationLabel: string;
  imagePath: string | null;
  mapImagePath: string | null;
  ghlCalendarId: string | null;
  isActive: boolean;
  displayOrder: number;
}

export interface Booking {
  id: string;
  userId: string;
  roomId: string;
  eventName: string;
  eventType: string;
  purpose: string;
  attendeeCount: number;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  denialReason: string | null;
  ghlAppointmentId: string | null;
  googleCalendarEventId: string | null;
  googleCalendarSyncError: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewLockedAt: string | null;
  reviewLockedBy: string | null;
  createdAt: string;
}

export interface BookingWithRoom extends Booking {
  room: Pick<Room, "id" | "name" | "slug" | "locationLabel">;
}

export interface BookingDetails extends BookingWithRoom {
  requester: Pick<Profile, "id" | "fullName" | "email" | "phone" | "ghlContactId">;
  reviewer: Pick<Profile, "id" | "fullName"> | null;
}

export interface NewBooking {
  userId: string;
  roomId: string;
  eventName: string;
  eventType: string;
  purpose: string;
  attendeeCount: number;
  startTime: string;
  endTime: string;
}

export type PosterOrientation = "portrait" | "landscape";

export interface Announcement {
  id: string;
  internalTitle: string;
  imagePath: string;
  /** Portrait posters are shown at 4:5, landscape at 16:9. */
  orientation: PosterOrientation;
  publishAt: string;
  expiresAt: string | null;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementInput {
  internalTitle: string;
  imagePath: string;
  orientation: PosterOrientation;
  publishAt: string;
  expiresAt: string | null;
  isPublished: boolean;
}
