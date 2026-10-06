import { z } from "zod";
import type { SessionUser } from "@/lib/auth/provider";
import { RepositoryError, type Repository } from "@/lib/data/repository";
import type { AccessChange, AccessStatus, Profile } from "@/lib/data/types";
import { ghlUserMessage } from "@/lib/ghl/errors";
import { ACCOUNT_TAGS, type CalendarGateway, type ContactFieldValues } from "@/lib/ghl/gateway";
import { syncGhlContact } from "@/lib/services/ghl-contact";
import { failure, fieldErrorsFrom, success, type ServiceResult } from "@/lib/services/result";

export interface AccountDeps {
  repo: Repository;
  calendar: CalendarGateway;
}

const ACTIONS = {
  approve: { status: "active", change: "approved" },
  deny: { status: "denied", change: "denied" },
  revoke: { status: "revoked", change: "revoked" },
  restore: { status: "active", change: "restored" },
} as const satisfies Record<string, { status: AccessStatus; change: AccessChange }>;

export type AccessAction = keyof typeof ACTIONS;

export const accessActionSchema = z
  .object({
    userId: z.uuid({ error: "Unknown user." }),
    action: z.enum(["approve", "deny", "revoke", "restore"]),
    reason: z.string().trim().max(500, { error: "Keep the reason under 500 characters." }).optional(),
  })
  .refine((data) => !(data.action === "deny" || data.action === "revoke") || (data.reason?.length ?? 0) >= 3, {
    error: "Enter a reason. The person will see it in the email.",
    path: ["reason"],
  });

const STATUS_LABEL: Record<AccessChange, string> = {
  approved: "Access approved",
  denied: "Request denied",
  revoked: "Access revoked",
  restored: "Access restored",
};

export interface AccessResult {
  profile: Profile;
  notificationFailed: boolean;
}

function adminGuard(actor: SessionUser | null): ServiceResult<never> | null {
  if (!actor) return failure("unauthenticated", "Your session has expired. Please sign in again.");
  if (actor.accessStatus !== "active" || actor.role !== "admin") return failure("forbidden", "Only admins can manage account access.");
  return null;
}

/**
 * Sends the GHL account email: updates the contact (name, phone and the access
 * reason) and adds the workflow tag. Returns an error message instead of throwing.
 */
async function notify(profile: Profile, change: AccessChange, reason: string | null, deps: AccountDeps): Promise<string | null> {
  if (!profile.email) return "This person has no email address on file.";
  const fields: ContactFieldValues = { accountStatus: profile.accessStatus };
  if (change === "denied" || change === "revoked") fields.accountAccessReason = reason ?? "";
  try {
    const contact = await syncGhlContact(deps.calendar, deps.repo, profile, { includePerson: true, fields });
    await deps.calendar.addTriggerTag(contact, ACCOUNT_TAGS[change]);
    return null;
  } catch (error) {
    console.error(`[accounts] notification failed for ${profile.id}:`, error instanceof Error ? error.message : error);
    return ghlUserMessage(error);
  }
}

async function recordNotification(deps: AccountDeps, userId: string, error: string | null) {
  await deps.repo.setAccessNotificationResult(userId, error).catch((dbError: unknown) => {
    console.error("[accounts] could not record notification result", dbError instanceof Error ? dbError.message : dbError);
  });
}

/** Approve / deny / revoke / restore. The access decision stands even if the email fails. */
export async function changeAccess(rawInput: unknown, actor: SessionUser | null, deps: AccountDeps): Promise<ServiceResult<AccessResult>> {
  const denied = adminGuard(actor);
  if (denied) return denied;

  const parsed = accessActionSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Please check the highlighted fields.", fieldErrorsFrom(parsed.error.issues));
  const { userId, action } = parsed.data;
  const { status, change } = ACTIONS[action];
  const reason = action === "deny" || action === "revoke" ? parsed.data.reason ?? null : null;

  let profile: Profile | null;
  try {
    profile = await deps.repo.setUserAccess(userId, status, reason);
  } catch (error) {
    if (error instanceof RepositoryError && (error.code === "invalid" || error.code === "forbidden")) return failure(error.code, error.message);
    console.error("[accounts] access change failed", error instanceof Error ? error.message : error);
    return failure("unknown", "The access change couldn't be saved. Please try again.");
  }
  if (!profile) return failure("not_found", "We couldn't find that user.");

  const notificationError = await notify(profile, change, reason, deps);
  await recordNotification(deps, userId, notificationError);

  return success(
    { profile: { ...profile, accessNotificationError: notificationError }, notificationFailed: notificationError !== null },
    notificationError ? `${STATUS_LABEL[change]}, but the email notification failed: ${notificationError}` : `${STATUS_LABEL[change]}. GHL will email ${profile.fullName}.`,
  );
}

/** Re-sends the email for the user's latest access change. */
export async function retryAccessNotification(rawInput: unknown, actor: SessionUser | null, deps: AccountDeps): Promise<ServiceResult> {
  const denied = adminGuard(actor);
  if (denied) return denied;
  const parsed = z.object({ userId: z.uuid() }).safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown user.");

  const [profile, events] = await Promise.all([deps.repo.getProfile(parsed.data.userId), deps.repo.listAccessEvents(parsed.data.userId)]);
  const latest = events[0];
  if (!profile || !latest) return failure("not_found", "There's no access change to notify about.");

  const notificationError = await notify(profile, latest.change, latest.reason, deps);
  await recordNotification(deps, profile.id, notificationError);
  return notificationError ? failure("calendar_error", `The notification failed again: ${notificationError}`) : success(undefined, "Notification sent.");
}
