import { ArrowUpRight } from "lucide-react";
import type { DailyVerse } from "@/lib/verse";
import { esvReadingUrl } from "@/lib/verse/references";
import { cn } from "@/lib/utils";

/** Scripture set like a pull-quote: serif italic text, a quiet rule and the ESV attribution. */
export function VerseOfTheDay({ verse, className }: { verse: DailyVerse; className?: string }) {
  return (
    <figure className={cn("relative border-t-2 border-ink pt-5", className)} aria-labelledby="verse-label">
      <p id="verse-label" className="eyebrow text-muted">
        Verse of the day
      </p>
      {verse.text ? (
        <>
          <blockquote className="mt-4">
            <p className="font-serif text-[1.35rem] leading-[1.45] text-ink italic sm:text-[1.5rem]">
              <span className="text-accent-ink" aria-hidden>
                “
              </span>
              {verse.text}
              <span className="text-accent-ink" aria-hidden>
                ”
              </span>
            </p>
          </blockquote>
          <figcaption className="mt-4 text-sm font-bold text-ink-soft">
            {verse.reference} <span className="font-semibold text-muted">· ESV</span>
          </figcaption>
        </>
      ) : (
        <div className="mt-4">
          <p className="font-serif text-2xl text-ink">{verse.reference}</p>
          <a
            href={esvReadingUrl(verse.reference)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-brand underline-offset-4 hover:underline"
          >
            Read today&apos;s verse on ESV.org
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </div>
      )}
    </figure>
  );
}
