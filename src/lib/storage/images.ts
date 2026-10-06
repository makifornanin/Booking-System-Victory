import { IMAGE_MAX_BYTES } from "@/lib/config";

export type ImageType = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

/** Detects the real image type from magic bytes; the browser-supplied MIME type is not trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, i) => bytes[i] === byte)) {
    return { mime: "image/png", ext: "png" };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

export type ImageValidation =
  | { ok: true; bytes: Uint8Array; type: ImageType }
  | { ok: false; error: string };

export async function validateImageUpload(file: unknown): Promise<ImageValidation> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image to upload." };
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, error: `Images must be ${Math.round(IMAGE_MAX_BYTES / 1024 / 1024)} MB or smaller.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, error: "Upload a JPG, PNG or WebP image." };
  return { ok: true, bytes, type };
}

/** Random, non-guessable object path: never derived from the uploaded file name. */
export function safeImagePath(prefix: string, ext: ImageType["ext"], now = new Date()): string {
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}/${month}/${crypto.randomUUID()}.${ext}`;
}
