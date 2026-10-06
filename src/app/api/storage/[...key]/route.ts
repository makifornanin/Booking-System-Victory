import { getCurrentUser } from "@/lib/auth/session";
import { getRepository, STORAGE_KEY_PATTERN } from "@/lib/data";
import { ConfigError, getStorageMode } from "@/lib/env";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Serves images from the private bucket to signed-in users. Members only get
 * announcement posters that are currently live; admins can see drafts too.
 */
export async function GET(_request: Request, context: RouteContext<"/api/storage/[...key]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401 });

  const key = (await context.params).key.join("/");
  if (!STORAGE_KEY_PATTERN.test(key) || key.includes("..")) return notFound();

  if (key.startsWith("announcements/") && user.role !== "admin") {
    const announcement = await (await getRepository()).findAnnouncementByImagePath(key);
    if (!announcement) return notFound();
  }

  let mode;
  try {
    mode = getStorageMode();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[config] ${error.message}`);
      return new Response("Storage is not configured", { status: 503 });
    }
    throw error;
  }

  if (mode === "demo") {
    const { getDemoState } = await import("@/lib/demo/store");
    const file = getDemoState().files.get(key);
    if (!file) return notFound();
    return new Response(Buffer.from(file.bytes), {
      headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  }

  const { signedReadUrl } = await import("@/lib/storage/s3");
  return new Response(null, {
    status: 302,
    headers: { Location: await signedReadUrl(key, 300), "Cache-Control": "private, max-age=240" },
  });
}
