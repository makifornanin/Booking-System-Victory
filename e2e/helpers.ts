import { expect, type Browser, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "victory-demo";
export const ACCOUNTS = {
  member: "member@victory.test",
  admin: "admin@victory.test",
} as const;

const HOME: Record<keyof typeof ACCOUNTS, RegExp> = { member: /\/dashboard$/, admin: /\/admin$/ };

/** A future, non-Sunday date (church time) some days ahead, as YYYY-MM-DD. */
export function futureDate(daysAhead: number): string {
  const manila = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const date = new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate() + daysAhead));
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function login(page: Page, who: keyof typeof ACCOUNTS) {
  await signIn(page, ACCOUNTS[who], DEMO_PASSWORD);
  await page.waitForURL(HOME[who]);
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function newSession(browser: Browser, who: keyof typeof ACCOUNTS): Promise<Page> {
  const context = await browser.newContext({ timezoneId: "Asia/Manila" });
  const page = await context.newPage();
  await login(page, who);
  return page;
}

/** Signs up a fresh account in a new browser context; it lands on the awaiting-approval screen. */
export async function signUpNewMember(browser: Browser, label: string) {
  const context = await browser.newContext({ timezoneId: "Asia/Manila" });
  const page = await context.newPage();
  const stamp = Date.now();
  const user = { fullName: `E2E ${label} ${stamp}`, email: `e2e-${label.toLowerCase()}-${stamp}@example.com`, password: "e2e-password-123" };
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill(user.fullName);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Mobile number").fill("0917 555 0123");
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/pending$/);
  return { page, ...user };
}

export const slotButton = (page: Page) => page.getByRole("button", { name: /^\d{1,2}:\d{2} [AP]M$/ });

/** Opens a room from the Rooms page and jumps to the given date. */
export async function openRoom(page: Page, room: string, date: string) {
  await page.getByRole("navigation", { name: "Primary" }).first().getByRole("link", { name: "Book a Room" }).click();
  await expect(page.getByRole("heading", { name: "Find a space for your gathering", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: room, exact: true }).click();
  await expect(page.getByRole("heading", { name: room, level: 1 })).toBeVisible();
  const slug = new URL(page.url()).pathname.split("/").pop();
  await page.goto(`/rooms/${slug}?date=${date}`);
}

/** Requests the first open hour on a date and returns the new row in My bookings. */
export async function requestBooking(page: Page, opts: { room: string; date: string; eventName: string }) {
  await openRoom(page, opts.room, opts.date);
  await slotButton(page).first().click();

  await page.getByLabel("Event name").fill(opts.eventName);
  await page.getByLabel("Type", { exact: true }).selectOption("ministry_meeting");
  await page.getByLabel("People").fill("8");
  await page.getByLabel("Purpose").fill("Automated end-to-end test booking.");
  await page.getByRole("button", { name: /^Request / }).click();

  await page.waitForURL(/\/bookings\?new=/);
  const row = page.getByRole("listitem").filter({ hasText: opts.eventName });
  await expect(row).toBeVisible();
  return row;
}

export async function openRequestAsAdmin(page: Page, eventName: string) {
  await page.goto("/admin/bookings");
  await page.getByRole("link", { name: eventName }).click();
  await expect(page.getByRole("heading", { name: eventName, level: 1 })).toBeVisible();
}

export async function approveAsAdmin(page: Page, eventName: string) {
  await openRequestAsAdmin(page, eventName);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(eventName)).toBeVisible();
  await dialog.getByRole("button", { name: "Approve reservation" }).click();
  return dialog;
}
