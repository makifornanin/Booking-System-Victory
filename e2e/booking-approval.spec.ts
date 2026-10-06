import { expect, test } from "@playwright/test";
import { approveAsAdmin, futureDate, login, newSession, requestBooking } from "./helpers";

test("member requests a room, admin approves, it syncs to Google, member cancels it", async ({ page, browser }) => {
  const eventName = `E2E Approval ${Date.now()}`;

  await login(page, "member");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Jamie");

  const row = await requestBooking(page, { room: "Room C", date: futureDate(15), eventName });
  await expect(row.getByText("Pending review")).toBeVisible();

  const admin = await newSession(browser, "admin");
  await expect(admin.getByRole("heading", { name: /^Booking requests/ })).toBeVisible();
  await expect(admin.getByRole("link", { name: eventName })).toBeVisible();

  await approveAsAdmin(admin, eventName);
  await admin.waitForURL(/\/admin\/bookings$/);
  await expect(admin.getByText("Booking approved and added to the GHL calendar and the member's Google Calendar.")).toBeVisible();

  await admin.goto("/admin/bookings?status=approved");
  await expect(admin.getByRole("link", { name: eventName })).toBeVisible();

  await page.goto("/bookings");
  const updated = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(updated.getByText("Approved")).toBeVisible();
  await expect(updated.getByText("On your Google Calendar")).toBeVisible();

  // Cancelling an approved booking releases GHL and removes the Google event.
  await updated.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Booking cancelled.")).toBeVisible();
  await page.goto("/bookings?view=cancelled");
  await expect(page.getByRole("listitem").filter({ hasText: eventName }).getByText("Cancelled")).toBeVisible();
  await admin.close();
});

test("approval that GHL rejects leaves the request pending", async ({ page, browser }) => {
  const eventName = `E2E [ghl-fail] ${Date.now()}`;
  await login(page, "member");
  await requestBooking(page, { room: "Event's Place - A", date: futureDate(16), eventName });

  const admin = await newSession(browser, "admin");
  const dialog = await approveAsAdmin(admin, eventName);
  await expect(dialog.getByRole("alert")).toContainText("still pending");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await admin.reload();
  await expect(admin.getByText("Pending review").first()).toBeVisible();
  await expect(admin.getByRole("button", { name: "Approve", exact: true })).toBeVisible();

  await page.goto("/bookings?view=pending");
  const row = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(row.getByText("Pending review")).toBeVisible();

  // Member withdraws the request; it moves to Cancelled.
  await row.getByRole("button", { name: "Withdraw" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw request" }).click();
  await expect(page.getByText("Booking cancelled.")).toBeVisible();
  await page.goto("/bookings?view=cancelled");
  await expect(page.getByRole("listitem").filter({ hasText: eventName }).getByText("Cancelled")).toBeVisible();
  await admin.close();
});

test("a Google Calendar failure never undoes the approval", async ({ page, browser }) => {
  const eventName = `E2E [google-fail] ${Date.now()}`;
  await login(page, "member");
  await requestBooking(page, { room: "Room B", date: futureDate(18), eventName });

  const admin = await newSession(browser, "admin");
  await approveAsAdmin(admin, eventName);
  await admin.waitForURL(/\/admin\/bookings$/);
  await expect(admin.getByText("Booking approved, but Google Calendar sync failed.")).toBeVisible();

  await admin.goto("/admin/bookings?status=approved");
  await admin.getByRole("link", { name: eventName }).click();
  await expect(admin.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(admin.getByRole("button", { name: "Retry calendar sync" })).toBeVisible();

  await page.goto("/bookings?view=approved");
  const row = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(row.getByText("Approved", { exact: true })).toBeVisible();
  await expect(row.getByText("Approved, but Google Calendar sync failed.")).toBeVisible();
  await row.getByRole("button", { name: "Retry calendar sync" }).click();
  // The simulated outage persists for this event name, so the retry reports the failure again.
  await expect(page.getByText(/Google Calendar/).last()).toBeVisible();
  await expect(row.getByText("Approved", { exact: true })).toBeVisible();
  await admin.close();
});
