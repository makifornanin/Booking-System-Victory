import { expect, test } from "@playwright/test";
import { futureDate, login, newSession, openRequestAsAdmin, requestBooking } from "./helpers";

test("admin must give a reason to deny, and the member sees it", async ({ page, browser }) => {
  const eventName = `E2E Denial ${Date.now()}`;
  const reason = "Room D is closed for repainting that week. Please try Room C.";

  await login(page, "member");
  await requestBooking(page, { room: "Room D", date: futureDate(17), eventName });

  const admin = await newSession(browser, "admin");
  await openRequestAsAdmin(admin, eventName);
  await admin.getByRole("button", { name: "Deny", exact: true }).click();

  const dialog = admin.getByRole("dialog");
  await dialog.getByRole("button", { name: "Deny request" }).click();
  await expect(dialog.getByText("Enter a reason so the requester knows why.")).toBeVisible();
  await expect(admin.getByText("Pending review").first()).toBeVisible();

  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Deny request" }).click();
  await admin.waitForURL(/status=denied/);
  await expect(admin.getByRole("link", { name: eventName })).toBeVisible();

  await page.goto("/bookings?view=denied");
  const row = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(row.getByText("Denied")).toBeVisible();
  await expect(row.getByText(reason)).toBeVisible();
  await admin.close();
});
