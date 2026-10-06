import { expect, test } from "@playwright/test";
import { login, newSession } from "./helpers";

// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("admin publishes a poster, members see it, unpublishing hides it", async ({ page, browser }) => {
  const title = `E2E Poster ${Date.now()}`;
  await login(page, "admin");
  await page.goto("/admin/announcements");

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add announcement" }) });
  await form.getByRole("button", { name: "Add announcement" }).click();
  await expect(form.getByText("Choose an image to upload.")).toBeVisible();

  await form.locator('input[name="poster"]').setInputFiles({ name: "poster.png", mimeType: "image/png", buffer: PNG });
  await form.getByLabel("Internal title").fill(title);
  await form.getByRole("button", { name: "Add announcement" }).click();
  await expect(page.getByText("Announcement saved and published.")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row.getByText("Published", { exact: true })).toBeVisible();

  const member = await newSession(browser, "member");
  await expect(member.getByRole("button", { name: `View poster: ${title}` })).toBeVisible();

  await row.getByRole("button", { name: "Unpublish" }).click();
  await expect(row.getByText("Draft", { exact: true })).toBeVisible();
  await member.reload();
  await expect(member.getByRole("button", { name: `View poster: ${title}` })).toHaveCount(0);

  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
  await member.close();
});

test("expired, draft and scheduled seed posters are hidden from members", async ({ page }) => {
  await login(page, "member");
  await expect(page.getByRole("button", { name: /View poster: Sunday Celebration/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Summer Camp/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Prayer and Fasting/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Small Group Season/ })).toHaveCount(0);
});
