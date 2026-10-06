"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Poster {
  id: string;
  title: string;
  url: string;
}

const canOptimize = (url: string) => url.startsWith("https://");

function PosterTile({ poster, onOpen, sizes, eager, className }: { poster: Poster; onOpen: () => void; sizes: string; eager?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative block aspect-[4/5] w-full overflow-hidden rounded-md bg-sunken text-left ring-1 ring-line transition-[box-shadow,transform] duration-300 ease-out",
        "hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgb(22_24_29/0.45)] focus-visible:-translate-y-0.5",
        className,
      )}
      aria-label={`View poster: ${poster.title}`}
    >
      <Image
        src={poster.url}
        alt={poster.title}
        fill
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        unoptimized={!canOptimize(poster.url)}
        className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
      />
    </button>
  );
}

/**
 * Bulletin composition: the newest poster is featured large; the next ones sit
 * beside it (with an optional aside such as the verse); the rest follow in a grid.
 */
export function PosterBoard({ posters, aside }: { posters: Poster[]; aside?: ReactNode }) {
  const [active, setActive] = useState<Poster | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [featured, ...rest] = posters;
  const beside = rest.slice(0, 2);
  const below = rest.slice(2);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (active && !dialog.open) dialog.showModal();
    if (!active && dialog.open) dialog.close();
  }, [active]);

  return (
    <>
      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-12">
        {featured && (
          <div className="lg:col-span-7">
            <PosterTile poster={featured} onOpen={() => setActive(featured)} sizes="(min-width: 1024px) 620px, 100vw" eager />
          </div>
        )}
        <div className={cn("flex flex-col gap-10", featured ? "lg:col-span-5" : "lg:col-span-12")}>
          {aside}
          {beside.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {beside.map((poster) => (
                <PosterTile key={poster.id} poster={poster} onOpen={() => setActive(poster)} sizes="(min-width: 1024px) 220px, 50vw" eager />
              ))}
            </div>
          )}
        </div>
      </div>

      {below.length > 0 && (
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {below.map((poster) => (
            <PosterTile key={poster.id} poster={poster} onOpen={() => setActive(poster)} sizes="(min-width: 1024px) 270px, 50vw" />
          ))}
        </div>
      )}

      <dialog
        ref={dialogRef}
        onClose={() => setActive(null)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setActive(null);
        }}
        aria-label={active ? `Poster: ${active.title}` : "Poster"}
        className="m-auto max-h-[92vh] max-w-[min(92vw,760px)] overflow-visible bg-transparent p-0 backdrop:bg-ink/85"
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
            {/* Natural size in the viewer so no poster text is cropped. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt={active.title} className="max-h-[86vh] w-auto rounded-md object-contain" />
          </div>
        )}
      </dialog>
    </>
  );
}
