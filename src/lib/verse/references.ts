/**
 * Curated verse references. Only references live here; the text always comes
 * from the official ESV API (never generated).
 */
export const VERSE_REFERENCES = [
  "John 15:5",
  "Psalm 46:10",
  "Proverbs 3:5-6",
  "Isaiah 40:31",
  "Matthew 11:28",
  "Romans 8:28",
  "Philippians 4:6-7",
  "Joshua 1:9",
  "Lamentations 3:22-23",
  "Psalm 23:1",
  "Matthew 28:19-20",
  "2 Corinthians 5:17",
  "Galatians 2:20",
  "Ephesians 2:8-9",
  "Hebrews 10:24-25",
  "1 Peter 5:7",
  "Psalm 119:105",
  "Micah 6:8",
  "Romans 12:2",
  "Colossians 3:23",
  "Isaiah 41:10",
  "John 13:34-35",
  "Psalm 133:1",
  "Acts 2:42",
  "James 1:5",
  "Romans 15:13",
  "Psalm 37:4",
  "1 Thessalonians 5:16-18",
  "Hebrews 12:1-2",
  "Matthew 5:16",
  "John 14:27",
  "Psalm 27:1",
  "2 Timothy 1:7",
  "Ephesians 4:2-3",
  "Zephaniah 3:17",
  "Psalm 90:12",
  "Mark 10:45",
  "1 John 4:19",
  "Romans 5:8",
  "Philippians 1:6",
] as const;

/** Same reference for everyone on a given church-local date; changes daily. */
export function referenceForDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return VERSE_REFERENCES[((dayNumber % VERSE_REFERENCES.length) + VERSE_REFERENCES.length) % VERSE_REFERENCES.length];
}

/** Collapses ESV's whitespace and line breaks into readable prose. */
export function cleanPassage(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function esvReadingUrl(reference: string): string {
  return `https://www.esv.org/${encodeURIComponent(reference).replace(/%20/g, "+")}/`;
}
