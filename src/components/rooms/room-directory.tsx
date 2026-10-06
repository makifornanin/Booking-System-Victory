"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoomImage } from "@/components/rooms/room-image";
import { RoomMap, type MapRoom } from "@/components/rooms/room-map";

export interface DirectoryRoom extends MapRoom {
  slug: string;
  shortDescription: string;
  capacity: number;
  bestFor: string[];
  locationLabel: string;
  imageUrl: string | null;
}

/**
 * Editorial room index. Desktop: hovering or focusing a room crossfades its photo
 * into the floor map, revealing where it is. Touch: an explicit "View location" toggle.
 */
export function RoomDirectory({ rooms }: { rooms: DirectoryRoom[] }) {
  const [mapOpenId, setMapOpenId] = useState<string | null>(null);

  return (
    <ol className="border-t border-ink">
      {rooms.map((room, index) => {
        const mapOpen = mapOpenId === room.id;
        return (
          <li key={room.id} className="group relative border-b border-line">
            <div className="grid gap-6 py-8 sm:py-10 lg:grid-cols-12 lg:gap-10">
              <div className="flex gap-5 sm:gap-8 lg:col-span-7">
                <span className="w-8 shrink-0 pt-2 font-serif text-lg text-subtle tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="headline text-[2rem] sm:text-[2.6rem]">
                    <Link href={`/rooms/${room.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                      {room.name}
                    </Link>
                  </h2>
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">{room.shortDescription}</p>

                  <dl className="mt-6 grid max-w-md grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <dt className="eyebrow text-[10px] text-muted">Capacity</dt>
                      <dd className="mt-1 font-bold">Up to {room.capacity}</dd>
                    </div>
                    <div>
                      <dt className="eyebrow text-[10px] text-muted">Location</dt>
                      <dd className="mt-1 font-bold">{room.locationLabel}</dd>
                    </div>
                    {room.bestFor.length > 0 && (
                      <div className="col-span-2">
                        <dt className="eyebrow text-[10px] text-muted">Best for</dt>
                        <dd className="mt-1 text-ink-soft">{room.bestFor.join(" · ")}</dd>
                      </div>
                    )}
                  </dl>

                  <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                    <span className="inline-flex items-center gap-2 text-sm font-extrabold text-brand">
                      See availability
                      <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
                    </span>
                    <button
                      type="button"
                      onClick={() => setMapOpenId(mapOpen ? null : room.id)}
                      aria-expanded={mapOpen}
                      aria-controls={`room-visual-${room.id}`}
                      className="relative z-10 inline-flex items-center gap-1.5 text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline lg:hidden"
                    >
                      <MapPin className="size-4" aria-hidden />
                      {mapOpen ? "Show photo" : "View location"}
                    </button>
                  </div>
                </div>
              </div>

              <div id={`room-visual-${room.id}`} className="relative lg:col-span-5">
                <div className="relative aspect-[4/3] overflow-hidden rounded-md ring-1 ring-line">
                  <RoomImage
                    name={room.name}
                    url={room.imageUrl}
                    sizes="(min-width: 1024px) 440px, 100vw"
                    eager={index < 2}
                    className={cn(
                      "absolute inset-0 transition-opacity duration-500 ease-out lg:group-focus-within:opacity-0 lg:group-hover:opacity-0",
                      mapOpen && "opacity-0",
                    )}
                  />
                  <div
                    className={cn(
                      "absolute inset-0 flex flex-col justify-center bg-surface p-4 opacity-0 transition-opacity duration-500 ease-out lg:group-focus-within:opacity-100 lg:group-hover:opacity-100",
                      mapOpen && "opacity-100",
                    )}
                    aria-hidden={!mapOpen}
                  >
                    <RoomMap rooms={rooms} activeId={room.id} />
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-muted">
                      <MapPin className="size-3.5" aria-hidden />
                      {room.locationLabel}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
