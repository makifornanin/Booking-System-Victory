export type AnnouncementStatus = "draft" | "scheduled" | "published" | "expired";

export interface AnnouncementTiming {
  isPublished: boolean;
  publishAt: string;
  expiresAt: string | null;
}

export function announcementStatus(item: AnnouncementTiming, now: Date): AnnouncementStatus {
  const nowMs = now.getTime();
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= nowMs) return "expired";
  if (!item.isPublished) return "draft";
  if (new Date(item.publishAt).getTime() > nowMs) return "scheduled";
  return "published";
}

export function isLive(item: AnnouncementTiming, now: Date): boolean {
  return announcementStatus(item, now) === "published";
}

/** Live announcements, newest first. The first one is the featured poster. */
export function selectLiveAnnouncements<T extends AnnouncementTiming>(items: T[], now: Date): T[] {
  return items
    .filter((item) => isLive(item, now))
    .sort((a, b) => new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime());
}
