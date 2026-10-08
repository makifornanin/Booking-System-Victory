// Read-only health check for the production integrations. Prints results only,
// never secret values. Usage: npm run check:integrations
import { createClient } from "./db-client.mjs";

const GHL = "https://services.leadconnectorhq.com";
const env = process.env;
let failures = 0;

const ok = (label, detail = "") => console.log(`PASS  ${label}${detail ? `  (${detail})` : ""}`);
const fail = (label, detail = "") => {
  failures++;
  console.log(`FAIL  ${label}${detail ? `  (${detail})` : ""}`);
};
const skip = (label, detail) => console.log(`SKIP  ${label}  (${detail})`);
const warn = (label, detail) => console.log(`WARN  ${label}  (${detail})`);

async function check(label, fn) {
  try {
    const detail = await fn();
    ok(label, detail);
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

async function ghl(path, version) {
  const response = await fetch(`${GHL}${path}`, {
    headers: { Authorization: `Bearer ${env.GHL_PRIVATE_INTEGRATION_TOKEN}`, Version: version, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}${body?.message ? `: ${[].concat(body.message).join("; ")}` : ""}`);
  return body;
}

// --- Neon Postgres --------------------------------------------------------
const db = createClient();
await check("Neon Postgres connection", async () => {
  await db.connect();
  const { rows } = await db.query("select current_setting('server_version') as v");
  return `Postgres ${rows[0].v.split(" ")[0]}`;
});
await check("Schema migrated", async () => {
  const { rows } = await db.query("select count(*)::int as n from public.schema_migrations");
  return `${rows[0].n} migrations applied`;
});
await check("app_member role switch + RLS", async () => {
  await db.query("begin");
  await db.query("set local role app_member");
  const anon = await db.query("select count(*)::int as n from public.bookings");
  await db.query("rollback");
  if (anon.rows[0].n !== 0) throw new Error("RLS did not hide bookings from a session with no user");
  return "no user → 0 bookings visible";
});
const rooms = await db
  .query("select name, slug, ghl_calendar_id from public.rooms where is_active order by display_order")
  .then((r) => r.rows)
  .catch(() => []);
await check("Rooms linked to GHL calendars", async () => {
  const missing = rooms.filter((r) => !r.ghl_calendar_id).map((r) => r.name);
  if (rooms.length !== 5) throw new Error(`expected 5 active rooms, found ${rooms.length}`);
  if (missing.length) throw new Error(`no calendar ID: ${missing.join(", ")}`);
  return "5/5";
});
await check("Admin account", async () => {
  const { rows } = await db.query("select count(*)::int as n from public.profiles where role = 'admin' and access_status = 'active'");
  if (rows[0].n === 0) throw new Error("no active admin yet — sign up with ADMIN_EMAIL, then run npm run db:bootstrap-admin");
  return `${rows[0].n} active admin(s)`;
});
// The WhatsApp assistant identifies members by phone, so one number must map to one account.
await db
  .query("select count(*)::int as n from (select phone from public.profiles where phone is not null group by phone having count(*) > 1) d")
  .then(({ rows }) => {
    if (rows[0].n === 0) ok("Unique phone numbers (WhatsApp identity)", "each number belongs to one account");
    else warn("Unique phone numbers (WhatsApp identity)", `${rows[0].n} number(s) shared by several accounts; the bot answers PHONE_AMBIGUOUS for them until one account's number is changed`);
  })
  .catch((error) => fail("Unique phone numbers (WhatsApp identity)", error.message));
// A member whose GHL contact is known, to confirm phone lookups find it (nothing is printed).
const knownContact = await db
  .query("select phone, ghl_contact_id from public.profiles where phone is not null and ghl_contact_id is not null order by created_at limit 1")
  .then((r) => r.rows[0] ?? null)
  .catch(() => null);
await db.end().catch(() => undefined);

// --- Neon Auth ------------------------------------------------------------
await check("Neon Auth reachable", async () => {
  if (!env.NEON_AUTH_BASE_URL) throw new Error("NEON_AUTH_BASE_URL is not set");
  const response = await fetch(`${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/ok`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return "auth service responded";
});

// --- Object storage -------------------------------------------------------
if (env.AWS_ENDPOINT_URL_S3 && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
  await check("Object storage bucket access", async () => {
    const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      endpoint: env.AWS_ENDPOINT_URL_S3,
      region: env.AWS_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
    });
    const bucket = env.S3_BUCKET_NAME || env.STORAGE_BUCKET || "booking-assets";
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return bucket;
  });
} else {
  fail("Object storage bucket access", "AWS_ENDPOINT_URL_S3 / AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set");
}

// --- GHL ------------------------------------------------------------------
if (!env.GHL_PRIVATE_INTEGRATION_TOKEN || !env.GHL_LOCATION_ID) {
  fail("GHL configuration", "GHL_PRIVATE_INTEGRATION_TOKEN / GHL_LOCATION_ID not set");
} else {
  await check("GHL location access", async () => {
    const body = await ghl(`/locations/${encodeURIComponent(env.GHL_LOCATION_ID)}`, "2021-07-28");
    return body?.location?.name ? `location "${body.location.name}"` : "ok";
  });
  // Same rule as resolveAssignedUserId() in src/lib/ghl/calendars.ts.
  const assignedUser = (members = []) => {
    const withUser = members.filter((m) => m.userId);
    const selected = withUser.filter((m) => m.selected !== false);
    return (selected.find((m) => m.isPrimary) ?? [...selected].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? withUser[0])?.userId ?? null;
  };
  let canReadUsers = null;
  for (const room of rooms) {
    if (!room.ghl_calendar_id) continue;
    await check(`GHL calendar for ${room.name}`, async () => {
      const { calendar } = await ghl(`/calendars/${encodeURIComponent(room.ghl_calendar_id)}`, "2021-04-15");
      const interval = `${calendar.slotInterval ?? "?"} ${calendar.slotIntervalUnit ?? ""}`.trim();
      if (calendar.slotInterval && !(calendar.slotInterval === 30 && (calendar.slotIntervalUnit ?? "mins") === "mins")) {
        throw new Error(`"${calendar.name}" uses a ${interval} slot interval; the app expects 30 mins`);
      }
      if (calendar.isActive === false) throw new Error(`"${calendar.name}" is inactive in GHL`);
      const userId = assignedUser(calendar.teamMembers);
      if (!userId) throw new Error(`"${calendar.name}" has no team member assigned; approvals would fail`);
      let staff = "team member assigned";
      if (canReadUsers !== false) {
        try {
          const user = await ghl(`/users/${encodeURIComponent(userId)}`, "2021-07-28");
          canReadUsers = true;
          staff = `team member: ${user?.name ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ") ?? "found"}`;
        } catch (error) {
          if (!String(error.message).includes("401")) throw new Error(`assigned team member couldn't be found (${error.message})`);
          canReadUsers = false;
        }
      }
      return `"${calendar.name}", ${interval} interval, ${calendar.calendarType ?? "calendar"}, ${staff}`;
    });
  }
  if (canReadUsers === false) skip("GHL team member details", "token lacks users.readonly, so staff were checked via each calendar's team list only");
  await check("GHL contact lookup by email", async () => {
    const query = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, email: "booking-system-healthcheck@example.com" });
    const body = await ghl(`/contacts/search/duplicate?${query}`, "2021-07-28");
    return body && "contact" in body ? `responds (match: ${body.contact ? "yes" : "none"})` : "responds";
  });
  await check("GHL contact lookup by phone", async () => {
    const query = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, number: knownContact?.phone ?? "+639000000000" });
    const body = await ghl(`/contacts/search/duplicate?${query}`, "2021-07-28");
    if (!knownContact) return "responds (no known contact to match)";
    return body?.contact?.id === knownContact.ghl_contact_id ? "finds a known member's contact by phone" : `responds (match: ${body?.contact ? "a different contact" : "none"})`;
  });
  await check("GHL booking custom fields", async () => {
    const { customFields } = await ghl(`/locations/${encodeURIComponent(env.GHL_LOCATION_ID)}/customFields?model=contact`, "2021-07-28");
    const wanted = {
      GHL_FIELD_BOOKING_ROOM_ID: "contact.booking_room",
      GHL_FIELD_BOOKING_EVENT_ID: "contact.booking_event",
      GHL_FIELD_BOOKING_DATE_ID: "contact.booking_date",
      GHL_FIELD_BOOKING_TIME_ID: "contact.booking_time",
      GHL_FIELD_BOOKING_DENIAL_REASON_ID: "contact.booking_denial_reason",
    };
    const notes = [];
    for (const [envName, fieldKey] of Object.entries(wanted)) {
      const byKey = customFields.find((f) => f.fieldKey === fieldKey);
      if (!byKey) throw new Error(`${fieldKey} does not exist`);
      const configured = env[envName]?.trim();
      if (configured && configured !== byKey.id) throw new Error(`${envName} does not match the ID of ${fieldKey}`);
      if (!configured) notes.push(envName);
    }
    return notes.length ? `all 5 resolve by key; env not set (looked up at runtime): ${notes.join(", ")}` : "all 5 env IDs match";
  });
  {
    const fields = await ghl(`/locations/${encodeURIComponent(env.GHL_LOCATION_ID)}/customFields?model=contact`, "2021-07-28")
      .then((body) => body.customFields)
      .catch(() => null);
    const account = (envName, fieldKey) => {
      const configured = env[envName]?.trim();
      const byKey = fields?.find((f) => f.fieldKey === fieldKey);
      if (configured && fields && !fields.some((f) => f.id === configured)) return { ok: false, detail: `${envName} is not a contact field in this location` };
      if (configured || byKey) return { ok: true, detail: configured ? "env ID matches a field" : `found by key ${fieldKey}` };
      return { ok: false, detail: `create a contact text field with key ${fieldKey} (or set ${envName})` };
    };
    const reason = account("GHL_FIELD_ACCOUNT_ACCESS_REASON_ID", "contact.account_access_reason");
    // Deny/revoke still take effect without it, but their emails report a notification failure.
    (reason.ok ? ok : fail)("GHL account access reason field", reason.ok ? reason.detail : `${reason.detail}; deny/revoke emails can't include the reason until then`);
    const status = account("GHL_FIELD_ACCOUNT_STATUS_ID", "contact.account_status");
    if (status.ok) ok("GHL account status field", status.detail);
    else skip("GHL account status field", "optional; not configured");
  }
  // Write-permission probes: deliberately invalid requests that GHL rejects during
  // validation, so nothing is created and no workflow can fire. A 401/403 means
  // the token is missing that scope.
  const probe = async (label, path, method, version, body) => {
    await check(label, async () => {
      const response = await fetch(`${GHL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${env.GHL_PRIVATE_INTEGRATION_TOKEN}`, Version: version, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401 || response.status === 403) throw new Error(`token lacks permission (HTTP ${response.status})`);
      if (response.ok) throw new Error(`unexpected success (HTTP ${response.status}) — check GHL`);
      return `permission ok (validation rejected the probe: HTTP ${response.status})`;
    });
  };
  const missingContact = "booking-system-probe-does-not-exist";
  await probe("GHL scope: appointments write", "/calendars/events/appointments", "POST", "2021-04-15", { locationId: env.GHL_LOCATION_ID });
  await probe("GHL scope: contact update", `/contacts/${missingContact}`, "PUT", "2021-07-28", { customFields: [] });
  await probe("GHL scope: contact tags", `/contacts/${missingContact}/tags`, "POST", "2021-07-28", { tags: [] });

  if (env.GHL_DENIAL_TAG) ok("GHL denial tag configured", env.GHL_DENIAL_TAG);
  else skip("GHL denial tag", "GHL_DENIAL_TAG not set, default room-booking-denied is used");
}

// --- Google Calendar & ESV --------------------------------------------------
const googleKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_TOKEN_ENCRYPTION_KEY"];
const missingGoogle = googleKeys.filter((k) => !env[k]?.trim());
if (missingGoogle.length === 0) {
  await check("Google OAuth configuration", async () => {
    if (env.GOOGLE_TOKEN_ENCRYPTION_KEY.length < 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be at least 32 characters");
    const redirect = new URL(env.GOOGLE_REDIRECT_URI);
    if (!redirect.pathname.endsWith("/api/google/callback")) throw new Error("GOOGLE_REDIRECT_URI must end with /api/google/callback");
    return `redirect ${redirect.origin}/api/google/callback`;
  });
} else {
  fail("Google OAuth configuration", `not set: ${missingGoogle.join(", ")} (required in production; bookings need a connected calendar)`);
}
if (env.ESV_API_KEY?.trim()) {
  await check("ESV API (Verse of the Day)", async () => {
    const response = await fetch("https://api.esv.org/v3/passage/text/?q=John+15:5&include-headings=false&include-footnotes=false", {
      headers: { Authorization: `Token ${env.ESV_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return "key accepted";
  });
} else {
  skip("ESV API (Verse of the Day)", "ESV_API_KEY not set; the dashboard shows the reference with a link instead of the text");
}

// --- WhatsApp assistant (n8n) ----------------------------------------------
const botKey = env.N8N_BOOKING_API_KEY?.trim();
if (!botKey) skip("n8n bot API key", "N8N_BOOKING_API_KEY not set; /api/bot/* refuses every request");
else if (botKey.length < 32) fail("n8n bot API key", "N8N_BOOKING_API_KEY must be at least 32 characters");
else ok("n8n bot API key", `${botKey.length} characters`);
const statusUrl = env.N8N_STATUS_WEBHOOK_URL?.trim();
if (!statusUrl) skip("n8n status webhook", "N8N_STATUS_WEBHOOK_URL not set; WhatsApp status notifications are off");
else if ((env.N8N_WEBHOOK_SIGNING_SECRET?.trim().length ?? 0) < 32) fail("n8n status webhook", "N8N_WEBHOOK_SIGNING_SECRET (32+ characters) is required with N8N_STATUS_WEBHOOK_URL");
else ok("n8n status webhook", `signed POSTs to ${new URL(statusUrl).origin}`);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
