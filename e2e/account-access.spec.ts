import { expect, test, type Page } from "@playwright/test";
import { futureDate, newSession, openRoom, signUpNewMember, slotButton } from "./helpers";

async function decide(admin: Page, fullName: string, button: string, confirm: string, reason?: string) {
  await admin.goto("/admin/users?status=" + (button === "Restore access" ? "denied" : button === "Revoke access" ? "active" : "pending"));
  await admin.getByRole("link", { name: fullName }).click();
  await expect(admin.getByRole("heading", { name: fullName, level: 1 })).toBeVisible();
  await admin.getByRole("button", { name: button, exact: true }).click();
  const dialog = admin.getByRole("dialog");
  if (reason !== undefined) {
    await dialog.getByRole("button", { name: confirm }).click();
    await expect(dialog.getByText("Enter a reason. The person will see it in the email.")).toBeVisible();
    await dialog.getByLabel("Reason").fill(reason);
  }
  await dialog.getByRole("button", { name: confirm }).click();
  await expect(dialog).toBeHidden();
}

test("phone is required and validated at sign-up", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill("No Phone");
  await page.getByLabel("Email").fill(`e2e-nophone-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter your mobile number.")).toBeVisible();
  await page.getByLabel("Mobile number").fill("12345");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/^Enter a valid mobile number/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("new accounts wait for approval; approved members must connect Google Calendar before booking", async ({ browser }) => {
  const member = await signUpNewMember(browser, "Approve");
  const pending = member.page;
  await expect(pending.getByRole("heading", { name: "Your account is awaiting approval" })).toBeVisible();
  await expect(pending.getByText("+63 917 555 0123")).toBeVisible();

  // Pending accounts can't reach the portal or admin.
  await pending.goto("/dashboard");
  await expect(pending).toHaveURL(/\/pending$/);
  await pending.goto("/rooms");
  await expect(pending).toHaveURL(/\/pending$/);
  await pending.goto("/admin/users");
  await expect(pending).toHaveURL(/\/pending$/);

  const admin = await newSession(browser, "admin");
  await expect(admin.getByRole("heading", { name: /^Accounts awaiting approval/ })).toBeVisible();
  await expect(admin.getByRole("link", { name: member.fullName })).toBeVisible();
  await decide(admin, member.fullName, "Approve", "Approve access");
  await expect(admin.getByText("Active", { exact: true }).first()).toBeVisible();

  await pending.goto("/pending");
  await expect(pending).toHaveURL(/\/dashboard$/);

  // No Google connection yet: the booking flow asks for it and returns here afterwards.
  await openRoom(pending, "Room A", futureDate(20));
  await slotButton(pending).first().click();
  await expect(pending.getByText("Connect Google Calendar to continue")).toBeVisible();
  await expect(pending.getByLabel("Event name")).toHaveCount(0);
  await pending.getByRole("link", { name: "Connect Google Calendar" }).click();
  await expect(pending).toHaveURL(/\/rooms\/room-a\?date=.*google=connected/);
  await expect(pending.getByText("Google Calendar connected.", { exact: false })).toBeVisible();
  await slotButton(pending).first().click();
  await expect(pending.getByLabel("Event name")).toBeVisible();

  // Disconnecting from the account page brings the prompt back.
  await pending.goto("/account");
  await pending.getByRole("button", { name: "Disconnect" }).click();
  await pending.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(pending.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();

  await pending.context().close();
  await admin.close();
});

test("deny and revoke require a reason, the member sees it, and access can be restored", async ({ browser }) => {
  const member = await signUpNewMember(browser, "Deny");
  const admin = await newSession(browser, "admin");

  await decide(admin, member.fullName, "Deny", "Deny account", "We couldn't confirm you attend Victory Katipunan.");
  await member.page.goto("/pending");
  await expect(member.page.getByRole("heading", { name: "We couldn't approve this account" })).toBeVisible();
  await expect(member.page.getByText("We couldn't confirm you attend Victory Katipunan.")).toBeVisible();

  await decide(admin, member.fullName, "Restore access", "Restore access");
  await member.page.goto("/pending");
  await expect(member.page).toHaveURL(/\/dashboard$/);

  await decide(admin, member.fullName, "Revoke access", "Revoke access", "Account shared with another person.");
  await member.page.goto("/bookings");
  await expect(member.page).toHaveURL(/\/pending$/);
  await expect(member.page.getByRole("heading", { name: "Your portal access has been revoked" })).toBeVisible();

  // The history keeps every decision; nothing is deleted.
  await admin.reload();
  const history = admin.getByRole("list", { name: "Access history" });
  await expect(history.getByText("Denied")).toBeVisible();
  await expect(history.getByText("Access restored")).toBeVisible();
  await expect(history.getByText("Access revoked")).toBeVisible();

  await member.page.context().close();
  await admin.close();
});
