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

export type BookingSource = "web" | "whatsapp";

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
  /** Where the request came from. WhatsApp requests come through the n8n assistant. */
  source: BookingSource;
  /** WhatsApp message that created the request (idempotency key). */
  whatsappMessageId: string | null;
  /** Last status notification sent to n8n (WhatsApp bookings only). */
  statusNotificationStatus: string | null;
  statusNotificationError: string | null;
  statusNotifiedAt: string | null;
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

export type RescheduleStatus = "pending" | "approved" | "denied" | "cancelled";

/** A member's request to move an approved booking to a new time in the same room. */
export interface RescheduleRequest {
  id: string;
  bookingId: string;
  roomId: string;
  requestedBy: string;
  originalStart: string;
  originalEnd: string;
  requestedStart: string;
  requestedEnd: string;
  status: RescheduleStatus;
  denialReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewLockedAt: string | null;
  reviewLockedBy: string | null;
  /** Last GHL email problem for this request, if any. */
  notificationError: string | null;
  createdAt: string;
}

export interface RescheduleRequestDetails extends RescheduleRequest {
  booking: BookingDetails;
  reviewer: Pick<Profile, "id" | "fullName"> | null;
}

export interface NewBooking {
  userId: string;
  source?: BookingSource;
  whatsappMessageId?: string | null;
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
