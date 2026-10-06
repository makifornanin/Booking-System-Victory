import "server-only";
import { after } from "next/server";
import { getDataMode } from "@/lib/env";
import { getCalendarGateway } from "@/lib/ghl/gateway";
import type { ContactOwner } from "@/lib/services/ghl-contact";
import { notifyPendingAccount } from "@/lib/services/accounts";

/** Server-only writes for a brand-new (pending) account, which can't use admin-only functions. */
async function profileWriter() {
  if (getDataMode() === "demo") {
    const { getDemoState } = await import("@/lib/demo/store");
    const user = (id: string) => getDemoState().users.find((u) => u.id === id);
    return {
      saveGhlContactId: async (id: string, contactId: string) => {
        const found = user(id);
        if (found) found.ghlContactId = contactId;
      },
      recordError: async (id: string, error: string | null) => {
        const found = user(id);
        if (found) found.accessNotificationError = error;
      },
    };
  }
  const { systemQuery } = await import("@/lib/db/client");
  return {
    saveGhlContactId: async (id: string, contactId: string) => {
      await systemQuery("update public.profiles set ghl_contact_id = $2 where id = $1", [id, contactId]);
    },
    recordError: async (id: string, error: string | null) => {
      await systemQuery("update public.profiles set access_notification_error = $2 where id = $1", [id, error]);
    },
  };
}

/**
 * Queues the GHL "New Account Pending Review" sync for a fresh sign-up. It runs
 * after the response is sent, so registration never waits for (or fails
 * because of) GHL. A failure is logged and stored on the profile, where admins
 * see it on the user page and can retry.
 */
export async function queuePendingReviewNotification(owner: ContactOwner): Promise<void> {
  let calendar;
  try {
    calendar = await getCalendarGateway();
  } catch (error) {
    console.error("[accounts] GHL isn't configured; skipping the pending-review notification:", error instanceof Error ? error.message : error);
    return;
  }
  const writer = await profileWriter();
  after(async () => {
    const error = await notifyPendingAccount(owner, { calendar, saveGhlContactId: writer.saveGhlContactId });
    await writer.recordError(owner.id, error ? `Pending-review alert: ${error}` : null).catch((dbError: unknown) => {
      console.error("[accounts] could not record the pending-review result:", dbError instanceof Error ? dbError.message : dbError);
    });
  });
}
