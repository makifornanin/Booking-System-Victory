import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findOrCreateContact, updateContact } from "@/lib/ghl/contacts";
import { GhlError } from "@/lib/ghl/errors";

interface Contact {
  id: string;
  email: string | null;
  phone: string | null;
}

const DUPLICATE = "This location does not allow duplicated contacts.";

/**
 * A stand-in for the GHL contacts API behind `fetch`. Like a location with
 * duplicate prevention on, it refuses a second contact with the same email or phone.
 */
function ghlApi(initial: Contact[], options: { missedSearches?: number; down?: boolean } = {}) {
  const contacts = initial.map((c) => ({ ...c }));
  const posts: Record<string, unknown>[] = [];
  const puts: Record<string, unknown>[] = [];
  let missedSearches = options.missedSearches ?? 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  vi.stubGlobal("fetch", async (input: URL | string, init?: RequestInit) => {
    if (options.down) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url.pathname === "/contacts/search/duplicate") {
      const email = url.searchParams.get("email")?.toLowerCase();
      const number = url.searchParams.get("number");
      if (missedSearches > 0) {
        missedSearches--;
        return json(200, { contact: null });
      }
      return json(200, { contact: contacts.find((c) => (email && c.email === email) || (number && c.phone === number)) ?? null });
    }
    if (url.pathname === "/contacts/" && method === "POST") {
      posts.push(body);
      if (contacts.some((c) => c.email === body.email || (body.phone && c.phone === body.phone))) return json(400, { statusCode: 400, message: DUPLICATE });
      const created = { id: `new-${contacts.length + 1}`, email: String(body.email), phone: (body.phone as string | undefined) ?? null };
      contacts.push(created);
      return json(201, { contact: created });
    }
    const contactId = url.pathname.match(/^\/contacts\/([^/]+)$/)?.[1];
    if (contactId && method === "PUT") {
      puts.push(body);
      const target = contacts.find((c) => c.id === contactId);
      if (!target) return json(404, { message: "Contact not found" });
      if (body.phone && contacts.some((c) => c.id !== contactId && c.phone === body.phone)) return json(400, { message: DUPLICATE });
      return json(200, { contact: target });
    }
    return json(404, { message: "Not found" });
  });
  return { contacts, posts, puts };
}

const person = (email: string, phone: string | null = "+639171112222") => ({ email, fullName: "Grace Santos", phone });

beforeEach(() => {
  vi.stubEnv("GHL_PRIVATE_INTEGRATION_TOKEN", "test-token-0000000000");
  vi.stubEnv("GHL_LOCATION_ID", "location-1");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GHL contact resolution", () => {
  it("uses the existing contact found by email", async () => {
    const api = ghlApi([{ id: "by-email", email: "grace@example.com", phone: "+639171112222" }]);
    expect(await findOrCreateContact(person("Grace@Example.com"))).toMatchObject({ id: "by-email" });
    expect(api.posts).toHaveLength(0);
  });

  it("uses the existing contact found by phone when it has no other email", async () => {
    const api = ghlApi([{ id: "by-phone", email: null, phone: "+639171112222" }]);
    expect(await findOrCreateContact(person("grace@example.com"))).toMatchObject({ id: "by-phone" });
    expect(api.posts).toHaveLength(0);
  });

  it("never reuses someone else's contact that shares the phone; creates one without the phone", async () => {
    const api = ghlApi([{ id: "office", email: "office@victory.example", phone: "+639171112222" }]);
    const contact = await findOrCreateContact(person("grace@example.com"));
    expect(contact.id).not.toBe("office");
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]).not.toHaveProperty("phone");
    expect(api.contacts).toHaveLength(2);
  });

  it("recovers from a duplicate-contact error by looking the contact up again", async () => {
    // The first lookup misses (e.g. GHL's search index lagging), so the create is refused as a duplicate.
    const api = ghlApi([{ id: "existing", email: "grace@example.com", phone: "+639171112222" }], { missedSearches: 2 });
    expect(await findOrCreateContact(person("grace@example.com"))).toMatchObject({ id: "existing" });
    expect(api.posts).toHaveLength(1);
    expect(api.contacts).toHaveLength(1);
  });

  it("creates a contact only when neither the email nor the phone exists", async () => {
    const api = ghlApi([]);
    expect((await findOrCreateContact(person("new@example.com"))).id).toBe("new-1");
    expect(api.posts[0]).toMatchObject({ email: "new@example.com", phone: "+639171112222" });
  });

  it("fails clearly when GHL is completely unavailable", async () => {
    ghlApi([], { down: true });
    await expect(findOrCreateContact(person("grace@example.com"))).rejects.toMatchObject({ kind: "unavailable" });
    await expect(findOrCreateContact(person("grace@example.com"))).rejects.toBeInstanceOf(GhlError);
  });

  it("still updates the name when the phone already belongs to another contact", async () => {
    const api = ghlApi([
      { id: "grace", email: "grace@example.com", phone: "+639170000001" },
      { id: "office", email: "office@victory.example", phone: "+639171112222" },
    ]);
    await updateContact("grace", { person: person("grace@example.com") });
    expect(api.puts).toHaveLength(2);
    expect(api.puts[0]).toHaveProperty("phone");
    expect(api.puts[1]).toMatchObject({ firstName: "Grace", lastName: "Santos" });
    expect(api.puts[1]).not.toHaveProperty("phone");
  });
});
