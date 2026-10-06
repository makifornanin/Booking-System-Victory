import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("the homepage is public and leads to sign-in and sign-up", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Victory Booking System");
  await expect(page.getByRole("heading", { name: "Victory Booking System", level: 1 })).toBeVisible();
  await expect(page.getByText("A room reservation system for Victory Church facilities.")).toBeVisible();

  const footer = page.getByRole("navigation", { name: "Footer" });
  await expect(footer.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "Sign In" })).toHaveAttribute("href", "/login");

  await page.getByRole("main").getByRole("link", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByLabel("Mobile number")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy Policy" })).toBeVisible();
});

test("privacy policy and terms are public", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page).toHaveTitle("Privacy Policy | Victory Booking System");
  await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
  const google = page.locator("#google-calendar");
  await expect(google.getByText("https://www.googleapis.com/auth/calendar.events.owned")).toBeVisible();
  await expect(google.getByText(/Limited Use requirements/)).toBeVisible();
  await expect(google.getByText(/does not request access to Gmail, Google Drive, Google Contacts/)).toBeVisible();

  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of Use", level: 1 })).toBeVisible();
});

test("signed-in members see Open portal on the homepage", async ({ page }) => {
  await login(page, "member");
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Open portal" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
