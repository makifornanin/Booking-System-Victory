"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { ConfigError } from "@/lib/env";
import { changeAccess, retryAccessNotification, type AccessResult } from "@/lib/services/accounts";
import { getAccountDeps } from "@/lib/services/deps";
import { failure, type ServiceResult } from "@/lib/services/result";

export type AccessActionState = ServiceResult<AccessResult> | null;

function revalidateUserViews(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
}

async function withConfig<T>(run: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[config] ${error.message}`);
    return failure("calendar_error", "GHL isn't configured on the server yet.");
  }
}

/** Approve / deny / revoke / restore from a form (reason field for deny and revoke). */
export async function changeAccessAction(_prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const input = {
    userId: formData.get("userId"),
    action: formData.get("action"),
    reason: typeof formData.get("reason") === "string" ? formData.get("reason") : undefined,
  };
  const result = await withConfig(async () => changeAccess(input, await getCurrentUser(), await getAccountDeps()));
  if (result.ok) revalidateUserViews(result.data.profile.id);
  return result;
}

export async function retryAccessNotificationAction(userId: string): Promise<ServiceResult> {
  const result = await withConfig(async () => retryAccessNotification({ userId }, await getCurrentUser(), await getAccountDeps()));
  revalidateUserViews(userId);
  return result;
}
