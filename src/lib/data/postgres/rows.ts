import type {
  AccessChange,
  AccessEvent,
  AccessStatus,
  Announcement,
  Booking,
  BookingDetails,
  BookingWithRoom,
  Profile,
  RescheduleRequest,
  RescheduleStatus,
  Role,
  RoleChange,
  Room,
  UserSummary,
} from "@/lib/data/types";
import type { BookingStatus } from "@/lib/domain/booking-rules";

type Timestamp = Date | string;
const iso = (value: Timestamp): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
const isoOrNull = (value: Timestamp | null): string | null => (value === null ? null : iso(value));

export interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  access_status: AccessStatus;
  access_reason: string | null;
  access_reviewed_at: Timestamp | null;
  access_notification_error: string | null;
  ghl_contact_id: string | null;
  created_at: Timestamp;
}

export interface RoomRow {
  id: string;
  name: string;
  slug: string;
  short_description: string;
  full_description: string;
  capacity: number;
  best_for: string[] | null;
  location_label: string;
  image_path: string | null;
  map_image_path: string | null;
  ghl_calendar_id: string | null;
  is_active: boolean;
  display_order: number;
}

export interface BookingRow {
  id: string;
  user_id: string;
  room_id: string;
  event_name: string;
  event_type: string;
  purpose: string;
  attendee_count: number;
  start_time: Timestamp;
  end_time: Timestamp;
  status: BookingStatus;
  denial_reason: string | null;
  ghl_appointment_id: string | null;
  google_calendar_event_id: string | null;
  google_calendar_sync_error: string | null;
  ghl_notification_error: string | null;
  source: string;
  whatsapp_message_id: string | null;
  status_notification_status: string | null;
  status_notification_error: string | null;
  status_notified_at: Timestamp | null;
  reviewed_by: string | null;
  reviewed_at: Timestamp | null;
  review_locked_at: Timestamp | null;
  review_locked_by: string | null;
  created_at: Timestamp;
}

export interface BookingWithRoomRow extends BookingRow {
  room_name: string | null;
  room_slug: string | null;
  room_location: string | null;
}

export interface BookingDetailsRow extends BookingWithRoomRow {
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  requester_ghl_contact_id: string | null;
  reviewer_name: string | null;
}

export interface AccessEventRow {
  id: string;
  change: AccessChange | RoleChange;
  reason: string | null;
  previous_role: Role | null;
  new_role: Role | null;
  actor_name: string | null;
  notification_error: string | null;
  notified_at: Timestamp | null;
  created_at: Timestamp;
}

export interface AnnouncementRow {
  id: string;
  internal_title: string;
  image_path: string;
  orientation: string;
  publish_at: Timestamp;
  expires_at: Timestamp | null;
  is_published: boolean;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export const BOOKING_WITH_ROOM_SELECT = `
  select b.*, r.name as room_name, r.slug as room_slug, r.location_label as room_location
  from public.bookings b
  left join public.rooms r on r.id = b.room_id`;

export const BOOKING_DETAILS_SELECT = `
  select b.*, r.name as room_name, r.slug as room_slug, r.location_label as room_location,
         p.full_name as requester_name, p.email as requester_email, p.phone as requester_phone,
         p.ghl_contact_id as requester_ghl_contact_id,
         rv.full_name as reviewer_name
  from public.bookings b
  left join public.rooms r on r.id = b.room_id
  left join public.profiles p on p.id = b.user_id
  left join public.profiles rv on rv.id = b.reviewed_by`;

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    accessStatus: row.access_status,
    accessReason: row.access_reason,
    accessReviewedAt: isoOrNull(row.access_reviewed_at),
    accessNotificationError: row.access_notification_error,
    ghlContactId: row.ghl_contact_id,
    createdAt: iso(row.created_at),
  };
}

export function toUserSummary(row: ProfileRow & { booking_count: number }): UserSummary {
  return { ...toProfile(row), bookingCount: Number(row.booking_count) };
}

export function toAccessEvent(row: AccessEventRow): AccessEvent {
  return {
    id: row.id,
    change: row.change,
    reason: row.reason,
    previousRole: row.previous_role ?? null,
    newRole: row.new_role ?? null,
    actorName: row.actor_name,
    notificationError: row.notification_error,
    notifiedAt: isoOrNull(row.notified_at),
    createdAt: iso(row.created_at),
  };
}

export function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    capacity: row.capacity,
    bestFor: row.best_for ?? [],
    locationLabel: row.location_label,
    imagePath: row.image_path,
    mapImagePath: row.map_image_path,
    ghlCalendarId: row.ghl_calendar_id?.trim() || null,
    isActive: row.is_active,
    displayOrder: row.display_order,
  };
}

export function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    userId: row.user_id,
    roomId: row.room_id,
    eventName: row.event_name,
    eventType: row.event_type,
    purpose: row.purpose,
    attendeeCount: row.attendee_count,
    startTime: iso(row.start_time),
    endTime: iso(row.end_time),
    status: row.status,
    denialReason: row.denial_reason,
    ghlAppointmentId: row.ghl_appointment_id,
    googleCalendarEventId: row.google_calendar_event_id,
    googleCalendarSyncError: row.google_calendar_sync_error,
    ghlNotificationError: row.ghl_notification_error ?? null,
    source: row.source === "whatsapp" ? "whatsapp" : "web",
    whatsappMessageId: row.whatsapp_message_id ?? null,
    statusNotificationStatus: row.status_notification_status ?? null,
    statusNotificationError: row.status_notification_error ?? null,
    statusNotifiedAt: isoOrNull(row.status_notified_at ?? null),
    reviewedBy: row.reviewed_by,
    reviewedAt: isoOrNull(row.reviewed_at),
    reviewLockedAt: isoOrNull(row.review_locked_at),
    reviewLockedBy: row.review_locked_by,
    createdAt: iso(row.created_at),
  };
}

export function toBookingWithRoom(row: BookingWithRoomRow): BookingWithRoom {
  return {
    ...toBooking(row),
    room: row.room_name
      ? { id: row.room_id, name: row.room_name, slug: row.room_slug ?? "", locationLabel: row.room_location ?? "" }
      : { id: row.room_id, name: "Unavailable room", slug: "", locationLabel: "" },
  };
}

export function toBookingDetails(row: BookingDetailsRow): BookingDetails {
  return {
    ...toBookingWithRoom(row),
    requester: {
      id: row.user_id,
      fullName: row.requester_name ?? "Unknown member",
      email: row.requester_email ?? "",
      phone: row.requester_phone,
      ghlContactId: row.requester_ghl_contact_id,
    },
    reviewer: row.reviewed_by && row.reviewer_name !== null ? { id: row.reviewed_by, fullName: row.reviewer_name } : null,
  };
}

export function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    internalTitle: row.internal_title,
    imagePath: row.image_path,
    orientation: row.orientation === "landscape" ? "landscape" : "portrait",
    publishAt: iso(row.publish_at),
    expiresAt: isoOrNull(row.expires_at),
    isPublished: row.is_published,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export interface RescheduleRow {
  id: string;
  booking_id: string;
  room_id: string;
  requested_by: string;
  original_start: Timestamp;
  original_end: Timestamp;
  requested_start: Timestamp;
  requested_end: Timestamp;
  status: RescheduleStatus;
  denial_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Timestamp | null;
  review_locked_at: Timestamp | null;
  review_locked_by: string | null;
  notification_error: string | null;
  created_at: Timestamp;
  reviewer_name?: string | null;
}

export function toRescheduleRequest(row: RescheduleRow): RescheduleRequest {
  return {
    id: row.id,
    bookingId: row.booking_id,
    roomId: row.room_id,
    requestedBy: row.requested_by,
    originalStart: iso(row.original_start),
    originalEnd: iso(row.original_end),
    requestedStart: iso(row.requested_start),
    requestedEnd: iso(row.requested_end),
    status: row.status,
    denialReason: row.denial_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: isoOrNull(row.reviewed_at),
    reviewLockedAt: isoOrNull(row.review_locked_at),
    reviewLockedBy: row.review_locked_by,
    notificationError: row.notification_error,
    createdAt: iso(row.created_at),
  };
}
