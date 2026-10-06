"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import {
  createAnnouncement,
  deleteAnnouncement,
  setAnnouncementPublished,
  updateAnnouncement,
} from "@/lib/services/announcements";
import { getAnnouncementDeps } from "@/lib/services/deps";
import type { ServiceResult } from "@/lib/services/result";

export type AnnouncementActionState = ServiceResult<unknown> | null;

function revalidateAnnouncementViews() {
  revalidatePath("/admin/announcements");
  revalidatePath("/dashboard");
}

export async function createAnnouncementAction(_prev: AnnouncementActionState, formData: FormData): Promise<AnnouncementActionState> {
  const result = await createAnnouncement(formData, await getCurrentUser(), await getAnnouncementDeps());
  if (result.ok) revalidateAnnouncementViews();
  return result;
}

export async function updateAnnouncementAction(_prev: AnnouncementActionState, formData: FormData): Promise<AnnouncementActionState> {
  const result = await updateAnnouncement(formData, await getCurrentUser(), await getAnnouncementDeps());
  if (result.ok) revalidateAnnouncementViews();
  return result;
}

export async function setAnnouncementPublishedAction(id: string, publish: boolean): Promise<ServiceResult> {
  const result = await setAnnouncementPublished(
    { id, publish: String(publish) },
    await getCurrentUser(),
    await getAnnouncementDeps(),
  );
  if (result.ok) revalidateAnnouncementViews();
  return result;
}

export async function deleteAnnouncementAction(id: string): Promise<ServiceResult> {
  const result = await deleteAnnouncement({ id }, await getCurrentUser(), await getAnnouncementDeps());
  if (result.ok) revalidateAnnouncementViews();
  return result;
}
