import "server-only";
import { asMember } from "@/lib/db/client";
import { PENDING_LIMIT_MESSAGE, RepositoryError, type Repository } from "@/lib/data/repository";
import type { AccessStatus, AnnouncementInput } from "@/lib/data/types";
import type { BookingStatus } from "@/lib/domain/booking-rules";
import {
  BOOKING_DETAILS_SELECT,
  BOOKING_WITH_ROOM_SELECT,
  toAccessEvent,
  toAnnouncement,
  toBooking,
  toBookingDetails,
  toBookingWithRoom,
  toProfile,
  toRoom,
  toUserSummary,
  type AccessEventRow,
  type AnnouncementRow,
  type BookingDetailsRow,
  type BookingRow,
  type BookingWithRoomRow,
  type ProfileRow,
  type RoomRow,
} from "@/lib/data/postgres/rows";

/** Messages raised by database triggers/functions, mapped to user-facing text. */
const DB_MESSAGES: Record<string, string> = {
  "Room is not available for booking": "This room is not available for booking.",
  "Attendee count exceeds room capacity": "The attendee count is more than this room holds.",
  "Booking must start in the future": "That time has already passed. Choose a future time.",
  "Bookings open up to 90 days ahead": "Bookings open up to 90 days ahead.",
  "That time is outside bookable hours": "That time is outside bookable hours.",
  "Bookings use 30-minute steps": "Bookings use 30-minute steps.",
  "You have too many pending requests": PENDING_LIMIT_MESSAGE,
  "Admins cannot change their own access": "You can't change your own access.",
};

function toRepositoryError(error: unknown, context: string): RepositoryError {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  switch (code) {
    case "23P01":
      return new RepositoryError("conflict", "That time overlaps another booking for this room.");
    case "23505":
      return new RepositoryError("duplicate", "That request was already received.");
    case "23514":
    case "22023":
    case "23502":
    case "22P02":
      if (message?.startsWith("Invalid access change")) return new RepositoryError("invalid", "That access change isn't allowed from the user's current status.");
      return new RepositoryError("invalid", (message && DB_MESSAGES[message]) ?? "Some details were not accepted.");
    case "42501":
      return new RepositoryError("forbidden", "You do not have permission to do that.");
    default:
      console.error(`[db] ${context} failed (${code ?? "no code"}): ${message ?? "unknown error"}`);
      return new RepositoryError("unknown", "The database request failed.");
  }
}

const ANNOUNCEMENT_COLUMNS: Record<keyof AnnouncementInput, string> = {
  internalTitle: "internal_title",
  imagePath: "image_path",
  orientation: "orientation",
  publishAt: "publish_at",
  expiresAt: "expires_at",
  isPublished: "is_published",
};

const ACCESS_STATUSES: AccessStatus[] = ["pending", "active", "denied", "revoked"];
const BOOKING_STATUSES: BookingStatus[] = ["pending", "approved", "denied", "cancelled"];

/**
 * Repository backed by Neon Postgres. Every call runs as `app_member` for the
 * signed-in user (or with no user), so RLS and column grants apply.
 */
export function createPostgresRepository(actorId: string | null): Repository {
  async function query<R extends object>(context: string, text: string, params: unknown[] = []): Promise<R[]> {
    try {
      return (await asMember(actorId, text, params)) as R[];
    } catch (error) {
      throw toRepositoryError(error, context);
    }
  }
  const first = async <R extends object>(context: string, text: string, params: unknown[] = []) =>
    (await query<R>(context, text, params))[0] ?? null;

  const repo: Repository = {
    async getProfile(userId) {
      const row = await first<ProfileRow>("getProfile", "select * from public.profiles where id = $1", [userId]);
      return row ? toProfile(row) : null;
    },

    async listUsers(status) {
      const rows = await query<ProfileRow & { booking_count: number }>(
        "listUsers",
        `select p.*, (select count(*) from public.bookings b where b.user_id = p.id)::int as booking_count
         from public.profiles p
         where $1::public.access_status is null or p.access_status = $1::public.access_status
         order by p.created_at desc
         limit 500`,
        [status ?? null],
      );
      return rows.map(toUserSummary);
    },

    async countUsersByAccessStatus() {
      const rows = await query<{ access_status: AccessStatus; n: number }>(
        "countUsersByAccessStatus",
        "select access_status, count(*)::int as n from public.profiles group by access_status",
      );
      const counts = Object.fromEntries(ACCESS_STATUSES.map((s) => [s, 0])) as Record<AccessStatus, number>;
      for (const row of rows) counts[row.access_status] = row.n;
      return counts;
    },

    async listAccessEvents(userId) {
      const rows = await query<AccessEventRow>(
        "listAccessEvents",
        `select e.*, a.full_name as actor_name
         from public.account_access_events e
         left join public.profiles a on a.id = e.actor_id
         where e.user_id = $1 order by e.created_at desc limit 50`,
        [userId],
      );
      return rows.map(toAccessEvent);
    },

    async setUserAccess(userId, status, reason) {
      const row = await first<ProfileRow>("setUserAccess", "select * from public.admin_set_user_access($1, $2, $3)", [userId, status, reason]);
      return row ? toProfile(row) : null;
    },

    async setAccessNotificationResult(userId, error) {
      await query("setAccessNotificationResult", "select public.admin_set_access_notification($1, $2)", [userId, error]);
    },

    async saveGhlContactId(userId, contactId) {
      await query("saveGhlContactId", "select public.admin_set_ghl_contact($1, $2)", [userId, contactId]);
    },

    async listActiveRooms() {
      const rows = await query<RoomRow>("listActiveRooms", "select * from public.rooms where is_active order by display_order, name");
      return rows.map(toRoom);
    },

    async getRoomBySlug(slug) {
      const row = await first<RoomRow>("getRoomBySlug", "select * from public.rooms where slug = $1", [slug]);
      return row ? toRoom(row) : null;
    },

    async getRoomById(id) {
      const row = await first<RoomRow>("getRoomById", "select * from public.rooms where id = $1", [id]);
      return row ? toRoom(row) : null;
    },

    async getBusyRanges(roomId, from, to) {
      const rows = await query<{ start_time: Date; end_time: Date }>(
        "getBusyRanges",
        "select * from public.get_room_busy_ranges($1, $2, $3)",
        [roomId, from, to],
      );
      return rows.map((row) => ({ start: new Date(row.start_time).getTime(), end: new Date(row.end_time).getTime() }));
    },

    async findConflictingBookings(roomId, range, excludeBookingId) {
      const rows = await query<BookingRow>(
        "findConflictingBookings",
        `select * from public.bookings
         where room_id = $1 and status in ('pending', 'approved') and start_time < $3 and end_time > $2
           and ($4::uuid is null or id <> $4::uuid)`,
        [roomId, new Date(range.start), new Date(range.end), excludeBookingId ?? null],
      );
      return rows.map(toBooking);
    },

    async insertBooking(input) {
      const row = await first<BookingRow>(
        "insertBooking",
        `insert into public.bookings (user_id, room_id, event_name, event_type, purpose, attendee_count, start_time, end_time, source, whatsapp_message_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
        [
          input.userId,
          input.roomId,
          input.eventName,
          input.eventType,
          input.purpose,
          input.attendeeCount,
          input.startTime,
          input.endTime,
          input.source ?? "web",
          input.whatsappMessageId ?? null,
        ],
      );
      return toBooking(row!);
    },

    async findBookingByWhatsAppMessageId(messageId) {
      const row = await first<BookingDetailsRow>(
        "findBookingByWhatsAppMessageId",
        `${BOOKING_DETAILS_SELECT} where b.whatsapp_message_id = $1`,
        [messageId],
      );
      return row ? toBookingDetails(row) : null;
    },

    async listBookingsForUser(userId) {
      const rows = await query<BookingWithRoomRow>(
        "listBookingsForUser",
        `${BOOKING_WITH_ROOM_SELECT} where b.user_id = $1 order by b.start_time desc limit 200`,
        [userId],
      );
      return rows.map(toBookingWithRoom);
    },

    async listBookingsByStatus(status, limit = 100) {
      const order = status === "denied" ? "b.reviewed_at desc nulls last" : "b.start_time asc";
      const rows = await query<BookingDetailsRow>(
        "listBookingsByStatus",
        `${BOOKING_DETAILS_SELECT} where b.status = $1 order by ${order} limit $2`,
        [status, limit],
      );
      return rows.map(toBookingDetails);
    },

    async listBookingsBetween(from, to, statuses) {
      const rows = await query<BookingDetailsRow>(
        "listBookingsBetween",
        `${BOOKING_DETAILS_SELECT} where b.status = any($3::public.booking_status[]) and b.start_time < $2 and b.end_time > $1
         order by b.start_time limit 200`,
        [from, to, statuses],
      );
      return rows.map(toBookingDetails);
    },

    async getBookingDetails(id) {
      const row = await first<BookingDetailsRow>("getBookingDetails", `${BOOKING_DETAILS_SELECT} where b.id = $1`, [id]);
      return row ? toBookingDetails(row) : null;
    },

    async countBookingsByStatus() {
      const rows = await query<{ status: BookingStatus; n: number }>(
        "countBookingsByStatus",
        "select status, count(*)::int as n from public.bookings group by status",
      );
      const counts = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0])) as Record<BookingStatus, number>;
      for (const row of rows) counts[row.status] = row.n;
      return counts;
    },

    async claimBookingForReview(id, adminId, now, staleBefore) {
      const row = await first<BookingRow>(
        "claimBookingForReview",
        `update public.bookings set review_locked_at = $2, review_locked_by = $3
         where id = $1 and status = 'pending' and (review_locked_at is null or review_locked_at < $4)
         returning *`,
        [id, now, adminId, staleBefore],
      );
      return row ? toBooking(row) : null;
    },

    async releaseReviewClaim(id, adminId) {
      await query(
        "releaseReviewClaim",
        "update public.bookings set review_locked_at = null, review_locked_by = null where id = $1 and review_locked_by = $2",
        [id, adminId],
      );
    },

    async markApproved(id, adminId, ghlAppointmentId, now) {
      const row = await first<BookingRow>(
        "markApproved",
        `update public.bookings
         set status = 'approved', ghl_appointment_id = $3, reviewed_by = $2, reviewed_at = $4,
             review_locked_at = null, review_locked_by = null
         where id = $1 and status = 'pending' and review_locked_by = $2
         returning *`,
        [id, adminId, ghlAppointmentId, now],
      );
      return row ? toBooking(row) : null;
    },

    async markDenied(id, adminId, reason, now) {
      const row = await first<BookingRow>(
        "markDenied",
        `update public.bookings
         set status = 'denied', denial_reason = $3, reviewed_by = $2, reviewed_at = $4,
             review_locked_at = null, review_locked_by = null
         where id = $1 and status = 'pending' and review_locked_by = $2
         returning *`,
        [id, adminId, reason, now],
      );
      return row ? toBooking(row) : null;
    },

    async cancelOwnBooking(id) {
      const row = await first<BookingRow>("cancelOwnBooking", "select * from public.cancel_my_booking($1)", [id]);
      return row ? toBooking(row) : null;
    },

    async cancelApprovedBooking(id) {
      const row = await first<BookingRow>(
        "cancelApprovedBooking",
        "update public.bookings set status = 'cancelled' where id = $1 and status = 'approved' returning *",
        [id],
      );
      return row ? toBooking(row) : null;
    },

    async setCalendarSync(bookingId, eventId, error) {
      await query("setCalendarSync", "select public.set_booking_calendar_sync($1, $2, $3)", [bookingId, eventId, error]);
    },

    async listLiveAnnouncements() {
      const rows = await query<AnnouncementRow>(
        "listLiveAnnouncements",
        `select * from public.announcements
         where is_published and publish_at <= now() and (expires_at is null or expires_at > now())
         order by publish_at desc limit 24`,
      );
      return rows.map(toAnnouncement);
    },

    async listAllAnnouncements() {
      const rows = await query<AnnouncementRow>("listAllAnnouncements", "select * from public.announcements order by publish_at desc limit 200");
      return rows.map(toAnnouncement);
    },

    async getAnnouncement(id) {
      const row = await first<AnnouncementRow>("getAnnouncement", "select * from public.announcements where id = $1", [id]);
      return row ? toAnnouncement(row) : null;
    },

    async findAnnouncementByImagePath(path) {
      const row = await first<AnnouncementRow>("findAnnouncementByImagePath", "select * from public.announcements where image_path = $1 limit 1", [path]);
      return row ? toAnnouncement(row) : null;
    },

    async createAnnouncement(input, createdBy) {
      const row = await first<AnnouncementRow>(
        "createAnnouncement",
        `insert into public.announcements (internal_title, image_path, orientation, publish_at, expires_at, is_published, created_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [input.internalTitle, input.imagePath, input.orientation, input.publishAt, input.expiresAt, input.isPublished, createdBy],
      );
      return toAnnouncement(row!);
    },

    async updateAnnouncement(id, input) {
      const keys = (Object.keys(ANNOUNCEMENT_COLUMNS) as (keyof AnnouncementInput)[]).filter((key) => input[key] !== undefined);
      if (keys.length === 0) return repo.getAnnouncement(id);
      const sets = keys.map((key, i) => `${ANNOUNCEMENT_COLUMNS[key]} = $${i + 2}`).join(", ");
      const row = await first<AnnouncementRow>(
        "updateAnnouncement",
        `update public.announcements set ${sets} where id = $1 returning *`,
        [id, ...keys.map((key) => input[key])],
      );
      return row ? toAnnouncement(row) : null;
    },

    async deleteAnnouncement(id) {
      const row = await first<AnnouncementRow>("deleteAnnouncement", "delete from public.announcements where id = $1 returning *", [id]);
      return row ? toAnnouncement(row) : null;
    },
  };
  return repo;
}
