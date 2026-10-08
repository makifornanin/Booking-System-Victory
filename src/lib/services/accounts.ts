import { z } from "zod";
import type { SessionUser } from "@/lib/auth/provider";
import { RepositoryError, type Repository } from "@/lib/data/repository";
import type { AccessChange, AccessEvent, AccessStatus, Profile } from "@/lib/data/types";
import { ghlUserMessage } from "@/lib/ghl/errors";
import { ACCOUNT_TAGS, PENDING_ACCOUNT_TAG, type CalendarGateway, type ContactFieldValues } from "@/lib/ghl/gateway";
import { syncGhlContact, type ContactOwner } from "@/lib/services/ghl-contact";
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
    // The account has been reviewed, so it no longer waits in the "pending review" workflow.
    if (change === "approved" || change === "denied") await deps.calendar.removeTag(contact, PENDING_ACCOUNT_TAG);
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

export interface PendingAccountDeps {
  calendar: CalendarGateway;
  saveGhlContactId: (userId: string, contactId: string) => Promise<void>;
}

/**
 * New sign-up: finds or creates the member's GHL contact (name, email, phone),
 * then re-adds the "pending review" tag so the internal admin notification
 * workflow runs. Returns an error message instead of throwing: registration
 * never depends on GHL.
 */
export async function notifyPendingAccount(owner: ContactOwner, deps: PendingAccountDeps): Promise<string | null> {
  if (!owner.email) return "This person has no email address on file.";
  try {
    const contact = await syncGhlContact(deps.calendar, { saveGhlContactId: deps.saveGhlContactId }, owner, {
      includePerson: true,
      fields: { accountStatus: "pending" },
    });
    await deps.calendar.addTriggerTag(contact, PENDING_ACCOUNT_TAG);
    return null;
  } catch (error) {
    console.error(`[accounts] pending-review notification failed for ${owner.id}:`, error instanceof Error ? error.message : error);
    return ghlUserMessage(error);
  }
}

/** Re-sends the email for the user's latest access change (or the pending-review alert for a new account). */
export async function retryAccessNotification(rawInput: unknown, actor: SessionUser | null, deps: AccountDeps): Promise<ServiceResult> {
  const denied = adminGuard(actor);
  if (denied) return denied;
  const parsed = z.object({ userId: z.uuid() }).safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown user.");

  const [profile, events] = await Promise.all([deps.repo.getProfile(parsed.data.userId), deps.repo.listAccessEvents(parsed.data.userId)]);
  // Role changes send no email; the latest access decision is what gets re-sent.
  const latest = events.find((event): event is AccessEvent & { change: AccessChange } => event.change in ACCOUNT_TAGS);
  if (!profile) return failure("not_found", "We couldn't find that user.");
  if (!latest && profile.accessStatus !== "pending") return failure("not_found", "There's no access change to notify about.");

  const notificationError = latest
    ? await notify(profile, latest.change, latest.reason, deps)
    : await notifyPendingAccount(profile, { calendar: deps.calendar, saveGhlContactId: (userId, contactId) => deps.repo.saveGhlContactId(userId, contactId) });
  await recordNotification(deps, profile.id, notificationError);
  return notificationError ? failure("calendar_error", `The notification failed again: ${notificationError}`) : success(undefined, "Notification sent.");
}

const roleChangeSchema = z.object({ userId: z.uuid(), role: z.enum(["user", "admin"]) });

/**
 * Makes an active member an admin, or removes another admin's admin access. The
 * database enforces the rules (active admins only, never your own role, active
 * accounts only, at least one active admin) and records the change in the
 * access history. Roles are read from the database on every request, so the
 * change applies on the person's next page load.
 */
export async function changeRole(rawInput: unknown, actor: SessionUser | null, deps: Pick<AccountDeps, "repo">): Promise<ServiceResult<{ profile: Profile }>> {
  if (!actor) return failure("unauthenticated", "Your session has expired. Please sign in again.");
  if (actor.accessStatus !== "active" || actor.role !== "admin") return failure("forbidden", "Only admins can change roles.");
  const parsed = roleChangeSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown user or role.");
  const { userId, role } = parsed.data;

  let profile: Profile | null;
  try {
    profile = await deps.repo.setUserRole(userId, role);
  } catch (error) {
    if (error instanceof RepositoryError && (error.code === "invalid" || error.code === "forbidden")) return failure(error.code, error.message);
    console.error("[accounts] role change failed", error instanceof Error ? error.message : error);
    return failure("unknown", "The role change couldn't be saved. Please try again.");
  }
  if (!profile) return failure("not_found", "We couldn't find that user.");
  const name = profile.fullName || profile.email;
  return success({ profile }, role === "admin" ? `${name} is now an admin.` : `${name} no longer has admin access.`);
}
