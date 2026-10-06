"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import type { PosterOrientation } from "@/lib/data/types";
import { cn } from "@/lib/utils";

export interface Poster {
  id: string;
  title: string;
  url: string;
  orientation: PosterOrientation;
}

const canOptimize = (url: string) => url.startsWith("https://");

/**
 * Every poster shares one height per breakpoint, so widths follow from the ratio
 * (portrait 4:5, landscape 16:9): 400px tall on desktop (320 / 711 wide), 300px
 * on tablets, and a single column on phones (portrait ≤ 340px wide).
 */
const FRAME: Record<PosterOrientation, string> = {
  portrait: "aspect-[4/5] w-full max-w-[340px] sm:w-[240px] lg:w-[320px]",
  landscape: "aspect-video w-full sm:w-[533px] sm:max-w-full lg:w-[711px]",
};
const SIZES: Record<PosterOrientation, string> = {
  portrait: "(min-width: 1024px) 320px, (min-width: 640px) 240px, 340px",
  landscape: "(min-width: 1024px) 711px, (min-width: 640px) 533px, 100vw",
};

/** Posters at their natural size in an orientation-aware gallery row; a click opens the full poster. */
export function PosterBoard({ posters }: { posters: Poster[] }) {
  const [active, setActive] = useState<Poster | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (active && !dialog.open) dialog.showModal();
    if (!active && dialog.open) dialog.close();
  }, [active]);

  return (
    <>
      <ul className="flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:items-start sm:gap-5">
        {posters.map((poster, index) => (
          <li key={poster.id} className={cn("shrink-0", FRAME[poster.orientation])}>
            <button
              type="button"
              onClick={() => setActive(poster)}
              className={cn(
                "group relative block size-full overflow-hidden rounded-md bg-sunken ring-1 ring-line transition-[box-shadow,transform] duration-300 ease-out",
                "hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgb(22_24_29/0.45)] focus-visible:-translate-y-0.5",
              )}
              aria-label={`View poster: ${poster.title}`}
            >
              <Image
                src={poster.url}
                alt={poster.title}
                fill
                sizes={SIZES[poster.orientation]}
                loading={index < 3 ? "eager" : "lazy"}
                unoptimized={!canOptimize(poster.url)}
                className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
              />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        onClose={() => setActive(null)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setActive(null);
        }}
        aria-label={active ? `Poster: ${active.title}` : "Poster"}
        className="m-auto max-h-[92vh] max-w-[min(92vw,960px)] overflow-visible bg-transparent p-0 backdrop:bg-ink/85"
      >
        {active && (
          <div className="relative animate-fade-in">
            <button
              type="button"
              onClick={() => setActive(null)}
              className="absolute -top-11 right-0 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-bold text-white hover:bg-white/10"
            >
              <X className="size-4" aria-hidden />
              Close
            </button>
            {/* The full poster, uncropped, in the viewer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt={active.title} className="max-h-[86vh] w-auto rounded-md object-contain" />
          </div>
        )}
      </dialog>
    </>
  );
}
