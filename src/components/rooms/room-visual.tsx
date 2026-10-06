"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoomImage } from "@/components/rooms/room-image";
import { RoomMap, type MapRoom } from "@/components/rooms/room-map";

/** Room hero: photo with a "Photo / Floor map" switch that works the same on touch and desktop. */
export function RoomVisual({
  roomName,
  roomId,
  photoUrl,
  mapRooms,
  locationLabel,
}: {
  roomName: string;
  roomId: string;
  photoUrl: string | null;
  mapRooms: MapRoom[];
  locationLabel: string;
}) {
  const [view, setView] = useState<"photo" | "map">("photo");
  return (
    <figure>
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg ring-1 ring-line sm:aspect-[16/11]">
        <RoomImage name={roomName} url={photoUrl} eager sizes="(min-width: 1024px) 680px, 100vw" className={cn("absolute inset-0 transition-opacity duration-500", view === "map" && "opacity-0")} />
        <div className={cn("absolute inset-0 flex items-center bg-surface p-6 transition-opacity duration-500", view === "photo" ? "pointer-events-none opacity-0" : "opacity-100")} aria-hidden={view === "photo"}>
          <RoomMap rooms={mapRooms} activeId={roomId} />
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <MapPin className="size-4" aria-hidden />
          {locationLabel}
        </span>
        <div role="group" aria-label="Room view" className="inline-flex rounded-md bg-sunken p-0.5 text-[13px] font-bold">
          {(["photo", "map"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={cn("rounded-[5px] px-3 py-1.5 transition-colors", view === option ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
            >
              {option === "photo" ? "Photo" : "Floor map"}
            </button>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}
