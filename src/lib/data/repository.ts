import type { TimeRange } from "@/lib/domain/availability";
import type { BookingStatus } from "@/lib/domain/booking-rules";
import type {
  AccessEvent,
  AccessStatus,
  Announcement,
  AnnouncementInput,
  Booking,
  BookingDetails,
  BookingWithRoom,
  NewBooking,
  Profile,
  Room,
  UserSummary,
} from "@/lib/data/types";

export type RepositoryErrorCode = "conflict" | "duplicate" | "invalid" | "not_found" | "forbidden" | "unknown";

export const PENDING_LIMIT_MESSAGE =
  "You already have the maximum number of requests waiting for review. Cancel one or wait for the office to respond.";

export class RepositoryError extends Error {
  constructor(
    public readonly code: RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

/**
 * Data access used by services. The Postgres implementation runs as the
 * restricted app_member role for the signed-in user, so RLS applies to every
 * call; services still check roles and access status.
 */
export interface Repository {
  getProfile(userId: string): Promise<Profile | null>;
  /** Admin-only: users with their booking counts, optionally filtered by access status. */
  listUsers(status?: AccessStatus): Promise<UserSummary[]>;
  countUsersByAccessStatus(): Promise<Record<AccessStatus, number>>;
  listAccessEvents(userId: string): Promise<AccessEvent[]>;
  /** Throws RepositoryError("invalid") for transitions the database rejects. */
  setUserAccess(userId: string, status: AccessStatus, reason: string | null): Promise<Profile | null>;
  setAccessNotificationResult(userId: string, error: string | null): Promise<void>;
  saveGhlContactId(userId: string, contactId: string): Promise<void>;

  listActiveRooms(): Promise<Room[]>;
  getRoomBySlug(slug: string): Promise<Room | null>;
  getRoomById(id: string): Promise<Room | null>;

  /** Pending/approved periods for a room, without requester details. */
  getBusyRanges(roomId: string, from: Date, to: Date): Promise<TimeRange[]>;
  /** Admin-only: other blocking bookings that overlap the given window. */
  findConflictingBookings(roomId: string, range: TimeRange, excludeBookingId?: string): Promise<Booking[]>;

  /** Throws RepositoryError("conflict") on an overlap, RepositoryError("duplicate") on a reused WhatsApp message id. */
  insertBooking(input: NewBooking): Promise<Booking>;
  /** The visible booking created from a WhatsApp message, if any (RLS: own bookings for members). */
  findBookingByWhatsAppMessageId(messageId: string): Promise<BookingDetails | null>;
  listBookingsForUser(userId: string): Promise<BookingWithRoom[]>;
  listBookingsByStatus(status: BookingStatus, limit?: number): Promise<BookingDetails[]>;
  listBookingsBetween(from: Date, to: Date, statuses: BookingStatus[]): Promise<BookingDetails[]>;
  getBookingDetails(id: string): Promise<BookingDetails | null>;
  countBookingsByStatus(): Promise<Record<BookingStatus, number>>;

  /** Atomically claims a pending booking for approval. Returns null if not claimable. */
  claimBookingForReview(id: string, adminId: string, now: Date, staleBefore: Date): Promise<Booking | null>;
  releaseReviewClaim(id: string, adminId: string): Promise<void>;
  markApproved(id: string, adminId: string, ghlAppointmentId: string | null, now: Date): Promise<Booking | null>;
  /** Denies a pending booking this admin has claimed. Returns null if not deniable. */
  markDenied(id: string, adminId: string, reason: string, now: Date): Promise<Booking | null>;
  /** Member cancels their own future pending or approved booking. */
  cancelOwnBooking(id: string, userId: string): Promise<Booking | null>;
  /** Admin cancels an approved booking (after GHL was cancelled). */
  cancelApprovedBooking(id: string): Promise<Booking | null>;
  setCalendarSync(bookingId: string, eventId: string | null, error: string | null): Promise<void>;

  listLiveAnnouncements(): Promise<Announcement[]>;
  listAllAnnouncements(): Promise<Announcement[]>;
  getAnnouncement(id: string): Promise<Announcement | null>;
  /** Visible to members only while the announcement is live (RLS); admins see all. */
  findAnnouncementByImagePath(path: string): Promise<Announcement | null>;
  createAnnouncement(input: AnnouncementInput, createdBy: string): Promise<Announcement>;
  updateAnnouncement(id: string, input: Partial<AnnouncementInput>): Promise<Announcement | null>;
  deleteAnnouncement(id: string): Promise<Announcement | null>;
}

/** Private object storage. Keys use the prefixes announcements/, rooms/ and maps/. */
export interface ImageStorage {
  upload(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}
