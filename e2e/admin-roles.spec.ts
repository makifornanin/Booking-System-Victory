import { expect, test } from "@playwright/test";
import { login, newSession, signUpNewMember } from "./helpers";

test("an admin can make an active member an admin and remove it again, effective on their next request", async ({ browser }) => {
  const person = await signUpNewMember(browser, "Role");
  const admin = await newSession(browser, "admin");

  // Pending accounts can't be promoted; approve first.
  await admin.goto("/admin/users?status=pending");
  await admin.getByRole("link", { name: person.fullName }).click();
  await expect(admin.getByRole("heading", { name: person.fullName, level: 1 })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Make admin" })).toHaveCount(0);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Approve access" }).click();
  await expect(admin.getByRole("dialog")).toBeHidden();

  // The confirmation explains what admins can do.
  await admin.getByRole("button", { name: "Make admin" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Make this user an admin?" })).toBeVisible();
  await expect(dialog.getByText("Approve and deny booking requests")).toBeVisible();
  await dialog.getByRole("button", { name: "Make admin" }).click();
  await expect(dialog).toBeHidden();
  await expect(admin.getByText(/^Admin · Joined/)).toBeVisible();
  await expect(admin.getByText("Made admin")).toBeVisible();

  // The promoted person's next request is an admin request (no sign-out needed).
  const promoted = person.page;
  expect((await promoted.goto("/admin/users"))?.status()).toBe(200);
  await expect(promoted.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();

  await admin.getByRole("button", { name: "Remove admin access" }).click();
  await expect(dialog.getByRole("heading", { name: "Remove admin access?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Remove admin access" }).click();
  await expect(dialog).toBeHidden();
  await expect(admin.getByText("Admin access removed")).toBeVisible();

  const response = await promoted.goto("/admin");
  expect(response?.status()).toBe(403);
  await expect(promoted.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();

  await promoted.context().close();
  await admin.close();
});

test("admins can't change their own role from the Users screen", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/admin/users?status=active");
  const own = page.getByRole("listitem").filter({ hasText: "admin@victory.test" });
  await expect(own.getByText("You", { exact: true })).toBeVisible();
  await expect(own.getByRole("button")).toHaveCount(0);
});
