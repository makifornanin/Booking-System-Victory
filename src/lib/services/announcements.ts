import type { SessionUser } from "@/lib/auth/provider";
import { RepositoryError, type ImageStorage, type Repository } from "@/lib/data/repository";
import type { Announcement } from "@/lib/data/types";
import { failure, fieldErrorsFrom, success, type ServiceResult } from "@/lib/services/result";
import { safeImagePath, validateImageUpload } from "@/lib/storage/images";
import {
  announcementFieldsSchema,
  announcementIdSchema,
  announcementPublishSchema,
} from "@/lib/validation/announcement";

export interface AnnouncementDeps {
  repo: Repository;
  storage: ImageStorage;
}

const PREFIX = "announcements";

function requireAdminActor(actor: SessionUser | null): ServiceResult<never> | null {
  if (!actor) return failure("unauthenticated", "Your session has expired. Please sign in again.");
  if (actor.role !== "admin" || actor.accessStatus !== "active") return failure("forbidden", "Only admins can manage announcements.");
  return null;
}

function dbFailure<T>(error: unknown, fallback: string): ServiceResult<T> {
  if (error instanceof RepositoryError && error.code === "forbidden") return failure("forbidden", error.message);
  if (error instanceof RepositoryError && error.code === "invalid") return failure("invalid", error.message);
  console.error("[announcements]", error instanceof Error ? error.message : error);
  return failure("unknown", fallback);
}

export async function createAnnouncement(
  formData: FormData,
  actor: SessionUser | null,
  deps: AnnouncementDeps,
): Promise<ServiceResult<{ id: string }>> {
  const denied = requireAdminActor(actor);
  if (denied) return denied;

  const fields = announcementFieldsSchema.safeParse({
    internalTitle: formData.get("internalTitle") ?? "",
    publishAt: formData.get("publishAt") ?? "",
    expiresAt: formData.get("expiresAt") ?? undefined,
    publish: formData.get("publish") ?? undefined,
  });
  const image = await validateImageUpload(formData.get("poster"));
  if (!fields.success || !image.ok) {
    return failure("invalid", "Please check the highlighted fields.", {
      ...(fields.success ? {} : fieldErrorsFrom(fields.error.issues)),
      ...(image.ok ? {} : { poster: image.error }),
    });
  }

  const path = safeImagePath(PREFIX, image.type.ext);
  try {
    await deps.storage.upload(path, image.bytes, image.type.mime);
  } catch {
    return failure("storage_error", "The poster couldn't be uploaded. Please try again.");
  }

  try {
    const created = await deps.repo.createAnnouncement(
      {
        internalTitle: fields.data.internalTitle,
        imagePath: path,
        publishAt: fields.data.publishAt.toISOString(),
        expiresAt: fields.data.expiresAt?.toISOString() ?? null,
        isPublished: fields.data.publish,
      },
      actor!.id,
    );
    return success({ id: created.id }, fields.data.publish ? "Announcement saved and published." : "Announcement saved as a draft.");
  } catch (error) {
    await deps.storage.remove(path);
    return dbFailure(error, "The announcement couldn't be saved. Please try again.");
  }
}

export async function updateAnnouncement(
  formData: FormData,
  actor: SessionUser | null,
  deps: AnnouncementDeps,
): Promise<ServiceResult> {
  const denied = requireAdminActor(actor);
  if (denied) return denied;

  const id = announcementIdSchema.safeParse({ id: formData.get("id") });
  if (!id.success) return failure("invalid", "Unknown announcement.");

  const fields = announcementFieldsSchema.safeParse({
    internalTitle: formData.get("internalTitle") ?? "",
    publishAt: formData.get("publishAt") ?? "",
    expiresAt: formData.get("expiresAt") ?? undefined,
    publish: formData.get("publish") ?? undefined,
  });
  const poster = formData.get("poster");
  const hasNewPoster = poster instanceof File && poster.size > 0;
  const image = hasNewPoster ? await validateImageUpload(poster) : null;

  if (!fields.success || (image && !image.ok)) {
    return failure("invalid", "Please check the highlighted fields.", {
      ...(fields.success ? {} : fieldErrorsFrom(fields.error.issues)),
      ...(image && !image.ok ? { poster: image.error } : {}),
    });
  }

  const existing = await deps.repo.getAnnouncement(id.data.id);
  if (!existing) return failure("not_found", "That announcement no longer exists.");

  let newPath: string | null = null;
  if (image?.ok) {
    newPath = safeImagePath(PREFIX, image.type.ext);
    try {
      await deps.storage.upload(newPath, image.bytes, image.type.mime);
    } catch {
      return failure("storage_error", "The new poster couldn't be uploaded. Please try again.");
    }
  }

  try {
    const updated = await deps.repo.updateAnnouncement(existing.id, {
      internalTitle: fields.data.internalTitle,
      publishAt: fields.data.publishAt.toISOString(),
      expiresAt: fields.data.expiresAt?.toISOString() ?? null,
      isPublished: fields.data.publish,
      ...(newPath ? { imagePath: newPath } : {}),
    });
    if (!updated) {
      if (newPath) await deps.storage.remove(newPath);
      return failure("not_found", "That announcement no longer exists.");
    }
    if (newPath) await removeStoredPoster(deps.storage, existing);
    return success(undefined, "Announcement updated.");
  } catch (error) {
    if (newPath) await deps.storage.remove(newPath);
    return dbFailure(error, "The announcement couldn't be updated. Please try again.");
  }
}

export async function setAnnouncementPublished(
  rawInput: unknown,
  actor: SessionUser | null,
  deps: Pick<AnnouncementDeps, "repo">,
): Promise<ServiceResult> {
  const denied = requireAdminActor(actor);
  if (denied) return denied;
  const parsed = announcementPublishSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown announcement.");

  try {
    const updated = await deps.repo.updateAnnouncement(parsed.data.id, { isPublished: parsed.data.publish });
    if (!updated) return failure("not_found", "That announcement no longer exists.");
    return success(undefined, parsed.data.publish ? "Announcement published." : "Announcement unpublished.");
  } catch (error) {
    return dbFailure(error, "The change couldn't be saved. Please try again.");
  }
}

export async function deleteAnnouncement(
  rawInput: unknown,
  actor: SessionUser | null,
  deps: AnnouncementDeps,
): Promise<ServiceResult> {
  const denied = requireAdminActor(actor);
  if (denied) return denied;
  const parsed = announcementIdSchema.safeParse(rawInput);
  if (!parsed.success) return failure("invalid", "Unknown announcement.");

  try {
    const removed = await deps.repo.deleteAnnouncement(parsed.data.id);
    if (!removed) return failure("not_found", "That announcement no longer exists.");
    await removeStoredPoster(deps.storage, removed);
    return success(undefined, "Announcement deleted.");
  } catch (error) {
    return dbFailure(error, "The announcement couldn't be deleted. Please try again.");
  }
}

async function removeStoredPoster(storage: ImageStorage, announcement: Announcement) {
  // Seeded demo posters live in /public and are not stored objects.
  if (!announcement.imagePath.startsWith("demo/")) {
    await storage.remove(announcement.imagePath);
  }
}
