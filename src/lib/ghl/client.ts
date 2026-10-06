import "server-only";
import type { z } from "zod";
import { getGhlEnv } from "@/lib/env";
import { GhlError } from "@/lib/ghl/errors";

const BASE_URL = "https://services.leadconnectorhq.com";

export const GHL_API_VERSION = {
  calendars: "2021-04-15",
  contacts: "2021-07-28",
} as const;

interface GhlRequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  version: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  schema: z.ZodType<T>;
  timeoutMs?: number;
}

function extractMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message: unknown }).message;
    if (Array.isArray(message)) return message.filter((m) => typeof m === "string").join("; ");
    if (typeof message === "string") return message;
  }
  return "Request was not accepted.";
}

/** Single entry point for HighLevel API calls. Server-only; the token never leaves this module. */
export async function ghlRequest<T>(path: string, options: GhlRequestOptions<T>): Promise<T> {
  const { GHL_PRIVATE_INTEGRATION_TOKEN } = getGhlEnv();
  const url = new URL(path, BASE_URL);
  const isWrite = (options.method ?? "GET") !== "GET";
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${GHL_PRIVATE_INTEGRATION_TOKEN}`,
        Version: options.version,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "network error";
    console.error(`[ghl] ${options.method ?? "GET"} ${url.pathname} ${reason}`);
    throw new GhlError("unavailable", `GHL request ${reason}.`, undefined, isWrite);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message = extractMessage(payload);
    console.error(`[ghl] ${options.method ?? "GET"} ${url.pathname} -> HTTP ${response.status}: ${message}`);
    if (response.status === 401 || response.status === 403) throw new GhlError("auth", message, response.status);
    if (response.status === 404) throw new GhlError("not_found", message, response.status);
    if (response.status === 429) throw new GhlError("rate_limited", message, response.status);
    if (response.status === 400 || response.status === 422) throw new GhlError("rejected", message, response.status);
    throw new GhlError("unavailable", message, response.status, isWrite && response.status >= 500);
  }

  const parsed = options.schema.safeParse(payload);
  if (!parsed.success) {
    console.error(`[ghl] ${options.method ?? "GET"} ${url.pathname} returned an unexpected shape`);
    throw new GhlError("invalid_response", "Unexpected response from GHL.");
  }
  return parsed.data;
}
