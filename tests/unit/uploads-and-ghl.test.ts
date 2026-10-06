import { describe, expect, it } from "vitest";
import { parseFreeSlots } from "@/lib/ghl/calendars";
import { safeImagePath, sniffImageType, validateImageUpload } from "@/lib/storage/images";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe("image upload validation", () => {
  it("recognises JPEG, PNG and WebP by magic bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe("image/png");
    expect(sniffImageType(ascii("RIFF\0\0\0\0WEBPVP8 "))?.mime).toBe("image/webp");
  });

  it("rejects SVG and HTML even when named like images", async () => {
    expect(sniffImageType(ascii("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    const disguised = new File([ascii("<html><script>alert(1)</script></html>")], "poster.png", { type: "image/png" });
    expect(await validateImageUpload(disguised)).toEqual({ ok: false, error: "Upload a JPG, PNG or WebP image." });
  });

  it("rejects missing and oversized files", async () => {
    expect((await validateImageUpload(null)).ok).toBe(false);
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    expect(await validateImageUpload(big)).toMatchObject({ ok: false });
  });

  it("generates random paths that ignore the original file name", () => {
    const path = safeImagePath("posters", "png", new Date("2030-03-01T00:00:00Z"));
    expect(path).toMatch(/^posters\/2030\/03\/[0-9a-f-]{36}\.png$/);
  });
});

describe("GHL free-slot parsing", () => {
  it("collects slots from date keys and ignores metadata", () => {
    const payload = {
      "2030-03-12": { slots: ["2030-03-12T09:00:00+08:00", "2030-03-12T09:30:00+08:00"] },
      "2030-03-13": { slots: ["2030-03-13T10:00:00+08:00"] },
      traceId: "abc-123",
      "2030-03-14": { unexpected: true },
    };
    expect(parseFreeSlots(payload)).toEqual([
      "2030-03-12T09:00:00+08:00",
      "2030-03-12T09:30:00+08:00",
      "2030-03-13T10:00:00+08:00",
    ]);
  });
});
