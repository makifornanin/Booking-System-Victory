import "server-only";
import { z } from "zod";
import { cleanPassage, referenceForDate } from "@/lib/verse/references";

export interface DailyVerse {
  reference: string;
  /** Null when the ESV API couldn't be reached and nothing is cached. */
  text: string | null;
}

export interface VerseStore {
  get(dateKey: string): Promise<DailyVerse | null>;
  put(dateKey: string, verse: { reference: string; text: string }): Promise<void>;
}

export type VerseFetcher = (reference: string) => Promise<string>;

const esvSchema = z.object({ passages: z.array(z.string()).min(1) });

/** Official ESV API (api.esv.org), plain text without headings, numbers or footnotes. */
export function createEsvFetcher(apiKey: string): VerseFetcher {
  return async (reference) => {
    const url = new URL("https://api.esv.org/v3/passage/text/");
    url.search = new URLSearchParams({
      q: reference,
      "include-passage-references": "false",
      "include-verse-numbers": "false",
      "include-first-verse-numbers": "false",
      "include-footnotes": "false",
      "include-footnote-body": "false",
      "include-headings": "false",
      "include-short-copyright": "false",
      "include-selahs": "false",
      "indent-paragraphs": "0",
      "indent-poetry": "false",
    }).toString();
    const response = await fetch(url, { headers: { Authorization: `Token ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`ESV API responded ${response.status}`);
    const parsed = esvSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Unexpected ESV API response");
    const text = cleanPassage(parsed.data.passages[0]);
    if (!text) throw new Error("Empty ESV passage");
    return text;
  };
}

const globalForVerse = globalThis as typeof globalThis & { __victoryVerse?: Map<string, DailyVerse> };

/**
 * Verse for a church-local date. Order: in-memory cache → shared store (one ESV
 * call per day across servers) → ESV API → reference-only fallback.
 */
export async function getVerseForDate(dateKey: string, deps: { store: VerseStore | null; fetchVerse: VerseFetcher | null }): Promise<DailyVerse> {
  const memory = (globalForVerse.__victoryVerse ??= new Map());
  const cached = memory.get(dateKey);
  if (cached?.text) return cached;

  const reference = referenceForDate(dateKey);
  const stored = await deps.store?.get(dateKey).catch(() => null);
  if (stored?.text) {
    memory.set(dateKey, stored);
    return stored;
  }

  if (deps.fetchVerse) {
    try {
      const text = await deps.fetchVerse(reference);
      const verse = { reference, text };
      memory.set(dateKey, verse);
      await deps.store?.put(dateKey, verse).catch(() => undefined);
      return verse;
    } catch (error) {
      console.error("[verse] ESV request failed:", error instanceof Error ? error.message : error);
    }
  }
  return { reference, text: null };
}
