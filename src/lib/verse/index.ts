import "server-only";
import { cache } from "react";
import { dateKeyInZone } from "@/lib/domain/time";
import { getDataMode, getEsvApiKey } from "@/lib/env";
import { createEsvFetcher, getVerseForDate, type DailyVerse, type VerseStore } from "@/lib/verse/service";

export type { DailyVerse };

const postgresStore: VerseStore = {
  async get(dateKey) {
    const { systemQuery } = await import("@/lib/db/client");
    const rows = await systemQuery<{ reference: string; passage: string }>("select reference, passage from public.daily_verses where verse_date = $1", [dateKey]);
    return rows[0] ? { reference: rows[0].reference, text: rows[0].passage } : null;
  },
  async put(dateKey, verse) {
    const { systemQuery } = await import("@/lib/db/client");
    await systemQuery(
      "insert into public.daily_verses (verse_date, reference, passage) values ($1, $2, $3) on conflict (verse_date) do nothing",
      [dateKey, verse.reference, verse.text],
    );
  },
};

/** Today's verse (church time zone), memoized per request. */
export const getVerseOfTheDay = cache(async (): Promise<DailyVerse> => {
  const apiKey = getEsvApiKey();
  return getVerseForDate(dateKeyInZone(new Date()), {
    store: getDataMode() === "neon" ? postgresStore : null,
    fetchVerse: apiKey ? createEsvFetcher(apiKey) : null,
  });
});
