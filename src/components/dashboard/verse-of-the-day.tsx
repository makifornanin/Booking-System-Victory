import { ArrowUpRight } from "lucide-react";
import type { DailyVerse } from "@/lib/verse";
import { esvReadingUrl } from "@/lib/verse/references";

/** Its own quiet section: a label column beside the verse, set as a serif pull-quote with the ESV attribution. */
export function VerseOfTheDay({ verse }: { verse: DailyVerse }) {
  return (
    <section aria-labelledby="verse-heading" className="grid gap-4 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-3">
        <h2 id="verse-heading" className="eyebrow text-muted">
          Verse of the Day
        </h2>
      </div>
      <figure className="max-w-3xl lg:col-span-9">
        {verse.text ? (
          <>
            <blockquote>
              <p className="font-serif text-[1.4rem] leading-[1.45] text-ink italic sm:text-[1.65rem]">
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
          <>
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
          </>
        )}
      </figure>
    </section>
  );
}
