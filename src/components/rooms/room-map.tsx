import Image from "next/image";
import { cn } from "@/lib/utils";
import { roomShortName } from "@/components/rooms/room-image";

export interface MapRoom {
  id: string;
  name: string;
  mapUrl: string | null;
}

// Placeholder layout positions (by display order) until real floor plans are uploaded.
const BOXES = [
  { x: 16, y: 16, w: 132, h: 92 },
  { x: 156, y: 16, w: 112, h: 92 },
  { x: 276, y: 16, w: 108, h: 92 },
  { x: 16, y: 152, w: 112, h: 92 },
  { x: 136, y: 152, w: 132, h: 92 },
];

const label = (name: string) => (/event/i.test(name) ? "EP" : roomShortName(name));

/** Shows the room's uploaded map, or a schematic highlighting where the room is. */
export function RoomMap({ rooms, activeId, className }: { rooms: MapRoom[]; activeId: string; className?: string }) {
  const active = rooms.find((room) => room.id === activeId);

  if (active?.mapUrl) {
    return (
      <div className={cn("relative aspect-[400/260] overflow-hidden bg-surface", className)}>
        <Image src={active.mapUrl} alt={`Map showing where ${active.name} is`} fill sizes="480px" unoptimized={!active.mapUrl.startsWith("https://")} className="object-contain" />
      </div>
    );
  }

  return (
    <svg viewBox="0 0 400 260" role="img" aria-label={active ? `Where ${active.name} is on the floor` : "Floor layout"} className={cn("w-full bg-surface", className)}>
      <rect x="8" y="8" width="384" height="244" rx="3" fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" />
      <rect x="8" y="116" width="384" height="28" fill="var(--color-canvas)" />
      <text x="200" y="134" textAnchor="middle" fontSize="9" fontWeight="800" letterSpacing="2.5" fill="var(--color-subtle)">
        HALLWAY
      </text>
      <rect x="276" y="152" width="108" height="92" rx="2" fill="var(--color-canvas)" stroke="var(--color-line)" />
      <text x="330" y="202" textAnchor="middle" fontSize="9" fontWeight="800" letterSpacing="2.5" fill="var(--color-subtle)">
        LOBBY
      </text>
      {rooms.slice(0, BOXES.length).map((room, index) => {
        const box = BOXES[index];
        const isActive = room.id === activeId;
        return (
          <g key={room.id}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx="2"
              fill={isActive ? "var(--color-brand)" : "var(--color-surface)"}
              stroke={isActive ? "var(--color-brand)" : "var(--color-line-strong)"}
              strokeWidth={isActive ? 2 : 1.25}
              className="transition-colors duration-300"
            />
            <text x={box.x + box.w / 2} y={box.y + box.h / 2 + 7} textAnchor="middle" fontSize="20" fontFamily="var(--font-serif)" fill={isActive ? "#fff" : "var(--color-muted)"}>
              {label(room.name)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
