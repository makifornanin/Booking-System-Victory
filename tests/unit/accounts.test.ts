import { beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "@/lib/data/repository";
import { createDemoRepository } from "@/lib/demo/repository";
import { normalizePhone, formatPhone } from "@/lib/domain/phone";
import { PENDING_ACCOUNT_TAG } from "@/lib/ghl/gateway";
import { changeAccess, notifyPendingAccount, retryAccessNotification } from "@/lib/services/accounts";
import { signUpSchema } from "@/lib/validation/auth";
import { admin, fakeGhl, member, pendingUserId } from "./fakes";

let adminRepo: Repository;

beforeEach(() => {
  (globalThis as { __victoryDemoState?: unknown }).__victoryDemoState = undefined;
  adminRepo = createDemoRepository(admin.id);
});

describe("phone numbers", () => {
  it("normalizes common Philippine formats to E.164", () => {
    for (const input of ["0917 123 4567", "09171234567", "917-123-4567", "+63 917 123 4567", "63 917 123 4567", "(0917) 123-4567"]) {
      expect(normalizePhone(input)).toBe("+639171234567");
    }
    expect(normalizePhone("+1 (415) 555-0123")).toBe("+14155550123");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects things that aren't phone numbers", () => {
    for (const input of ["", "12345", "call me", "0917-ABC-4567", "+63+917"]) expect(normalizePhone(input)).toBeNull();
  });

  it("is required at sign-up and stored normalized", () => {
    const base = { fullName: "Lia Mendoza", email: "lia@example.com", password: "long-enough-pw" };
    expect(signUpSchema.safeParse(base).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, phone: "" }).success).toBe(false);
    const parsed = signUpSchema.safeParse({ ...base, phone: "0917 123 4567" });
    expect(parsed.success && parsed.data.phone).toBe("+639171234567");
    expect(formatPhone("+639171234567")).toBe("+63 917 123 4567");
  });
});

describe("account access", () => {
  it("new demo sign-ups start pending", async () => {
    expect((await adminRepo.getProfile(pendingUserId))?.accessStatus).toBe("pending");
  });

  it("approves a pending account and sends the approval tag with name and phone", async () => {
    const ghl = fakeGhl();
    const result = await changeAccess({ userId: pendingUserId, action: "approve" }, admin, { repo: adminRepo, calendar: ghl.gateway });
    expect(result).toMatchObject({ ok: true, data: { notificationFailed: false, profile: { accessStatus: "active" } } });
    expect(ghl.log.updates[0]).toMatchObject({ person: { fullName: "Lia Mendoza", phone: "+639170000004" } });
    expect(ghl.log.tags).toEqual([{ contactId: "contact-1", tag: "booking-system-user-approved" }]);
    expect((await adminRepo.listAccessEvents(pendingUserId))[0]).toMatchObject({ change: "approved", actorName: "Andrea Santos" });
  });

  it("requires a reason to deny or revoke, and sends it to GHL", async () => {
    const ghl = fakeGhl();
    const deps = { repo: adminRepo, calendar: ghl.gateway };
    expect(await changeAccess({ userId: pendingUserId, action: "deny", reason: " " }, admin, deps)).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
    expect((await adminRepo.getProfile(pendingUserId))?.accessStatus).toBe("pending");

    expect((await changeAccess({ userId: pendingUserId, action: "deny", reason: "Please sign up with your church email." }, admin, deps)).ok).toBe(true);
    expect(ghl.log.updates.at(-1)?.fields).toMatchObject({ accountAccessReason: "Please sign up with your church email." });
    expect(ghl.log.tags.at(-1)?.tag).toBe("booking-system-user-denied");

    expect((await changeAccess({ userId: pendingUserId, action: "restore" }, admin, deps)).ok).toBe(true);
    expect(ghl.log.tags.at(-1)?.tag).toBe("booking-system-user-restored");

    expect(await changeAccess({ userId: pendingUserId, action: "revoke" }, admin, deps)).toMatchObject({ ok: false });
    expect((await changeAccess({ userId: pendingUserId, action: "revoke", reason: "No longer serving at this location." }, admin, deps)).ok).toBe(true);
    expect(await adminRepo.getProfile(pendingUserId)).toMatchObject({ accessStatus: "revoked", accessReason: "No longer serving at this location." });
    expect(ghl.log.tags.at(-1)?.tag).toBe("booking-system-user-revoked");
  });

  it("keeps the record and booking history when access is revoked", async () => {
    const deps = { repo: adminRepo, calendar: fakeGhl().gateway };
    expect((await changeAccess({ userId: member.id, action: "revoke", reason: "Moved away." }, admin, deps)).ok).toBe(true);
    expect(await adminRepo.getProfile(member.id)).toMatchObject({ accessStatus: "revoked" });
    expect((await adminRepo.listUsers("revoked")).find((u) => u.id === member.id)?.bookingCount).toBeGreaterThan(0);
  });

  it("rejects transitions that don't make sense", async () => {
    const deps = { repo: adminRepo, calendar: fakeGhl().gateway };
    expect(await changeAccess({ userId: member.id, action: "approve" }, admin, deps)).toMatchObject({ ok: false, code: "invalid" });
    expect(await changeAccess({ userId: admin.id, action: "revoke", reason: "x".repeat(5) }, admin, deps)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("does not let a normal member change anyone's access", async () => {
    const ghl = fakeGhl();
    expect(await changeAccess({ userId: pendingUserId, action: "approve" }, member, { repo: createDemoRepository(member.id), calendar: ghl.gateway })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await changeAccess({ userId: member.id, action: "approve" }, { ...admin, accessStatus: "revoked" }, { repo: adminRepo, calendar: ghl.gateway })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect((await adminRepo.getProfile(pendingUserId))?.accessStatus).toBe("pending");
  });

  it("keeps the access decision when the email fails, records it, and retries", async () => {
    const failing = fakeGhl({ failTag: true });
    const result = await changeAccess({ userId: pendingUserId, action: "approve" }, admin, { repo: adminRepo, calendar: failing.gateway });
    expect(result).toMatchObject({ ok: true, data: { notificationFailed: true }, message: expect.stringContaining("notification failed") });
    expect(await adminRepo.getProfile(pendingUserId)).toMatchObject({ accessStatus: "active", accessNotificationError: expect.any(String) });

    const working = fakeGhl();
    expect(await retryAccessNotification({ userId: pendingUserId }, admin, { repo: adminRepo, calendar: working.gateway })).toMatchObject({ ok: true });
    expect(working.log.tags).toEqual([{ contactId: "contact-1", tag: "booking-system-user-approved" }]);
    expect((await adminRepo.getProfile(pendingUserId))?.accessNotificationError).toBeNull();
  });
});

describe("new account pending review (GHL)", () => {
  const owner = { id: pendingUserId, email: "lia@victory.test", fullName: "Lia Mendoza", phone: "+639170000004", ghlContactId: null };

  it("finds or creates the contact with name, email and phone, then re-adds booking-system-user-pending", async () => {
    const ghl = fakeGhl();
    const saved: string[] = [];
    const error = await notifyPendingAccount(owner, { calendar: ghl.gateway, saveGhlContactId: async (_id, contactId) => void saved.push(contactId) });
    expect(error).toBeNull();
    expect(ghl.log.searches).toBe(1);
    expect(ghl.log.updates[0]).toMatchObject({ person: { email: "lia@victory.test", fullName: "Lia Mendoza", phone: "+639170000004" } });
    expect(ghl.log.tags).toEqual([{ contactId: "contact-1", tag: PENDING_ACCOUNT_TAG }]);
    expect(saved).toEqual(["contact-1"]);
    expect(ghl.log.tags.some((t) => /approved|denied|revoked|restored/.test(t.tag))).toBe(false);
  });

  it("returns an error instead of throwing when GHL is down (registration is unaffected)", async () => {
    const ghl = fakeGhl({ failContactUpdate: true });
    await expect(notifyPendingAccount(owner, { calendar: ghl.gateway, saveGhlContactId: async () => undefined })).resolves.toEqual(expect.any(String));
    expect((await adminRepo.getProfile(pendingUserId))?.accessStatus).toBe("pending");
  });

  it("approving or denying removes the pending tag before adding the lifecycle tag", async () => {
    const approveGhl = fakeGhl();
    await changeAccess({ userId: pendingUserId, action: "approve" }, admin, { repo: adminRepo, calendar: approveGhl.gateway });
    expect(approveGhl.log.removedTags).toEqual([{ contactId: "contact-1", tag: PENDING_ACCOUNT_TAG }]);
    expect(approveGhl.log.tags.at(-1)!.tag).toBe("booking-system-user-approved");

    (globalThis as { __victoryDemoState?: unknown }).__victoryDemoState = undefined;
    adminRepo = createDemoRepository(admin.id);
    const denyGhl = fakeGhl();
    await changeAccess({ userId: pendingUserId, action: "deny", reason: "Please use your church email." }, admin, { repo: adminRepo, calendar: denyGhl.gateway });
    expect(denyGhl.log.removedTags).toEqual([{ contactId: "contact-1", tag: PENDING_ACCOUNT_TAG }]);
    expect(denyGhl.log.tags.at(-1)!.tag).toBe("booking-system-user-denied");

    // Revoke/restore keep working as before.
    const revokeGhl = fakeGhl();
    await changeAccess({ userId: pendingUserId, action: "restore" }, admin, { repo: adminRepo, calendar: revokeGhl.gateway });
    expect(revokeGhl.log.tags.at(-1)!.tag).toBe("booking-system-user-restored");
  });

  it("admins can retry a failed pending-review alert for an account that is still pending", async () => {
    const ghl = fakeGhl();
    const result = await retryAccessNotification({ userId: pendingUserId }, admin, { repo: adminRepo, calendar: ghl.gateway });
    expect(result.ok).toBe(true);
    expect(ghl.log.tags).toEqual([{ contactId: "contact-1", tag: PENDING_ACCOUNT_TAG }]);
  });
});
