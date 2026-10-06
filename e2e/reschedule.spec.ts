import { expect, test, type Browser, type Page } from "@playwright/test";
import { approveAsAdmin, futureDate, login, newSession, requestBooking, slotButton } from "./helpers";

async function approvedBooking(page: Page, browser: Browser, room: string, dayOffset: number, eventName: string) {
  await login(page, "member");
  await requestBooking(page, { room, date: futureDate(dayOffset), eventName });
  const admin = await newSession(browser, "admin");
  await approveAsAdmin(admin, eventName);
  await admin.waitForURL(/\/admin\/bookings$/);
  return admin;
}

async function requestNewTime(page: Page, eventName: string, newDate: string) {
  await page.goto("/bookings");
  const row = page.getByRole("listitem").filter({ hasText: eventName });
  await row.getByRole("link", { name: "Request reschedule" }).click();
  await expect(page.getByRole("heading", { name: eventName, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current booking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a new date and time" })).toBeVisible();
  await page.goto(`${new URL(page.url()).pathname}?date=${newDate}`);
  await slotButton(page).nth(3).click();
  await page.getByRole("button", { name: "Request reschedule" }).click();
  await page.waitForURL(/\/bookings\?rescheduled=/);
}

test("a reschedule is a request: the booking only moves when an admin approves it", async ({ page, browser }) => {
  const eventName = `E2E Reschedule ${Date.now()}`;
  const admin = await approvedBooking(page, browser, "Room D", 25, eventName);

  await requestNewTime(page, eventName, futureDate(26));
  await expect(page.getByText("Your reschedule request has been submitted for admin review.")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(row.getByText(/Reschedule requested/)).toBeVisible();
  await expect(row.getByText("Your current booking remains confirmed until this request is approved.")).toBeVisible();
  await expect(row.getByText("Approved", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "Request reschedule" })).toHaveCount(0);

  await admin.goto("/admin/bookings");
  const pendingRow = admin.getByRole("listitem").filter({ hasText: eventName });
  await expect(pendingRow.getByText("Reschedule", { exact: true })).toBeVisible();
  await pendingRow.getByRole("link", { name: eventName }).click();
  await expect(admin.getByRole("heading", { name: "Current booking" })).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Requested change" })).toBeVisible();
  await expect(admin.getByText("Pending review")).toBeVisible();
  await admin.getByRole("button", { name: "Approve reschedule" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog.getByText("Requested", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Approve reschedule" }).click();
  await admin.waitForURL(/\/admin\/bookings$/);
  await expect(admin.getByText(/Reschedule approved/)).toBeVisible();

  await page.goto("/bookings");
  const moved = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(moved.getByText(/Rescheduled from/)).toBeVisible();
  await expect(moved.getByText(/Reschedule requested/)).toHaveCount(0);
  await admin.close();
});

test("a denied reschedule keeps the original booking confirmed", async ({ page, browser }) => {
  const eventName = `E2E Reschedule Deny ${Date.now()}`;
  const admin = await approvedBooking(page, browser, "Room B", 27, eventName);
  await requestNewTime(page, eventName, futureDate(28));

  await admin.goto("/admin/bookings");
  await admin.getByRole("listitem").filter({ hasText: eventName }).getByRole("link", { name: eventName }).click();
  await admin.getByRole("button", { name: "Deny reschedule" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByRole("button", { name: "Deny reschedule" }).click();
  await expect(dialog.getByText("Enter a reason so the member knows why.")).toBeVisible();
  await dialog.getByLabel("Reason").fill("Room B is set up for another event that day.");
  await dialog.getByRole("button", { name: "Deny reschedule" }).click();
  await admin.waitForURL(/status=denied/);

  await page.goto("/bookings");
  const row = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(row.getByText("Approved", { exact: true })).toBeVisible();
  await expect(row.getByText(/Reschedule request denied/)).toBeVisible();
  await expect(row.getByText(/Room B is set up for another event that day/)).toBeVisible();
  await expect(row.getByRole("link", { name: "Request reschedule" })).toBeVisible();
  await admin.close();
});
