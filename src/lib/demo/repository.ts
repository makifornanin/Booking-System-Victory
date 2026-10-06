import "server-only";
import { randomUUID } from "node:crypto";
import { MAX_PENDING_PER_USER } from "@/lib/config";
import { PENDING_LIMIT_MESSAGE, RepositoryError, type ImageStorage, type Repository } from "@/lib/data/repository";
import type { AccessChange, AccessStatus, Announcement, Booking, BookingDetails, BookingWithRoom, Profile, RescheduleRequest, RescheduleStatus } from "@/lib/data/types";
import type { BookingStatus } from "@/lib/domain/booking-rules";
import { rangesOverlap, toRange } from "@/lib/domain/availability";
import { isBlockingStatus, validateBookingWindow } from "@/lib/domain/booking-rules";
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
  const actorIsAdminNow = () => state.users.find((u) => u.id === actorId)?.role === "admin";
  /** Mirrors RLS: members see their own requests, admins see all. */
  const visibleRequest = (r: RescheduleRequest) => actorIsAdminNow() || r.requestedBy === actorId;
  const pendingHolds = (roomId: string, excludeId?: string) => state.reschedules.filter((r) => r.roomId === roomId && r.status === "pending" && r.id !== excludeId);
  const releaseHolds = (bookingId: string) => {
    for (const r of state.reschedules) if (r.bookingId === bookingId && r.status === "pending") r.status = "cancelled";
  };
  const newestFirst = (list: RescheduleRequest[]) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const reviewerOf = (r: RescheduleRequest) => {
    const reviewer = r.reviewedBy ? state.users.find((u) => u.id === r.reviewedBy) : undefined;
    return reviewer ? { id: reviewer.id, fullName: reviewer.fullName } : null;
  };

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

    async getBusyRanges(roomId, from, to, options) {
      const window = { start: from.getTime(), end: to.getTime() };
      const bookings = state.bookings.filter((b) => b.roomId === roomId && isBlockingStatus(b.status)).map((b) => toRange(b.startTime, b.endTime));
      const holds = pendingHolds(roomId, options?.excludeRescheduleId).map((r) => toRange(r.requestedStart, r.requestedEnd));
      return [...bookings, ...holds].filter((range) => rangesOverlap(range, window)).sort((a, b) => a.start - b.start);
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

      const overlaps =
        state.bookings.some((b) => b.roomId === input.roomId && isBlockingStatus(b.status) && rangesOverlap(toRange(b.startTime, b.endTime), range)) ||
        pendingHolds(input.roomId).some((r) => rangesOverlap(toRange(r.requestedStart, r.requestedEnd), range));
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
      releaseHolds(booking.id);
      return copy(booking);
    },

    async cancelApprovedBooking(id) {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking || booking.status !== "approved") return null;
      booking.status = "cancelled";
      releaseHolds(booking.id);
      return copy(booking);
    },

    // --- Reschedule requests (mirrors migration 0009) ------------------------

    async insertRescheduleRequest(input) {
      const booking = state.bookings.find((b) => b.id === input.bookingId);
      if (!booking || booking.userId !== actorId) throw new RepositoryError("forbidden", "You do not have permission to do that.");
      if (booking.status !== "approved") throw new RepositoryError("invalid", "Only approved bookings can be rescheduled.");
      if (new Date(booking.startTime).getTime() <= Date.now()) throw new RepositoryError("invalid", "Past bookings can't be rescheduled.");
      const problem = validateBookingWindow({ start: new Date(input.requestedStart), end: new Date(input.requestedEnd), now: new Date() });
      if (problem) throw new RepositoryError("invalid", problem);
      if (state.reschedules.some((r) => r.bookingId === booking.id && r.status === "pending")) {
        throw new RepositoryError("duplicate", "That request was already received.");
      }
      const range = toRange(input.requestedStart, input.requestedEnd);
      const overlaps =
        state.bookings.some((b) => b.roomId === booking.roomId && isBlockingStatus(b.status) && rangesOverlap(toRange(b.startTime, b.endTime), range)) ||
        pendingHolds(booking.roomId).some((r) => rangesOverlap(toRange(r.requestedStart, r.requestedEnd), range));
      if (overlaps) throw new RepositoryError("conflict", "That time overlaps another booking for this room.");

      const request: RescheduleRequest = {
        id: randomUUID(),
        bookingId: booking.id,
        roomId: booking.roomId,
        requestedBy: booking.userId,
        originalStart: booking.startTime,
        originalEnd: booking.endTime,
        requestedStart: new Date(input.requestedStart).toISOString(),
        requestedEnd: new Date(input.requestedEnd).toISOString(),
        status: "pending",
        denialReason: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewLockedAt: null,
        reviewLockedBy: null,
        notificationError: null,
        createdAt: new Date().toISOString(),
      };
      state.reschedules.push(request);
      return copy(request);
    },

    async getRescheduleRequest(id) {
      const request = state.reschedules.find((r) => r.id === id && visibleRequest(r));
      if (!request) return null;
      const booking = state.bookings.find((b) => b.id === request.bookingId);
      if (!booking) return null;
      return copy({ ...request, booking: withDetails(state, booking), reviewer: reviewerOf(request) });
    },

    async listRescheduleRequestsForBooking(bookingId) {
      return copy(newestFirst(state.reschedules.filter((r) => r.bookingId === bookingId && visibleRequest(r))));
    },

    async listRescheduleRequestsForUser(userId) {
      return copy(newestFirst(state.reschedules.filter((r) => r.requestedBy === userId && visibleRequest(r))));
    },

    async listRescheduleRequestsByStatus(status, limit = 100) {
      if (!actorIsAdminNow()) return [];
      return copy(
        state.reschedules
          .filter((r) => r.status === status)
          .sort((a, b) => (status === "pending" ? a.requestedStart.localeCompare(b.requestedStart) : (b.reviewedAt ?? b.createdAt).localeCompare(a.reviewedAt ?? a.createdAt)))
          .slice(0, limit)
          .flatMap((r) => {
            const booking = state.bookings.find((b) => b.id === r.bookingId);
            return booking ? [{ ...r, booking: withDetails(state, booking), reviewer: reviewerOf(r) }] : [];
          }),
      );
    },

    async countRescheduleRequestsByStatus() {
      const counts: Record<RescheduleStatus, number> = { pending: 0, approved: 0, denied: 0, cancelled: 0 };
      for (const request of state.reschedules) counts[request.status]++;
      return counts;
    },

    async claimRescheduleForReview(id, adminId, now, staleBefore) {
      const request = state.reschedules.find((r) => r.id === id);
      if (!request || request.status !== "pending") return null;
      if (request.reviewLockedAt && new Date(request.reviewLockedAt) >= staleBefore) return null;
      request.reviewLockedAt = now.toISOString();
      request.reviewLockedBy = adminId;
      return copy(request);
    },

    async releaseRescheduleClaim(id, adminId) {
      const request = state.reschedules.find((r) => r.id === id);
      if (request && request.reviewLockedBy === adminId) {
        request.reviewLockedAt = null;
        request.reviewLockedBy = null;
      }
    },

    async applyReschedule(id) {
      if (!actorIsAdminNow()) throw new RepositoryError("forbidden", "You do not have permission to do that.");
      const request = state.reschedules.find((r) => r.id === id);
      if (!request || request.status !== "pending" || request.reviewLockedBy !== actorId) return null;
      const booking = state.bookings.find((b) => b.id === request.bookingId);
      if (!booking || booking.status !== "approved" || booking.startTime !== request.originalStart || booking.endTime !== request.originalEnd) {
        throw new RepositoryError("invalid", "The booking changed after this request was made, so it can't be applied. Deny it and ask the member to request again.");
      }
      if (new Date(request.requestedStart).getTime() <= Date.now()) throw new RepositoryError("invalid", "That time has already passed. Choose a future time.");
      const range = toRange(request.requestedStart, request.requestedEnd);
      const overlaps =
        state.bookings.some((b) => b.id !== booking.id && b.roomId === booking.roomId && isBlockingStatus(b.status) && rangesOverlap(toRange(b.startTime, b.endTime), range)) ||
        pendingHolds(booking.roomId, request.id).some((r) => rangesOverlap(toRange(r.requestedStart, r.requestedEnd), range));
      if (overlaps) throw new RepositoryError("conflict", "That time overlaps another booking for this room.");

      const nowIso = new Date().toISOString();
      Object.assign(request, { status: "approved", reviewedBy: actorId, reviewedAt: nowIso, reviewLockedAt: null, reviewLockedBy: null });
      booking.startTime = request.requestedStart;
      booking.endTime = request.requestedEnd;
      return copy(booking);
    },

    async markRescheduleDenied(id, adminId, reason, now) {
      const request = state.reschedules.find((r) => r.id === id);
      if (!request || request.status !== "pending" || request.reviewLockedBy !== adminId) return null;
      Object.assign(request, { status: "denied", denialReason: reason, reviewedBy: adminId, reviewedAt: now.toISOString(), reviewLockedAt: null, reviewLockedBy: null });
      return copy(request);
    },

    async cancelOwnReschedule(id) {
      const request = state.reschedules.find((r) => r.id === id);
      if (!request || request.requestedBy !== actorId || request.status !== "pending") return null;
      if (request.reviewLockedAt && Date.now() - new Date(request.reviewLockedAt).getTime() < 2 * 60_000) return null;
      request.status = "cancelled";
      return copy(request);
    },

    async setRescheduleNotificationResult(id, error) {
      const request = state.reschedules.find((r) => r.id === id);
      if (request) request.notificationError = error;
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
