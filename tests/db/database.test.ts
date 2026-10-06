/**
 * Runs the real migrations on PGlite (Postgres compiled to WASM), then checks
 * constraints and row-level security exactly the way the app uses them: as the
 * restricted `app_member` role with `app.user_id` set to the signed-in user.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(__dirname, "../../db/migrations");
const ADMIN = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";
const CAROL = "44444444-4444-4444-8444-444444444444";
const PENDING = "55555555-5555-4555-8555-555555555555";

let db: PGlite;
let roomA: string;
const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const at = (hhmm: string) => `${day}T${hhmm}:00+08:00`;

/** Mirrors src/lib/db/client.ts: act as app_member for one signed-in user. */
async function as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role app_member; select set_config('app.user_id', '${userId ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('app.user_id', '', false);`);
  }
}

async function errorCode(sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

function insertBooking(userId: string, from: string, to: string, extraColumn = "", extraValue = "") {
  return `insert into public.bookings (user_id, room_id, event_name, event_type, purpose, attendee_count, start_time, end_time${extraColumn ? `, ${extraColumn}` : ""})
    values ('${userId}', '${roomA}', 'Meeting', 'ministry_meeting', 'Test', 5, '${at(from)}', '${at(to)}'${extraValue ? `, ${extraValue}` : ""})
    returning id, status`;
}

const rows = async <T>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  // The app creates profiles on first sign-in as the owner role (role and access use defaults),
  // then an admin approves access. Approval is simulated here for the existing test users.
  await db.exec(`
    insert into public.profiles (id, email, full_name, phone) values
      ('${ADMIN}', 'admin@test', 'Admin Person', '+639170000001'),
      ('${ALICE}', 'alice@test', 'Alice', '+639170000002'),
      ('${BOB}', 'bob@test', 'Bob', '+639170000003'),
      ('${PENDING}', 'pending@test', 'Pat Pending', '+639170000005');
    update public.profiles set access_status = 'active' where id in ('${ADMIN}', '${ALICE}', '${BOB}');
  `);
  roomA = (await rows<{ id: string }>(`select id from public.rooms order by display_order limit 1`))[0].id;
}, 60_000);

describe("schema", () => {
  it("defaults every profile to the user role and pending access", async () => {
    const profiles = await rows<{ role: string; access_status: string; id: string }>(`select id, role, access_status from public.profiles`);
    expect(profiles).toHaveLength(4);
    expect(profiles.every((p) => p.role === "user")).toBe(true);
    expect(profiles.find((p) => p.id === PENDING)?.access_status).toBe("pending");
    await db.exec(`update public.profiles set role = 'admin' where id = '${ADMIN}'`);
  });

  it("rejects malformed phone numbers", async () => {
    expect(await errorCode(`update public.profiles set phone = '0917 123 4567' where id = '${PENDING}'`)).toBe("23514");
  });

  it("seeds the five rooms that map to GHL calendars", async () => {
    const slugs = (await rows<{ slug: string }>(`select slug from public.rooms order by display_order`)).map((r) => r.slug);
    expect(slugs).toEqual(["room-a", "room-b", "room-c", "room-d", "events-place-a"]);
  });
});

describe("member permissions and booking constraints", () => {
  let aliceBooking: string;

  it("lets a member create their own pending booking only", async () => {
    await as(ALICE, async () => {
      const created = await rows<{ id: string; status: string }>(insertBooking(ALICE, "10:00", "12:00"));
      expect(created[0].status).toBe("pending");
      aliceBooking = created[0].id;

      expect(await errorCode(insertBooking(ALICE, "13:00", "14:00", "status", "'approved'"))).toBe("42501");
      expect(await errorCode(insertBooking(ALICE, "13:00", "14:00", "reviewed_by", `'${ALICE}'`))).toBe("42501");
      expect(await errorCode(insertBooking(BOB, "13:00", "14:00"))).toBe("42501");
      expect(await errorCode(insertBooking(ALICE, "15:00", "14:00"))).toBe("23514");
    });
  });

  it("enforces hours, the 30-minute grid, the 90-day window and duration in the database", async () => {
    await as(ALICE, async () => {
      expect(await errorCode(insertBooking(ALICE, "21:30", "22:30"))).toBe("23514");
      expect(await errorCode(insertBooking(ALICE, "06:30", "07:30"))).toBe("23514");
      expect(await errorCode(insertBooking(ALICE, "16:15", "17:15"))).toBe("23514");
      expect(await errorCode(insertBooking(ALICE, "08:00", "17:00"))).toBe("23514");
      const far = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
      expect(
        await errorCode(`insert into public.bookings (user_id, room_id, event_name, event_type, purpose, attendee_count, start_time, end_time)
          values ('${ALICE}', '${roomA}', 'Far', 'other', 'x', 2, '${far}T10:00:00+08:00', '${far}T11:00:00+08:00')`),
      ).toBe("23514");
    });
  });

  it("stops members approving, editing review fields, changing roles or managing announcements", async () => {
    await as(ALICE, async () => {
      expect(await rows(`update public.bookings set status = 'approved' where id = '${aliceBooking}' returning id`)).toHaveLength(0);
      expect(await rows(`update public.bookings set denial_reason = 'x', reviewed_by = '${ALICE}' where id = '${aliceBooking}' returning id`)).toHaveLength(0);
      expect(await errorCode(`update public.profiles set role = 'admin' where id = '${ALICE}'`)).toBe("42501");
      expect(await errorCode(`insert into public.profiles (id, email, role) values ('${CAROL}', 'x@test', 'admin')`)).toBe("42501");
      expect(await rows(`update public.profiles set full_name = 'Alice B' where id = '${ALICE}' returning id`)).toHaveLength(1);
      expect(await rows(`select id from public.profiles`)).toHaveLength(1);
      expect(
        await errorCode(`insert into public.announcements (internal_title, image_path, created_by) values ('x', 'announcements/p.png', '${ALICE}')`),
      ).toBe("42501");
    });
  });

  it("rejects overlapping pending bookings at the database level", async () => {
    await as(BOB, async () => {
      expect(await errorCode(insertBooking(BOB, "11:00", "13:00"))).toBe("23P01");
      expect(await rows(insertBooking(BOB, "12:00", "13:00"))).toHaveLength(1);
      expect(await rows(`select id from public.bookings where user_id = '${ALICE}'`)).toHaveLength(0);

      const busy = await rows<Record<string, unknown>>(
        `select * from public.get_room_busy_ranges('${roomA}', '${at("00:00")}', '${at("23:59")}')`,
      );
      expect(busy).toHaveLength(2);
      expect(Object.keys(busy[0])).toEqual(["start_time", "end_time"]);
      expect(await rows(`select id from public.cancel_my_booking('${aliceBooking}')`)).toHaveLength(0);
    });
  });

  it("gives a session without a signed-in user nothing", async () => {
    await as(null, async () => {
      expect(await rows(`select id from public.bookings`)).toHaveLength(0);
      expect(await rows(`select id from public.profiles`)).toHaveLength(0);
      expect(await errorCode(`select * from public.get_room_busy_ranges('${roomA}', now(), now() + interval '1 day')`)).toBe("42501");
    });
  });

  it("lets admins claim, approve and deny with the required fields", async () => {
    await as(ADMIN, async () => {
      expect(await rows(`select id from public.profiles`)).toHaveLength(4);
      expect(await rows(`select id from public.bookings`)).toHaveLength(2);

      const stale = new Date(Date.now() - 120_000).toISOString();
      const claim = `update public.bookings set review_locked_at = now(), review_locked_by = '${ADMIN}'
        where id = '${aliceBooking}' and status = 'pending' and (review_locked_at is null or review_locked_at < '${stale}') returning id`;
      expect(await rows(claim)).toHaveLength(1);
      expect(await rows(claim)).toHaveLength(0);

      expect(
        await errorCode(`update public.bookings set status = 'denied', reviewed_at = now(), reviewed_by = '${ADMIN}' where id = '${aliceBooking}'`),
      ).toBe("23514");

      const approved = await rows<{ status: string }>(`update public.bookings set status = 'approved', ghl_appointment_id = 'appt-1',
        reviewed_by = '${ADMIN}', reviewed_at = now(), review_locked_at = null, review_locked_by = null
        where id = '${aliceBooking}' and review_locked_by = '${ADMIN}' returning status`);
      expect(approved[0].status).toBe("approved");

      expect(await errorCode(`update public.bookings set status = 'pending' where id = '${aliceBooking}'`)).toBe("23514");
      expect(await errorCode(`update public.bookings set start_time = start_time + interval '1 hour' where id = '${aliceBooking}'`)).toBe("42501");
      expect(await errorCode(`update public.profiles set role = 'user' where id = '${ALICE}'`)).toBe("42501");

      expect(
        await rows(`insert into public.announcements (internal_title, image_path, created_by, is_published) values ('Poster', 'announcements/a.png', '${ADMIN}', true) returning id`),
      ).toHaveLength(1);
    });
  });

  it("frees the slot when a booking is cancelled", async () => {
    await as(BOB, async () => {
      const bobBooking = (await rows<{ id: string }>(`select id from public.bookings where user_id = '${BOB}'`))[0].id;
      const cancelled = await rows<{ status: string }>(`select status from public.cancel_my_booking('${bobBooking}')`);
      expect(cancelled[0].status).toBe("cancelled");
      expect(await rows(insertBooking(BOB, "12:00", "13:00"))).toHaveLength(1);
    });
  });

  it("shows members only live announcements", async () => {
    await as(ALICE, async () => expect(await rows(`select id from public.announcements`)).toHaveLength(1));
    await db.exec(`update public.announcements set publish_at = now() - interval '1 day', expires_at = now() - interval '1 minute'`);
    await as(ALICE, async () => expect(await rows(`select id from public.announcements`)).toHaveLength(0));
  });

  it("stores poster orientation (portrait by default) and rejects anything else", async () => {
    expect((await rows<{ orientation: string }>(`select orientation from public.announcements`))[0].orientation).toBe("portrait");
    await as(ADMIN, async () => {
      const wide = await rows<{ orientation: string }>(
        `insert into public.announcements (internal_title, image_path, created_by, orientation) values ('Wide', 'announcements/w.png', '${ADMIN}', 'landscape') returning orientation`,
      );
      expect(wide[0].orientation).toBe("landscape");
      expect(await errorCode(`insert into public.announcements (internal_title, image_path, created_by, orientation) values ('Bad', 'announcements/b.png', '${ADMIN}', 'square')`)).toBe("23514");
    });
  });

  it("caps open pending requests per member", async () => {
    await db.exec(`insert into public.profiles (id, email, full_name, access_status) values ('${CAROL}', 'carol@test', 'Carol', 'active')`);
    const insertFor = (offsetDays: number, name: string) => {
      const date = new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
      return `insert into public.bookings (user_id, room_id, event_name, event_type, purpose, attendee_count, start_time, end_time)
        values ('${CAROL}', '${roomA}', '${name}', 'other', 'x', 2, '${date}T08:00:00+08:00', '${date}T08:30:00+08:00')`;
    };
    await as(CAROL, async () => {
      for (let i = 0; i < 10; i++) await db.query(insertFor(5 + i, `Cap ${i}`));
      expect(await errorCode(insertFor(20, "One too many"))).toBe("23514");
    });
  });
});

describe("account access approval", () => {
  it("lets a pending account sign in but see nothing in the portal", async () => {
    await as(PENDING, async () => {
      expect(await rows(`select id from public.profiles`)).toHaveLength(1); // their own profile, for the waiting screen
      expect(await rows(`select id from public.rooms`)).toHaveLength(0);
      expect(await rows(`select id from public.announcements`)).toHaveLength(0);
      expect(await errorCode(insertBooking(PENDING, "09:00", "10:00"))).toBe("42501");
    });
  });

  it("never lets a member change access status, including their own", async () => {
    await as(PENDING, async () => {
      expect(await errorCode(`update public.profiles set access_status = 'active' where id = '${PENDING}'`)).toBe("42501");
      expect(await errorCode(`select * from public.admin_set_user_access('${PENDING}', 'active', null)`)).toBe("42501");
    });
    await as(ALICE, async () => {
      expect(await errorCode(`select * from public.admin_set_user_access('${PENDING}', 'active', null)`)).toBe("42501");
      expect(await errorCode(`select public.admin_set_ghl_contact('${ALICE}', 'x')`)).toBe("42501");
    });
  });

  it("lets admins approve, deny (with reason), revoke (with reason) and restore", async () => {
    await as(ADMIN, async () => {
      expect(await errorCode(`select * from public.admin_set_user_access('${PENDING}', 'denied', '  ')`)).toBe("23514");
      const denied = await rows<{ access_status: string; access_reason: string; access_reviewed_by: string }>(
        `select * from public.admin_set_user_access('${PENDING}', 'denied', 'Not a Victory member')`,
      );
      expect(denied[0]).toMatchObject({ access_status: "denied", access_reason: "Not a Victory member", access_reviewed_by: ADMIN });

      const restored = await rows<{ access_status: string; access_reason: string | null }>(
        `select * from public.admin_set_user_access('${PENDING}', 'active', null)`,
      );
      expect(restored[0]).toMatchObject({ access_status: "active", access_reason: null });

      expect(await errorCode(`select * from public.admin_set_user_access('${PENDING}', 'revoked', '')`)).toBe("23514");
      const revoked = await rows<{ access_status: string }>(`select * from public.admin_set_user_access('${PENDING}', 'revoked', 'Left the church')`);
      expect(revoked[0].access_status).toBe("revoked");
      expect(await errorCode(`select * from public.admin_set_user_access('${PENDING}', 'denied', 'x')`)).toBe("23514");

      expect(await errorCode(`select * from public.admin_set_user_access('${ADMIN}', 'revoked', 'oops')`)).toBe("23514");
    });
    await as(PENDING, async () => expect(await rows(`select id from public.rooms`)).toHaveLength(0));
  });

  it("removes admin rights when an admin's access is revoked", async () => {
    await db.exec(`update public.profiles set role = 'admin', access_status = 'revoked', access_reason = 'test' where id = '${PENDING}'`);
    await as(PENDING, async () => expect(await rows(`select id from public.profiles`)).toHaveLength(1));
    await db.exec(`update public.profiles set role = 'user' where id = '${PENDING}'`);
  });
});

describe("server-only tables", () => {
  it("hides Google tokens and the verse cache from the app role", async () => {
    await as(ADMIN, async () => {
      expect(await errorCode(`select * from public.google_calendar_connections`)).toBe("42501");
      expect(await errorCode(`select * from public.daily_verses`)).toBe("42501");
    });
  });

  it("lets only the owner or an admin record Google Calendar sync results", async () => {
    const booking = (await rows<{ id: string }>(`select id from public.bookings where user_id = '${BOB}' and status = 'pending' limit 1`))[0];
    await as(ALICE, async () => {
      await db.query(`select public.set_booking_calendar_sync('${booking.id}', 'evil', null)`);
    });
    const after = async () =>
      (await rows<{ google_calendar_event_id: string | null }>(`select google_calendar_event_id from public.bookings where id = '${booking.id}'`))[0]
        .google_calendar_event_id;
    expect(await after()).toBeNull();
    await as(BOB, async () => {
      await db.query(`select public.set_booking_calendar_sync('${booking.id}', 'evt123', null)`);
    });
    expect(await after()).toBe("evt123");
  });
});

describe("WhatsApp bookings (bot API)", () => {
  it("records the source, keeps WhatsApp message ids unique and hides notification columns from members", async () => {
    await as(ALICE, async () => {
      const web = await rows<{ source: string }>(`${insertBooking(ALICE, "17:00", "17:30").replace("returning id, status", "returning source")}`);
      expect(web[0].source).toBe("web");

      const whatsapp = await rows<{ source: string; whatsapp_message_id: string }>(
        insertBooking(ALICE, "18:00", "19:00", "source, whatsapp_message_id", "'whatsapp', 'wamid.TEST1'").replace("returning id, status", "returning source, whatsapp_message_id"),
      );
      expect(whatsapp[0]).toEqual({ source: "whatsapp", whatsapp_message_id: "wamid.TEST1" });

      // The same WhatsApp message can never create a second booking.
      expect(await errorCode(insertBooking(ALICE, "19:00", "20:00", "source, whatsapp_message_id", "'whatsapp', 'wamid.TEST1'"))).toBe("23505");
      // A message id only makes sense on a WhatsApp booking, and the source is limited.
      expect(await errorCode(insertBooking(ALICE, "19:00", "20:00", "whatsapp_message_id", "'wamid.TEST2'"))).toBe("23514");
      expect(await errorCode(insertBooking(ALICE, "19:00", "20:00", "source", "'sms'"))).toBe("23514");
      // Notification bookkeeping is written by the server only.
      expect(await errorCode(`update public.bookings set status_notification_error = 'x' where user_id = '${ALICE}'`)).toBe("42501");
    });
  });
});

describe("reschedule requests", () => {
  const day2 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const at2 = (hhmm: string) => `${day2}T${hhmm}:00+08:00`;
  let booking: string;

  const book = (userId: string, from: string, to: string) =>
    rows<{ id: string }>(`insert into public.bookings (user_id, room_id, event_name, event_type, purpose, attendee_count, start_time, end_time)
      values ('${userId}', '${roomA}', 'Rehearsal', 'other', 'Test', 4, '${at2(from)}', '${at2(to)}') returning id`);
  const requestFor = (bookingId: string, from: string, to: string) =>
    `insert into public.booking_reschedule_requests (booking_id, requested_start, requested_end) values ('${bookingId}', '${at2(from)}', '${at2(to)}') returning id, room_id, original_start, status`;

  beforeAll(async () => {
    booking = (await as(ALICE, () => book(ALICE, "08:00", "09:00")))[0].id;
    await as(ADMIN, () => db.query(`update public.bookings set status = 'approved', reviewed_by = '${ADMIN}', reviewed_at = now() where id = '${booking}'`));
  });

  it("lets only the owner request a reschedule of a future approved booking, once at a time", async () => {
    await as(BOB, async () => expect(await errorCode(requestFor(booking, "14:00", "15:00"))).toBe("42501"));
    const pendingBooking = (await as(ALICE, () => book(ALICE, "20:00", "21:00")))[0].id;
    await as(ALICE, async () => {
      expect(await errorCode(requestFor(pendingBooking, "14:00", "15:00"))).toBe("23514");
      const created = await rows<{ room_id: string; original_start: Date; status: string }>(requestFor(booking, "14:00", "15:00"));
      expect(created[0]).toMatchObject({ room_id: roomA, status: "pending" });
      expect(new Date(created[0].original_start).toISOString()).toBe(new Date(at2("08:00")).toISOString());
      expect(await errorCode(requestFor(booking, "16:00", "17:00"))).toBe("23505"); // one pending per booking
      expect(await errorCode(`insert into public.booking_reschedule_requests (booking_id, requested_start, requested_end, status) values ('${booking}', '${at2("16:00")}', '${at2("17:00")}', 'approved')`)).toBe("42501");
    });
  });

  it("holds the requested slot against new bookings and other requests, and shows it as busy", async () => {
    await as(BOB, async () => {
      expect(await errorCode(`insert into public.bookings (user_id, room_id, event_name, event_type, purpose, attendee_count, start_time, end_time)
        values ('${BOB}', '${roomA}', 'Clash', 'other', 'Test', 4, '${at2("14:30")}', '${at2("15:30")}')`)).toBe("23P01");
      const busy = await rows<{ start_time: Date }>(`select * from public.get_room_busy_ranges('${roomA}', '${at2("00:00")}', '${at2("23:59")}')`);
      expect(busy.map((b) => new Date(b.start_time).toISOString())).toEqual(expect.arrayContaining([new Date(at2("08:00")).toISOString(), new Date(at2("14:00")).toISOString()]));
    });
    const bobBooking = (await as(BOB, () => book(BOB, "11:00", "12:00")))[0].id;
    await as(ADMIN, () => db.query(`update public.bookings set status = 'approved', reviewed_by = '${ADMIN}', reviewed_at = now() where id = '${bobBooking}'`));
    await as(BOB, async () => expect(await errorCode(requestFor(bobBooking, "14:30", "15:30"))).toBe("23P01"));
  });

  it("approval goes only through admin_apply_reschedule, which moves the same booking and frees the old slot", async () => {
    const request = (await rows<{ id: string }>(`select id from public.booking_reschedule_requests where booking_id = '${booking}' and status = 'pending'`))[0].id;
    await as(ALICE, async () => {
      await db.query(`update public.booking_reschedule_requests set status = 'approved' where id = '${request}'`); // RLS: no effect
      expect(await errorCode(`select * from public.admin_apply_reschedule('${request}')`)).toBe("42501");
    });
    await as(ADMIN, async () => {
      expect(await errorCode(`update public.booking_reschedule_requests set status = 'approved', reviewed_at = now() where id = '${request}'`)).toBe("42501");
      expect(await rows(`select * from public.admin_apply_reschedule('${request}')`)).toHaveLength(0); // not claimed yet
      await db.query(`update public.booking_reschedule_requests set review_locked_at = now(), review_locked_by = '${ADMIN}' where id = '${request}'`);
      const moved = await rows<{ id: string; status: string; start_time: Date }>(`select * from public.admin_apply_reschedule('${request}')`);
      expect(moved[0]).toMatchObject({ id: booking, status: "approved" });
      expect(new Date(moved[0].start_time).toISOString()).toBe(new Date(at2("14:00")).toISOString());
    });
    const status = (await rows<{ status: string; reviewed_by: string }>(`select status, reviewed_by from public.booking_reschedule_requests where id = '${request}'`))[0];
    expect(status).toEqual({ status: "approved", reviewed_by: ADMIN });
    // The original 08:00 slot is free again.
    expect(await as(BOB, () => book(BOB, "08:00", "09:00"))).toHaveLength(1);
  });

  it("keeps the original booking on denial and releases holds when a booking is cancelled", async () => {
    const r1 = (await as(ALICE, () => rows<{ id: string }>(requestFor(booking, "17:00", "18:00"))))[0].id;
    await as(ADMIN, () => db.query(`update public.booking_reschedule_requests set status = 'denied', denial_reason = 'Busy', reviewed_by = '${ADMIN}', reviewed_at = now() where id = '${r1}'`));
    const after = (await rows<{ status: string; start_time: Date }>(`select status, start_time from public.bookings where id = '${booking}'`))[0];
    expect(after.status).toBe("approved");
    expect(new Date(after.start_time).toISOString()).toBe(new Date(at2("14:00")).toISOString());
    expect(await as(BOB, () => book(BOB, "17:00", "18:00"))).toHaveLength(1); // released

    const r2 = (await as(ALICE, () => rows<{ id: string }>(requestFor(booking, "19:00", "20:00"))))[0].id;
    await as(ALICE, () => db.query(`select * from public.cancel_my_booking('${booking}')`));
    expect((await rows<{ status: string }>(`select status from public.booking_reschedule_requests where id = '${r2}'`))[0].status).toBe("cancelled");
  });
});
