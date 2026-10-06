import "server-only";
import { connection } from "next/server";
import type { ImageStorage, Repository } from "@/lib/data/repository";
import { getDataMode, getStorageMode } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";

/** Repository acting for the signed-in user (or for nobody, in which case RLS returns nothing). */
export async function getRepository(): Promise<Repository> {
  await connection();
  if (getDataMode() === "demo") {
    const { createDemoRepository } = await import("@/lib/demo/repository");
    return createDemoRepository((await getCurrentUser())?.id ?? null);
  }
  const [{ createPostgresRepository }, user] = await Promise.all([import("@/lib/data/postgres/repository"), getCurrentUser()]);
  return createPostgresRepository(user?.id ?? null);
}

export async function getImageStorage(): Promise<ImageStorage> {
  await connection();
  if (getStorageMode() === "demo") {
    const { createDemoImageStorage } = await import("@/lib/demo/repository");
    return createDemoImageStorage();
  }
  const { createS3ImageStorage } = await import("@/lib/storage/s3");
  return createS3ImageStorage();
}

export const STORAGE_KEY_PATTERN = /^(announcements|rooms|maps)\/[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/**
 * URL for a stored image. Objects live in a private bucket, so the browser goes
 * through /api/storage, which checks the session and redirects to a signed URL.
 */
export function imageUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("demo/")) return `/${path}`;
  return `/api/storage/${path.split("/").map(encodeURIComponent).join("/")}`;
}
