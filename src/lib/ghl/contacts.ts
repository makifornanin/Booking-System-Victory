import "server-only";
import { z } from "zod";
import { getGhlEnv } from "@/lib/env";
import { GHL_API_VERSION, ghlRequest } from "@/lib/ghl/client";
import { GhlError } from "@/lib/ghl/errors";
import { toCustomFieldPayload, type ContactFieldValues } from "@/lib/ghl/fields";

export interface GhlPerson {
  email: string;
  fullName: string;
  phone?: string | null;
}

export interface GhlContactRef {
  id: string;
  /** Current tags, or null when the contact was taken from the cached id without a lookup. */
  tags: string[] | null;
}

const contactSchema = z.object({ id: z.string().min(1), email: z.string().nullish(), tags: z.array(z.string()).nullish() }).loose();
const duplicateSearchSchema = z.object({ contact: contactSchema.nullish() }).loose();
const createdSchema = z.object({ contact: contactSchema }).loose();
const tagsSchema = z.object({ tags: z.array(z.string()).nullish() }).loose();

const toRef = (contact: z.infer<typeof contactSchema>): GhlContactRef => ({ id: contact.id, tags: contact.tags ?? [] });

function nameParts(fullName: string) {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return { firstName: firstName || undefined, lastName: rest.join(" ") || undefined, name: fullName.trim() || undefined };
}

export async function findContactByEmail(email: string): Promise<GhlContactRef | null> {
  const { GHL_LOCATION_ID } = getGhlEnv();
  const { contact } = await ghlRequest("/contacts/search/duplicate", {
    version: GHL_API_VERSION.contacts,
    query: { locationId: GHL_LOCATION_ID, email },
    schema: duplicateSearchSchema,
  });
  if (!contact) return null;
  // Duplicate search can match on other fields depending on location settings; only accept an email match.
  if (contact.email && contact.email.toLowerCase() !== email.toLowerCase()) return null;
  return toRef(contact);
}

/** Finds the contact by email, creating it only when none exists (no duplicates). */
export async function findOrCreateContact(person: GhlPerson): Promise<GhlContactRef> {
  const existing = await findContactByEmail(person.email);
  if (existing) return existing;

  const { GHL_LOCATION_ID } = getGhlEnv();
  try {
    const { contact } = await ghlRequest("/contacts/", {
      method: "POST",
      version: GHL_API_VERSION.contacts,
      body: {
        locationId: GHL_LOCATION_ID,
        email: person.email,
        ...nameParts(person.fullName),
        phone: person.phone ?? undefined,
        source: "Victory room booking",
      },
      schema: createdSchema,
    });
    return toRef(contact);
  } catch (error) {
    // A concurrent request may have created the contact first; use it instead of failing.
    if (error instanceof GhlError && error.kind === "rejected") {
      const created = await findContactByEmail(person.email);
      if (created) return created;
    }
    throw error;
  }
}

/** One PUT that updates name/phone and/or custom fields. Other contact data is left untouched. */
export async function updateContact(contactId: string, update: { person?: GhlPerson; fields?: ContactFieldValues }): Promise<void> {
  const body: Record<string, unknown> = {};
  if (update.person) {
    Object.assign(body, nameParts(update.person.fullName));
    if (update.person.phone) body.phone = update.person.phone;
  }
  if (update.fields && Object.keys(update.fields).length > 0) {
    body.customFields = await toCustomFieldPayload(update.fields);
  }
  if (Object.keys(body).length === 0) return;
  await ghlRequest(`/contacts/${encodeURIComponent(contactId)}`, {
    method: "PUT",
    version: GHL_API_VERSION.contacts,
    body,
    schema: z.unknown(),
  });
}

/** Removes a tag if the contact may have it (unknown tags are removed to be safe). */
export async function removeTag(contact: GhlContactRef, tag: string): Promise<void> {
  const mayHaveTag = contact.tags === null || contact.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase());
  if (!mayHaveTag) return;
  await ghlRequest(`/contacts/${encodeURIComponent(contact.id)}/tags`, { method: "DELETE", version: GHL_API_VERSION.contacts, body: { tags: [tag] }, schema: tagsSchema });
}

/**
 * Adds a workflow trigger tag. If the contact might still have it from an earlier
 * run (or its tags are unknown), the tag is removed first so "Tag Added" fires again.
 */
export async function addTriggerTag(contact: GhlContactRef, tag: string): Promise<void> {
  const path = `/contacts/${encodeURIComponent(contact.id)}/tags`;
  const mayHaveTag = contact.tags === null || contact.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase());
  if (mayHaveTag) {
    await ghlRequest(path, { method: "DELETE", version: GHL_API_VERSION.contacts, body: { tags: [tag] }, schema: tagsSchema });
  }
  await ghlRequest(path, { method: "POST", version: GHL_API_VERSION.contacts, body: { tags: [tag] }, schema: tagsSchema });
}
