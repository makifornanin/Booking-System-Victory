import "server-only";
import { randomUUID } from "node:crypto";
import { MAX_PENDING_PER_USER } from "@/lib/config";
import { PENDING_LIMIT_MESSAGE, RepositoryError, type ImageStorage, type Repository } from "@/lib/data/repository";
import type { AccessChange, AccessStatus, Announcement, Booking, BookingDetails, BookingWithRoom, Profile } from "@/lib/data/types";
import type { BookingStatus } from "@/lib/domain/booking-rules";
import { rangesOverlap, toRange } from "@/lib/domain/availability";
import { isBlockingStatus } from "@/lib/domain/booking-rules";
import { isLive } from "@/lib/domain/announcements";
import { getDemoState, type DemoState, type DemoUser } from "@/lib/demo/store";

function toProfile(user: DemoUser): Profile {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    accessStatus: user.accessStatus,
    accessReason: user.accessReason,
    accessReviewedAt: user.accessReviewedAt,
    accessNotificationError: user.accessNotificationError,
    ghlContactId: user.ghlContactId,
    createdAt: user.createdAt,
  };
}

/** Same transition table as public.admin_set_user_access(). */
function accessChange(from: AccessStatus, to: AccessStatus): AccessChange | null {
  if (from === "pending" && to === "active") return "approved";
  if (from === "pending" && to === "denied") return "denied";
  if (from === "active" && to === "revoked") return "revoked";
  if ((from === "denied" || from === "revoked") && to === "active") return "restored";
  return null;
}

function withRoom(state: DemoState, booking: Booking): BookingWithRoom {
  const room = state.rooms.find((r) => r.id === booking.roomId);
  return {
    ...booking,
    room: room
      ? { id: room.id, name: room.name, slug: room.slug, locationLabel: room.locationLabel }
      : { id: booking.roomId, name: "Unavailable room", slug: "", locationLabel: "" },
  };
}

function withDetails(state: DemoState, booking: Booking): BookingDetails {
  const requester = state.users.find((u) => u.id === booking.userId);
  const reviewer = booking.reviewedBy ? state.users.find((u) => u.id === booking.reviewedBy) : undefined;
  return {
    ...withRoom(state, booking),
    requester: requester
      ? { id: requester.id, fullName: requester.fullName, email: requester.email, phone: requester.phone, ghlContactId: requester.ghlContactId }
      : { id: booking.userId, fullName: "Unknown member", email: "", phone: null, ghlContactId: null },
    reviewer: reviewer ? { id: reviewer.id, fullName: reviewer.fullName } : null,
  };
}

const byStart = (a: Booking, b: Booking) => a.startTime.localeCompare(b.startTime);
const copy = <T>(value: T): T => structuredClone(value);

/**
 * In-memory repository for development. Each mutation does its check and write
 * synchronously (no await in between), which mirrors the atomicity of the
 * database constraints in the real implementation.
 */
export function createDemoRepository(actorId: string | null = null): Repository {
  const state = getDemoState();

  return {
    async getProfile(userId) {
      const user = state.users.find((u) => u.id === userId);
      return user ? toProfile(user) : null;
    },

    async listUsers(status) {
      return [...state.users]
        .filter((user) => !status || user.accessStatus === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((user) => ({ ...toProfile(user), bookingCount: state.bookings.filter((b) => b.userId === user.id).length }));
    },

    async countUsersByAccessStatus() {
      const counts: Record<AccessStatus, number> = { pending: 0, active: 0, denied: 0, revoked: 0 };
      for (const user of state.users) counts[user.accessStatus]++;
      return counts;
    },

    async listAccessEvents(userId) {
      return state.accessEvents
        .filter((event) => event.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((event) => ({
          id: event.id,
          change: event.change,
          reason: event.reason,
          actorName: state.users.find((u) => u.id === event.actorId)?.fullName ?? null,
          notificationError: event.notificationError,
          notifiedAt: event.notifiedAt,
          createdAt: event.createdAt,
        }));
    },

    async setUserAccess(userId, status, reason) {
      if (userId === actorId) throw new RepositoryError("invalid", "You can't change your own access.");
      const user = state.users.find((u) => u.id === userId);
      if (!user) return null;
      const change = accessChange(user.accessStatus, status);
      if (!change) throw new RepositoryError("invalid", "That access change isn't allowed from the user's current status.");
      const needsReason = status === "denied" || status === "revoked";
      if (needsReason && !reason?.trim()) throw new RepositoryError("invalid", "Some details were not accepted.");
      const now = new Date().toISOString();
      Object.assign(user, {
        accessStatus: status,
        accessReason: needsReason ? reason!.trim() : null,
        accessReviewedAt: now,
        accessNotificationError: null,
      });
      state.accessEvents.push({
        id: randomUUID(),
        userId,
        change,
        reason: needsReason ? reason!.trim() : null,
        actorId,
        notificationError: null,
        notifiedAt: null,
        createdAt: now,
      });
      return copy(toProfile(user));
    },

    async setAccessNotificationResult(userId, error) {
      const user = state.users.find((u) => u.id === userId);
      if (user) user.accessNotificationError = error;
      const latest = state.accessEvents.filter((e) => e.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (latest) {
        latest.notificationError = error;
        if (!error) latest.notifiedAt = new Date().toISOString();
      }
    },

    async saveGhlContactId(userId, contactId) {
      const user = state.users.find((u) => u.id === userId);
      if (user) user.ghlContactId = contactId;
    },

    async listActiveRooms() {
      return copy(state.rooms.filter((r) => r.isActive).sort((a, b) => a.displayOrder - b.displayOrder));
    },

    async getRoomBySlug(slug) {
      return copy(state.rooms.find((r) => r.slug === slug) ?? null);
    },

    async getRoomById(id) {
      return copy(state.rooms.find((r) => r.id === id) ?? null);
    },

    async getBusyRanges(roomId, from, to) {
      const window = { start: from.getTime(), end: to.getTime() };
      return state.bookings
        .filter((b) => b.roomId === roomId && isBlockingStatus(b.status))
        .map((b) => toRange(b.startTime, b.endTime))
        .filter((range) => rangesOverlap(range, window));
    },

    async findConflictingBookings(roomId, range, excludeBookingId) {
      return copy(
        state.bookings.filter(
          (b) =>
            b.roomId === roomId &&
            b.id !== excludeBookingId &&
            isBlockingStatus(b.status) &&
            rangesOverlap(toRange(b.startTime, b.endTime), range),
        ),
      );
    },

    async insertBooking(input) {
      const room = state.rooms.find((r) => r.id === input.roomId);
      if (!room || !room.isActive) throw new RepositoryError("invalid", "Room is not available for booking.");
      if (input.attendeeCount > room.capacity) throw new RepositoryError("invalid", "Attendee count exceeds room capacity.");
      const range = toRange(input.startTime, input.endTime);
      if (range.start <= Date.now()) throw new RepositoryError("invalid", "Booking must start in the future.");

      const openRequests = state.bookings.filter(
        (b) => b.userId === input.userId && b.status === "pending" && new Date(b.endTime).getTime() > Date.now(),
      ).length;
      if (openRequests >= MAX_PENDING_PER_USER) throw new RepositoryError("invalid", PENDING_LIMIT_MESSAGE);

      if (input.whatsappMessageId && state.bookings.some((b) => b.whatsappMessageId === input.whatsappMessageId)) {
        throw new RepositoryError("duplicate", "That request was already received.");
      }

      const overlaps = state.bookings.some(
        (b) => b.roomId === input.roomId && isBlockingStatus(b.status) && rangesOverlap(toRange(b.startTime, b.endTime), range),
      );
      if (overlaps) throw new RepositoryError("conflict", "That time overlaps another booking for this room.");

      const booking: Booking = {
        id: randomUUID(),
        ...input,
        source: input.source ?? "web",
        whatsappMessageId: input.whatsappMessageId ?? null,
        statusNotificationStatus: null,
        statusNotificationError: null,
        statusNotifiedAt: null,
        status: "pending",
        denialReason: null,
        ghlAppointmentId: null,
        googleCalendarEventId: null,
        googleCalendarSyncError: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewLockedAt: null,
        reviewLockedBy: null,
        createdAt: new Date().toISOString(),
      };
      state.bookings.push(booking);
      return copy(booking);
    },

    async listBookingsForUser(userId) {
      return copy(
        state.bookings
          .filter((b) => b.userId === userId)
          .sort((a, b) => b.startTime.localeCompare(a.startTime))
          .map((b) => withRoom(state, b)),
      );
    },

    async listBookingsByStatus(status, limit = 100) {
      const list = state.bookings.filter((b) => b.status === status);
      if (status === "denied") list.sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""));
      else list.sort(byStart);
      return copy(list.slice(0, limit).map((b) => withDetails(state, b)));
    },

    async listBookingsBetween(from, to, statuses) {
      const window = { start: from.getTime(), end: to.getTime() };
      return copy(
        state.bookings
          .filter((b) => statuses.includes(b.status) && rangesOverlap(toRange(b.startTime, b.endTime), window))
          .sort(byStart)
          .map((b) => withDetails(state, b)),
      );
    },

    async getBookingDetails(id) {
      const booking = state.bookings.find((b) => b.id === id);
      return booking ? copy(withDetails(state, booking)) : null;
    },

    async findBookingByWhatsAppMessageId(messageId) {
      // Mirrors RLS: members only see their own bookings.
      const actorIsAdmin = state.users.find((u) => u.id === actorId)?.role === "admin";
      const booking = state.bookings.find((b) => b.whatsappMessageId === messageId && (actorIsAdmin || b.userId === actorId));
      return booking ? copy(withDetails(state, booking)) : null;
    },

    async countBookingsByStatus() {
      const counts: Record<BookingStatus, number> = { pending: 0, approved: 0, denied: 0, cancelled: 0 };
      for (const booking of state.bookings) counts[booking.status]++;
      return counts;
    },

    async claimBookingForReview(id, adminId, now, staleBefore) {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking || booking.status !== "pending") return null;
      if (booking.reviewLockedAt && new Date(booking.reviewLockedAt) >= staleBefore) return null;
      booking.reviewLockedAt = now.toISOString();
      booking.reviewLockedBy = adminId;
      return copy(booking);
    },

    async releaseReviewClaim(id, adminId) {
      const booking = state.bookings.find((b) => b.id === id);
      if (booking && booking.reviewLockedBy === adminId) {
        booking.reviewLockedAt = null;
        booking.reviewLockedBy = null;
      }
    },

    async markApproved(id, adminId, ghlAppointmentId, now) {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking || booking.status !== "pending" || booking.reviewLockedBy !== adminId) return null;
      Object.assign(booking, {
        status: "approved",
        ghlAppointmentId,
        reviewedBy: adminId,
        reviewedAt: now.toISOString(),
        reviewLockedAt: null,
        reviewLockedBy: null,
      } satisfies Partial<Booking>);
      return copy(booking);
    },

    async markDenied(id, adminId, reason, now) {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking || booking.status !== "pending" || booking.reviewLockedBy !== adminId) return null;
      Object.assign(booking, {
        status: "denied",
        denialReason: reason,
        reviewedBy: adminId,
        reviewedAt: now.toISOString(),
        reviewLockedAt: null,
        reviewLockedBy: null,
      } satisfies Partial<Booking>);
      return copy(booking);
    },

    async cancelOwnBooking(id, userId) {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking || booking.userId !== userId || !(booking.status === "pending" || booking.status === "approved")) return null;
      if (new Date(booking.startTime).getTime() <= Date.now()) return null;
      if (booking.reviewLockedAt && Date.now() - new Date(booking.reviewLockedAt).getTime() < 2 * 60_000) return null;
      booking.status = "cancelled";
      return copy(booking);
    },

    async cancelApprovedBooking(id) {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking || booking.status !== "approved") return null;
      booking.status = "cancelled";
      return copy(booking);
    },

    async setCalendarSync(bookingId, eventId, error) {
      const booking = state.bookings.find((b) => b.id === bookingId);
      if (booking) Object.assign(booking, { googleCalendarEventId: eventId, googleCalendarSyncError: error });
    },

    async listLiveAnnouncements() {
      const now = new Date();
      return copy(
        state.announcements
          .filter((a) => isLive(a, now))
          .sort((a, b) => b.publishAt.localeCompare(a.publishAt)),
      );
    },

    async listAllAnnouncements() {
      return copy([...state.announcements].sort((a, b) => b.publishAt.localeCompare(a.publishAt)));
    },

    async getAnnouncement(id) {
      return copy(state.announcements.find((a) => a.id === id) ?? null);
    },

    // Mirrors the member RLS policy: only live announcements are visible.
    async findAnnouncementByImagePath(path) {
      const now = new Date();
      return copy(state.announcements.find((a) => a.imagePath === path && isLive(a, now)) ?? null);
    },

    async createAnnouncement(input, createdBy) {
      const nowIso = new Date().toISOString();
      const announcement: Announcement = { id: randomUUID(), ...input, createdBy, createdAt: nowIso, updatedAt: nowIso };
      state.announcements.push(announcement);
      return copy(announcement);
    },

    async updateAnnouncement(id, input) {
      const announcement = state.announcements.find((a) => a.id === id);
      if (!announcement) return null;
      Object.assign(announcement, input, { updatedAt: new Date().toISOString() });
      return copy(announcement);
    },

    async deleteAnnouncement(id) {
      const index = state.announcements.findIndex((a) => a.id === id);
      if (index === -1) return null;
      const [removed] = state.announcements.splice(index, 1);
      return copy(removed);
    },
  };
}

export function createDemoImageStorage(): ImageStorage {
  const state = getDemoState();
  return {
    async upload(key, bytes, contentType) {
      state.files.set(key, { bytes, contentType });
    },
    async remove(key) {
      state.files.delete(key);
    },
  };
}
