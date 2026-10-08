"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { ConfigError } from "@/lib/env";
import { getBookingDeps } from "@/lib/services/deps";
import {
  approveReschedule,
  denyReschedule,
  requestReschedule,
  retryRescheduleEmail,
  withdrawReschedule,
  type RescheduleApprovalResult,
} from "@/lib/services/reschedules";
import { failure, type ServiceResult } from "@/lib/services/result";

export type RescheduleActionState = ServiceResult<{ requestId: string }> | null;
export type RescheduleReviewState = ServiceResult<{ notificationFailed: boolean }> | null;

async function withConfig<T>(run: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[config] ${error.message}`);
    return failure("calendar_error", "A required integration isn't configured on the server yet. Please contact the church office.");
  }
}

function revalidateViews(bookingId?: string, requestId?: string) {
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/admin/bookings");
  if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
  if (requestId) revalidatePath(`/admin/bookings/reschedule/${requestId}`);
}

/** Only the booking id and the new date/time are read from the form. */
export async function requestRescheduleAction(_prev: RescheduleActionState, formData: FormData): Promise<RescheduleActionState> {
  const input = Object.fromEntries(["bookingId", "date", "startTime", "endTime"].map((key) => [key, formData.get(key) ?? ""]));
  const result = await withConfig(async () => requestReschedule(input, await getCurrentUser(), await getBookingDeps()));
  if (result.ok) revalidateViews(String(input.bookingId), result.data.requestId);
  return result;
}

export async function withdrawRescheduleAction(requestId: string, bookingId: string): Promise<ServiceResult> {
  const result = await withConfig(async () => withdrawReschedule({ requestId }, await getCurrentUser(), await getBookingDeps()));
  if (result.ok) revalidateViews(bookingId, requestId);
  return result;
}

export async function approveRescheduleAction(requestId: string): Promise<ServiceResult<RescheduleApprovalResult>> {
  const result = await withConfig(async () => approveReschedule({ requestId }, await getCurrentUser(), await getBookingDeps()));
  revalidateViews(undefined, requestId);
  return result;
}

export async function denyRescheduleAction(_prev: RescheduleReviewState, formData: FormData): Promise<RescheduleReviewState> {
  const requestId = String(formData.get("requestId") ?? "");
  const result = await withConfig(async () => denyReschedule({ requestId, reason: formData.get("reason") ?? "" }, await getCurrentUser(), await getBookingDeps()));
  revalidateViews(undefined, requestId);
  return result;
}

export async function retryRescheduleEmailAction(requestId: string): Promise<ServiceResult> {
  const result = await withConfig(async () => retryRescheduleEmail({ requestId }, await getCurrentUser(), await getBookingDeps()));
  revalidateViews(undefined, requestId);
  return result;
}
