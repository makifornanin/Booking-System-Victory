import { expect, test } from "@playwright/test";
import { futureDate, login } from "./helpers";

const KEY = "e2e-demo-bot-key-not-a-secret-0123456789";
const MEMBER_PHONE = "639170000002"; // as WhatsApp sends it: country code, no "+"
const auth = { Authorization: `Bearer ${KEY}` };

test("bot API rejects calls without the n8n key", async ({ request }) => {
  const missing = await request.post("/api/bot/verify-user", { data: { phone: MEMBER_PHONE } });
  expect(missing.status()).toBe(401);
  expect(await missing.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED_BOT" });
  const wrong = await request.post("/api/bot/my-bookings", { data: { phone: MEMBER_PHONE }, headers: { Authorization: "Bearer wrong-key" } });
  expect(wrong.status()).toBe(401);
  expect((await request.get("/api/bot/verify-user", { headers: auth })).status()).toBe(405);
});

test("a WhatsApp request enters the normal pending queue, once, marked WhatsApp", async ({ request, page }) => {
  const date = futureDate(22);
  const eventName = `E2E WhatsApp ${Date.now()}`;
  const messageId = `wamid.e2e.${Date.now()}`;

  const verify = await request.post("/api/bot/verify-user", { data: { phone: MEMBER_PHONE }, headers: auth });
  expect(await verify.json()).toEqual({ ok: true, user: { firstName: "Jamie", phone: "+639170000002", accessStatus: "active" } });

  const check = await request.post("/api/bot/check-availability", { data: { phone: MEMBER_PHONE, room: "B", date, startTime: "10:00", endTime: "12:00" }, headers: auth });
  expect(await check.json()).toMatchObject({ ok: true, available: true, room: "Room B", date, durationMinutes: 120 });

  const body = { phone: MEMBER_PHONE, room: "room b", date, startTime: "10:00", endTime: "12:00", eventName, eventType: "Ministry meeting", purpose: "Planning via WhatsApp.", attendeeCount: 6, whatsappMessageId: messageId };
  const created = await (await request.post("/api/bot/create-booking", { data: body, headers: auth })).json();
  expect(created).toMatchObject({ ok: true, code: "BOOKING_CREATED", booking: { status: "pending", room: "Room B", event: eventName, source: "whatsapp" } });

  const retried = await (await request.post("/api/bot/create-booking", { data: body, headers: auth })).json();
  expect(retried).toMatchObject({ ok: true, code: "DUPLICATE_MESSAGE", booking: { id: created.booking.id } });

  const mine = await (await request.post("/api/bot/my-bookings", { data: { phone: MEMBER_PHONE }, headers: auth })).json();
  expect(mine.bookings.filter((b: { event: string }) => b.event === eventName)).toHaveLength(1);

  await login(page, "admin");
  await page.goto("/admin/bookings?source=whatsapp");
  const row = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(row).toBeVisible();
  await expect(row.getByText(/^WhatsApp ·$/)).toBeVisible();
  await page.goto("/admin/bookings?source=web");
  await expect(page.getByRole("listitem").filter({ hasText: eventName })).toHaveCount(0);
});
