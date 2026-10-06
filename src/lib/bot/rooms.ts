import type { Room } from "@/lib/data/types";
import { botError, type BotFailure } from "@/lib/bot/errors";

/** "Event's Place - A" → "events place a"; apostrophes vanish, other punctuation becomes spaces. */
export function normalizeRoomText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every way a member might name a room: full name, slug, "a" for "Room A", "event place a". */
export function roomAliases(room: Pick<Room, "name" | "slug">): string[] {
  const aliases = new Set<string>();
  for (const base of [normalizeRoomText(room.name), normalizeRoomText(room.slug.replace(/-/g, " "))]) {
    if (!base) continue;
    aliases.add(base);
    aliases.add(base.replace(/\bevents\b/g, "event"));
    const letter = /^room ([a-z0-9]+)$/.exec(base);
    if (letter) aliases.add(letter[1]);
  }
  return [...aliases];
}

const containsPhrase = (haystack: string, phrase: string) => ` ${haystack} `.includes(` ${phrase} `);

/**
 * Deterministic room lookup from what the member typed. Exact alias first, then
 * the longest alias contained in the text, then a unique prefix. Never guesses
 * between rooms: ties return ROOM_AMBIGUOUS with the candidates.
 */
export function resolveRoom<R extends Pick<Room, "name" | "slug">>(query: unknown, rooms: R[]): { ok: true; room: R } | BotFailure {
  const choices = rooms.map((room) => room.name);
  const text = typeof query === "string" ? normalizeRoomText(query) : "";
  if (!text) return botError("ROOM_NOT_FOUND", "Say which room (for example 'Room A').", { requiresClarification: true, choices });

  const indexed = rooms.map((room) => ({ room, aliases: roomAliases(room) }));
  const unique = (matches: R[]) => [...new Set(matches)];

  const exact = unique(indexed.filter(({ aliases }) => aliases.includes(text)).map(({ room }) => room));
  if (exact.length === 1) return { ok: true, room: exact[0] };

  let best = 0;
  let contained: R[] = [];
  for (const { room, aliases } of indexed) {
    for (const alias of aliases) {
      // Single letters ("a") only count as an exact answer, never inside a sentence ("a room").
      if (alias.length < 2 || !containsPhrase(text, alias)) continue;
      if (alias.length > best) {
        best = alias.length;
        contained = [room];
      } else if (alias.length === best && !contained.includes(room)) {
        contained.push(room);
      }
    }
  }
  if (contained.length === 1) return { ok: true, room: contained[0] };
  if (contained.length > 1) {
    return botError("ROOM_AMBIGUOUS", "More than one room matches. Ask which one.", { requiresClarification: true, choices: contained.map((room) => room.name) });
  }

  const prefixed = unique(indexed.filter(({ aliases }) => text.length >= 3 && aliases.some((alias) => alias.startsWith(text))).map(({ room }) => room));
  if (prefixed.length === 1) return { ok: true, room: prefixed[0] };
  if (prefixed.length > 1) {
    return botError("ROOM_AMBIGUOUS", "More than one room matches. Ask which one.", { requiresClarification: true, choices: prefixed.map((room) => room.name) });
  }

  return botError("ROOM_NOT_FOUND", `No room called "${String(query).slice(0, 60)}".`, { requiresClarification: true, choices });
}
