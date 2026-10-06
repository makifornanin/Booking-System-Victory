"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { recordStatusNotification } from "@/lib/bot/notifier";
import { buildStatusPayload, deliverStatusWebhook } from "@/lib/bot/status-webhook";
import { getRepository } from "@/lib/data";
import { getStatusWebhookConfig } from "@/lib/env";
import { ConfigError } from "@/lib/env";
import { approveBooking, cancelBooking, createBookingRequest, denyBooking, type ApprovalResult } from "@/lib/services/bookings";
import { retryCalendarSync } from "@/lib/services/calendar-sync";
import { retryStatusNotification } from "@/lib/services/status-notifications";
import { getBookingDeps, getCalendarSyncDeps } from "@/lib/services/deps";
import { failure, type ServiceResult } from "@/lib/services/result";

export type BookingActionState = ServiceResult<{ bookingId: string }> | null;
export type ReviewActionState = ServiceResult | null;

const BOOKING_FIELDS = ["roomId", "date", "startTime", "endTime", "eventName", "eventType", "attendeeCount", "purpose"] as const;

/** Missing server configuration becomes a clear message instead of an unhandled error. */
async function withConfig<T>(run: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[config] ${error.message}`);
    return failure("calendar_error", "A required integration isn't configured on the server yet. Please contact the church office.");
  }
}

/** Member-facing pages that show a booking's status. */
function revalidateMemberViews() {
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
}

function revalidateAdminViews(bookingId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/bookings");
  if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
}

/** Only whitelisted fields are read; status, user id and review fields can't be injected. */
export async function requestBookingAction(_prev: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const input = Object.fromEntries(BOOKING_FIELDS.map((key) => [key, formData.get(key) ?? ""]));
  const result = await withConfig(async () => createBookingRequest(input, await getCurrentUser(), await getBookingDeps()));
  if (result.ok) {
    revalidateMemberViews();
    revalidateAdminViews();
  }
  return result;
}

export async function cancelBookingAction(bookingId: string): Promise<ServiceResult<{ calendarCleanupFailed: boolean }>> {
  const result = await withConfig(async () => cancelBooking({ bookingId }, await getCurrentUser(), await getBookingDeps()));
  if (result.ok) {
    revalidateMemberViews();
    revalidateAdminViews(bookingId);
  }
  return result;
}

export async function approveBookingAction(bookingId: string): Promise<ServiceResult<ApprovalResult>> {
  const result = await withConfig(async () => approveBooking({ bookingId }, await getCurrentUser(), await getBookingDeps()));
  revalidateAdminViews(bookingId);
  if (result.ok) revalidateMemberViews();
  return result;
}

export async function denyBookingAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const input = { bookingId: formData.get("bookingId"), reason: formData.get("reason") ?? "" };
  const result = await withConfig(async () => denyBooking(input, await getCurrentUser(), await getBookingDeps()));
  if (result.ok) {
    revalidateAdminViews(String(input.bookingId));
    revalidateMemberViews();
  }
  return result;
}

export async function retryCalendarSyncAction(bookingId: string): Promise<ServiceResult> {
  const result = await withConfig(async () => retryCalendarSync({ bookingId }, await getCurrentUser(), await getCalendarSyncDeps()));
  if (result.ok) {
    revalidateMemberViews();
    revalidatePath(`/admin/bookings/${bookingId}`);
  }
  return result.ok ? { ok: true, data: undefined, message: result.message } : result;
}

/** Admin: resend the n8n/WhatsApp status notification for a WhatsApp booking. */
export async function retryStatusNotificationAction(bookingId: string): Promise<ServiceResult> {
  const config = getStatusWebhookConfig();
  const result = await retryStatusNotification({ bookingId }, await getCurrentUser(), {
    repo: await getRepository(),
    deliver: config ? (booking, status) => deliverStatusWebhook(buildStatusPayload(booking, status), config) : null,
    record: recordStatusNotification,
  });
  revalidateAdminViews(bookingId);
  return result;
}
