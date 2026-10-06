import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/bookings");
  await expect(page).toHaveURL(/\/login\?next=%2Fbookings/);
});

test("wrong password shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("member@victory.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect" })).toHaveText("Incorrect email or password.");
});

test("a normal member cannot open admin pages", async ({ page }) => {
  await login(page, "member");
  for (const path of ["/admin", "/admin/bookings", "/admin/announcements", "/admin/users"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
  }
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
});

test("unknown rooms show a not-found state", async ({ page }) => {
  await login(page, "member");
  await page.goto("/rooms/does-not-exist");
  await expect(page.getByText("Room not found")).toBeVisible();
});
