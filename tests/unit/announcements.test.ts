import { describe, expect, it } from "vitest";
import { createDemoImageStorage, createDemoRepository } from "@/lib/demo/repository";
import { roundDownToGrid, timeLabel } from "@/components/announcements/schedule-field";
import { createAnnouncement, updateAnnouncement } from "@/lib/services/announcements";
import { announcementFieldsSchema } from "@/lib/validation/announcement";
import { admin } from "./fakes";

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function form(fields: Record<string, string>, withPoster = true) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  if (withPoster) data.set("poster", new File([PNG], "poster.png", { type: "image/png" }));
  return data;
}

const base = { internalTitle: "Worship Night", publishAt: "2026-10-07T19:00", publish: "on" };

describe("announcement schedule", () => {
  it("reads the publish date and time as Philippine time", () => {
    const parsed = announcementFieldsSchema.parse({ ...base, orientation: "portrait", expiresAt: "2026-10-07T23:59" });
    expect(parsed.publishAt.toISOString()).toBe("2026-10-07T11:00:00.000Z");
    expect(parsed.expiresAt?.toISOString()).toBe("2026-10-07T15:59:00.000Z");
  });

  it("labels times in 12-hour format and rounds defaults to the 15-minute grid", () => {
    expect(timeLabel("00:00")).toBe("12:00 AM");
    expect(timeLabel("09:15")).toBe("9:15 AM");
    expect(timeLabel("12:30")).toBe("12:30 PM");
    expect(timeLabel("23:59")).toBe("11:59 PM");
    expect(roundDownToGrid("22:07")).toBe("22:00");
    expect(roundDownToGrid("09:44")).toBe("09:30");
  });
});

describe("announcement orientation", () => {
  it("must be chosen: portrait or landscape", () => {
    expect(announcementFieldsSchema.safeParse({ ...base }).success).toBe(false);
    expect(announcementFieldsSchema.safeParse({ ...base, orientation: "square" }).success).toBe(false);
    expect(announcementFieldsSchema.safeParse({ ...base, orientation: "landscape" }).success).toBe(true);
  });

  it("is saved on create and can be changed on edit", async () => {
    const deps = { repo: createDemoRepository(admin.id), storage: createDemoImageStorage() };
    const created = await createAnnouncement(form({ ...base, orientation: "landscape" }), admin, deps);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await deps.repo.getAnnouncement(created.data.id))?.orientation).toBe("landscape");

    const updated = await updateAnnouncement(form({ ...base, id: created.data.id, orientation: "portrait" }, false), admin, deps);
    expect(updated.ok).toBe(true);
    expect((await deps.repo.getAnnouncement(created.data.id))?.orientation).toBe("portrait");
  });

  it("rejects a missing orientation with a field error", async () => {
    const deps = { repo: createDemoRepository(admin.id), storage: createDemoImageStorage() };
    const result = await createAnnouncement(form(base), admin, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.orientation).toBe("Choose portrait or landscape.");
  });
});
