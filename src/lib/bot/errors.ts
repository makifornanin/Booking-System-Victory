/** Machine-readable outcomes for the n8n booking assistant. n8n/OpenAI writes the actual reply. */
export type BotErrorCode =
  | "UNAUTHORIZED_BOT"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "INVALID_INPUT"
  | "INVALID_PHONE"
  | "USER_NOT_FOUND"
  | "ACCOUNT_PENDING"
  | "ACCOUNT_DENIED"
  | "ACCOUNT_REVOKED"
  | "PHONE_AMBIGUOUS"
  | "ROOM_NOT_FOUND"
  | "ROOM_AMBIGUOUS"
  | "ROOM_UNAVAILABLE"
  | "INVALID_DATE"
  | "AMBIGUOUS_DATE"
  | "INVALID_TIME"
  | "OUTSIDE_BOOKING_HOURS"
  | "BOOKING_TOO_FAR_AHEAD"
  | "INVALID_DURATION"
  | "ATTENDEES_EXCEED_CAPACITY"
  | "TIME_UNAVAILABLE"
  | "BOOKING_CONFLICT"
  | "TOO_MANY_PENDING"
  | "GOOGLE_CALENDAR_REQUIRED"
  | "DUPLICATE_MESSAGE"
  | "BOOKING_NOT_FOUND"
  | "GHL_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface BotFailure {
  ok: false;
  code: BotErrorCode;
  /** Plain-English context for the AI; never shown verbatim to the member. */
  message: string;
  /** True when the bot should ask the member a follow-up question. */
  requiresClarification?: boolean;
  /** True when the same request may succeed if tried again later. */
  retryable?: boolean;
  [key: string]: unknown;
}

export type BotSuccess = { ok: true; code?: string } & Record<string, unknown>;
export type BotResponse = BotSuccess | BotFailure;

export function botError(code: BotErrorCode, message: string, extra: Record<string, unknown> = {}): BotFailure {
  return { ok: false, code, message, ...extra };
}

export function isBotFailure(value: unknown): value is BotFailure {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}
