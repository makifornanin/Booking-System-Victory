import "server-only";
import { z } from "zod";
import { getGhlEnv } from "@/lib/env";
import { GHL_API_VERSION, ghlRequest } from "@/lib/ghl/client";
import { GhlError, isDuplicateContactError } from "@/lib/ghl/errors";
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

const contactSchema = z.object({ id: z.string().min(1), email: z.string().nullish(), phone: z.string().nullish(), tags: z.array(z.string()).nullish() }).loose();
const duplicateSearchSchema = z.object({ contact: contactSchema.nullish() }).loose();
const createdSchema = z.object({ contact: contactSchema }).loose();
const tagsSchema = z.object({ tags: z.array(z.string()).nullish() }).loose();

const toRef = (contact: z.infer<typeof contactSchema>): GhlContactRef => ({ id: contact.id, tags: contact.tags ?? [] });

function nameParts(fullName: string) {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return { firstName: firstName || undefined, lastName: rest.join(" ") || undefined, name: fullName.trim() || undefined };
}

async function searchDuplicate(query: { email: string } | { number: string }) {
  const { GHL_LOCATION_ID } = getGhlEnv();
  const { contact } = await ghlRequest("/contacts/search/duplicate", {
    version: GHL_API_VERSION.contacts,
    query: { locationId: GHL_LOCATION_ID, ...query },
    schema: duplicateSearchSchema,
  });
  return contact ?? null;
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const digits = (phone: string) => phone.replace(/\D/g, "");

export async function findContactByEmail(email: string): Promise<GhlContactRef | null> {
  const contact = await searchDuplicate({ email });
  // Duplicate search can match on other fields depending on location settings; only accept an email match.
  return contact && (!contact.email || sameEmail(contact.email, email)) ? toRef(contact) : null;
}

/**
 * Deterministic lookup: email first, then the E.164 phone. A phone match is only
 * used when that contact has no email or the same one; otherwise the phone belongs
 * to someone else, whose inbox must not get this person's notifications.
 */
async function lookupContact(person: GhlPerson): Promise<{ contact: GhlContactRef | null; phoneTaken: boolean }> {
  const byEmail = await findContactByEmail(person.email);
  if (byEmail || !person.phone) return { contact: byEmail, phoneTaken: false };
  const byPhone = await searchDuplicate({ number: person.phone });
  if (!byPhone || (byPhone.phone && digits(byPhone.phone) !== digits(person.phone))) return { contact: null, phoneTaken: false };
  if (byPhone.email && !sameEmail(byPhone.email, person.email)) return { contact: null, phoneTaken: true };
  return { contact: toRef(byPhone), phoneTaken: false };
}

async function createContact(person: GhlPerson, phone: string | undefined): Promise<GhlContactRef> {
  const { GHL_LOCATION_ID } = getGhlEnv();
  const { contact } = await ghlRequest("/contacts/", {
    method: "POST",
    version: GHL_API_VERSION.contacts,
    body: { locationId: GHL_LOCATION_ID, email: person.email, ...nameParts(person.fullName), phone, source: "Victory room booking" },
    schema: createdSchema,
  });
  return toRef(contact);
}

/**
 * The one place a GHL contact is resolved: by email, then phone, creating it only
 * when neither exists. If GHL still rejects the create (a concurrent create, or
 * its own duplicate matching), the lookup runs again instead of failing.
 */
export async function findOrCreateContact(person: GhlPerson): Promise<GhlContactRef> {
  const found = await lookupContact(person);
  if (found.contact) return found.contact;

  // A phone already held by another person's contact is left off, so this email still gets its own contact.
  const phone = found.phoneTaken ? undefined : (person.phone ?? undefined);
  try {
    return await createContact(person, phone);
  } catch (error) {
    if (!(error instanceof GhlError && error.kind === "rejected")) throw error;
    const again = await lookupContact(person);
    if (again.contact) return again.contact;
    if (phone && isDuplicateContactError(error)) return createContact(person, undefined);
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
  const put = (payload: Record<string, unknown>) =>
    ghlRequest(`/contacts/${encodeURIComponent(contactId)}`, { method: "PUT", version: GHL_API_VERSION.contacts, body: payload, schema: z.unknown() });
  try {
    await put(body);
  } catch (error) {
    // The phone already belongs to another contact: keep this contact's phone and update the rest.
    if (!isDuplicateContactError(error) || !("phone" in body)) throw error;
    const rest = { ...body };
    delete rest.phone;
    if (Object.keys(rest).length > 0) await put(rest);
  }
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
