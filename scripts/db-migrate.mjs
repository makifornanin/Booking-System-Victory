import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "./db-client.mjs";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "db", "migrations");

// Room slug → env var holding its GHL calendar ID (values never live in source).
const ROOM_CALENDARS = {
  "room-a": "GHL_CALENDAR_ROOM_A",
  "room-b": "GHL_CALENDAR_ROOM_B",
  "room-c": "GHL_CALENDAR_ROOM_C",
  "room-d": "GHL_CALENDAR_ROOM_D",
  "events-place-a": "GHL_CALENDAR_EVENTS_PLACE_A",
};

const client = createClient();
await client.connect();

try {
  await client.query(`create table if not exists public.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set((await client.query("select name from public.schema_migrations")).rows.map((r) => r.name));

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      console.error(`failed ${file}: ${error.message}`);
      process.exit(1);
    }
  }

  for (const [slug, envName] of Object.entries(ROOM_CALENDARS)) {
    const calendarId = process.env[envName]?.trim();
    if (!calendarId) {
      console.warn(`skip ${slug}: ${envName} is not set`);
      continue;
    }
    const result = await client.query(
      "update public.rooms set ghl_calendar_id = $1 where slug = $2 and ghl_calendar_id is distinct from $1 returning name",
      [calendarId, slug],
    );
    console.log(result.rowCount ? `calendar linked: ${result.rows[0].name}` : `calendar ok: ${slug}`);
  }
  console.log("database is up to date");
} finally {
  await client.end();
}
