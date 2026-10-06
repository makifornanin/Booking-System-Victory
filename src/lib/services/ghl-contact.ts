import type { Repository } from "@/lib/data/repository";
import { GhlError } from "@/lib/ghl/errors";
import type { CalendarGateway, ContactFieldValues, GhlContactRef } from "@/lib/ghl/gateway";

export interface ContactOwner {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  ghlContactId: string | null;
}

/**
 * Updates the person's GHL contact, reusing the cached contact id so GHL isn't
 * searched on every approval. If the cached contact is gone (deleted or merged
 * in GHL), falls back to find-or-create by email and caches the new id.
 */
export async function syncGhlContact(
  calendar: CalendarGateway,
  repo: Repository,
  owner: ContactOwner,
  update: { includePerson?: boolean; fields?: ContactFieldValues },
): Promise<GhlContactRef> {
  const person = { email: owner.email, fullName: owner.fullName, phone: owner.phone };
  const payload = { person: update.includePerson ? person : undefined, fields: update.fields };

  if (owner.ghlContactId) {
    try {
      await calendar.updateContact(owner.ghlContactId, payload);
      return { id: owner.ghlContactId, tags: null };
    } catch (error) {
      const stale = error instanceof GhlError && (error.kind === "not_found" || error.kind === "rejected");
      if (!stale) throw error;
    }
  }

  const contact = await calendar.findOrCreateContact(person);
  await calendar.updateContact(contact.id, payload);
  if (contact.id !== owner.ghlContactId) {
    await repo.saveGhlContactId(owner.id, contact.id).catch((error: unknown) => {
      console.error("[ghl] could not cache contact id", error instanceof Error ? error.message : error);
    });
  }
  return contact;
}
