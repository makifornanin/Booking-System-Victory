import type { Metadata } from "next";
import Image from "next/image";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { imageUrl } from "@/lib/data";
import { getRepositoryForRequest } from "@/lib/data/queries";
import { announcementStatus, type AnnouncementStatus } from "@/lib/domain/announcements";
import { formatDate, toLocalDateTimeInput } from "@/lib/domain/time";
import { firstParam } from "@/lib/validation/params";
import { AnnouncementForm } from "@/components/announcements/announcement-form";
import { AnnouncementRowActions } from "@/components/announcements/announcement-row-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { AnnouncementStatusMark } from "@/components/ui/status";

export const metadata: Metadata = { title: "Announcements" };

const filters = ["all", "published", "scheduled", "draft", "expired"] as const;
const filterSchema = z.enum(filters).catch("all");
const filterLabels: Record<(typeof filters)[number], string> = {
  all: "All",
  published: "Published",
  scheduled: "Scheduled",
  draft: "Drafts",
  expired: "Expired",
};

export default async function AdminAnnouncementsPage({ searchParams }: PageProps<"/admin/announcements">) {
  await requireAdmin();
  const filter = filterSchema.parse(firstParam((await searchParams).status));
  const now = new Date();
  const all = (await (await getRepositoryForRequest()).listAllAnnouncements()).map((item) => ({
    ...item,
    status: announcementStatus(item, now) as AnnouncementStatus,
    imageUrl: imageUrl(item.imagePath) ?? "",
  }));
  const counts = Object.fromEntries(filters.map((f) => [f, f === "all" ? all.length : all.filter((a) => a.status === f).length]));
  const list = filter === "all" ? all : all.filter((a) => a.status === filter);
  const defaultPublishAt = toLocalDateTimeInput(now);

  return (
    <div>
      <PageHeader variant="operational" title="Announcements" description="Posters appear in the member bulletin between their publish and expiry dates. The newest live poster is featured." />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="list-heading" className="min-w-0">
          <h2 id="list-heading" className="sr-only">
            All announcements
          </h2>
          <LinkTabs
            label="Filter announcements"
            tabs={filters.map((f) => ({
              href: f === "all" ? "/admin/announcements" : `/admin/announcements?status=${f}`,
              label: filterLabels[f],
              count: counts[f],
              active: f === filter,
            }))}
          />
          {list.length === 0 ? (
            <EmptyState className="mt-10" title="No announcements here" description="Upload a poster with the form to get started." />
          ) : (
            <ul className="divide-y divide-line border-b border-line">
              {list.map((item) => (
                <li key={item.id} className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-2 py-4 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center">
                  <a
                    href={item.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`relative mx-auto block overflow-hidden rounded-sm bg-sunken ring-1 ring-line ${item.orientation === "landscape" ? "aspect-video w-full" : "aspect-[4/5] w-16 sm:w-[4.5rem]"}`}
                    aria-label={`Open poster: ${item.internalTitle}`}
                  >
                    {item.imageUrl && <Image src={item.imageUrl} alt="" fill sizes="96px" unoptimized={!item.imageUrl.startsWith("https://")} className="object-cover" />}
                  </a>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-3">
                      <AnnouncementStatusMark status={item.status} />
                      <span className="text-xs font-semibold text-muted">{item.orientation === "landscape" ? "Landscape 16:9" : "Portrait 4:5"}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[15px] font-extrabold">{item.internalTitle}</p>
                    <p className="text-[13px] text-muted tabular-nums">
                      {formatDate(item.publishAt, "d MMM yyyy, h:mm a")} → {item.expiresAt ? formatDate(item.expiresAt, "d MMM yyyy, h:mm a") : "no expiry"}
                    </p>
                  </div>
                  <div className="col-start-2 -ml-3 sm:col-start-auto sm:ml-0">
                    <AnnouncementRowActions
                      defaultPublishAt={defaultPublishAt}
                      values={{
                        id: item.id,
                        internalTitle: item.internalTitle,
                        orientation: item.orientation,
                        publishAt: toLocalDateTimeInput(item.publishAt),
                        expiresAt: item.expiresAt ? toLocalDateTimeInput(item.expiresAt) : "",
                        isPublished: item.isPublished,
                        imageUrl: item.imageUrl,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="new-heading" className="lg:sticky lg:top-8 lg:self-start">
          <h2 id="new-heading" className="border-b border-ink pb-2.5 text-[15px] font-extrabold">
            New announcement
          </h2>
          <div className="mt-5">
            <AnnouncementForm defaultPublishAt={defaultPublishAt} />
          </div>
        </section>
      </div>
    </div>
  );
}
