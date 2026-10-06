"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { getGoogleCalendar } from "@/lib/google/gateway";
import { failure, success, type ServiceResult } from "@/lib/services/result";

/** Revokes the app's Google access and deletes the stored token. Existing events stay in the calendar. */
export async function disconnectGoogleAction(): Promise<ServiceResult> {
  const user = await getCurrentUser();
  if (!user) return failure("unauthenticated", "Your session has expired. Please sign in again.");
  try {
    await (await getGoogleCalendar()).disconnect(user.id);
  } catch (error) {
    console.error("[google] disconnect failed:", error instanceof Error ? error.message : error);
    return failure("unknown", "Google Calendar couldn't be disconnected. Please try again.");
  }
  revalidatePath("/account");
  return success(undefined, "Google Calendar disconnected.");
}
