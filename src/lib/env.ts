import "server-only";
import { z } from "zod";

import { ConfigError } from "@/lib/config-error";

export { ConfigError };

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const neonEnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, { error: "must be a postgres:// connection string" }),
  NEON_AUTH_BASE_URL: z.url({ protocol: /^https?$/ }),
});

const ghlEnvSchema = z.object({
  GHL_PRIVATE_INTEGRATION_TOKEN: z.string().min(10),
  GHL_LOCATION_ID: z.string().min(4),
  GHL_DENIAL_TAG: z.preprocess(blankToUndefined, z.string().min(1).default("room-booking-denied")),
  GHL_FIELD_BOOKING_ROOM_ID: optional(z.string().min(4)),
  GHL_FIELD_BOOKING_EVENT_ID: optional(z.string().min(4)),
  GHL_FIELD_BOOKING_DATE_ID: optional(z.string().min(4)),
  GHL_FIELD_BOOKING_TIME_ID: optional(z.string().min(4)),
  GHL_FIELD_BOOKING_DENIAL_REASON_ID: optional(z.string().min(4)),
  GHL_FIELD_ACCOUNT_ACCESS_REASON_ID: optional(z.string().min(4)),
  GHL_FIELD_ACCOUNT_STATUS_ID: optional(z.string().min(4)),
});

const googleEnvSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(10),
  GOOGLE_CLIENT_SECRET: z.string().min(10),
  GOOGLE_REDIRECT_URI: z.url({ protocol: /^https?$/ }),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().min(32, { error: "must be at least 32 characters" }),
});

const storageEnvSchema = z.object({
  AWS_ENDPOINT_URL_S3: z.url({ protocol: /^https?$/ }),
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_NAME: z.preprocess(blankToUndefined, z.string().min(3).optional()),
  STORAGE_BUCKET: z.preprocess(blankToUndefined, z.string().min(3).optional()),
});

const siteUrlSchema = z.url({ protocol: /^https?$/ });

export type GhlEnv = z.infer<typeof ghlEnvSchema>;
export type GoogleEnv = z.infer<typeof googleEnvSchema>;
export type StorageEnv = z.infer<typeof storageEnvSchema>;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function hasAny(...keys: string[]): boolean {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.path.join(".")).join(", ");
}

function parse<T extends z.ZodType>(schema: T, label: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new ConfigError(`Invalid or missing ${label} configuration: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

export type DataMode = "neon" | "demo";

/**
 * Demo mode is an in-memory adapter for local development and E2E tests. It can
 * never activate in production: production either has real config or fails.
 */
export function getDataMode(): DataMode {
  if (process.env.DEMO_MODE === "true") {
    if (isProduction()) {
      throw new ConfigError("DEMO_MODE is only available in development. Remove it from the production environment.");
    }
    return "demo";
  }

  if (hasAny("DATABASE_URL", "NEON_AUTH_BASE_URL")) {
    parse(neonEnvSchema, "Neon");
    return "neon";
  }

  if (!isProduction()) return "demo";
  throw new ConfigError("Missing Neon configuration. Set DATABASE_URL and NEON_AUTH_BASE_URL.");
}

export function getDatabaseUrl(): string {
  return parse(neonEnvSchema, "Neon").DATABASE_URL;
}

export type CalendarMode = "ghl" | "demo";

export function getCalendarMode(): CalendarMode {
  if (getDataMode() === "demo") return "demo";
  if (hasAny("GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_LOCATION_ID")) {
    parse(ghlEnvSchema, "GHL");
    return "ghl";
  }
  if (!isProduction()) return "demo";
  throw new ConfigError("Missing GHL configuration. Set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID.");
}

export function getGhlEnv(): GhlEnv {
  return parse(ghlEnvSchema, "GHL");
}

export type StorageMode = "s3" | "demo";

export function getStorageMode(): StorageMode {
  if (getDataMode() === "demo") return "demo";
  parse(storageEnvSchema, "object storage (AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)");
  return "s3";
}

export function getStorageEnv(): StorageEnv {
  return parse(storageEnvSchema, "object storage");
}

/**
 * Public base URL for links in auth emails. Required in production so links are
 * never built from a client-controlled Host header; development falls back to the request.
 */
export function getSiteUrl(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (raw) {
    const parsed = siteUrlSchema.safeParse(raw);
    if (!parsed.success) throw new ConfigError("Invalid SITE_URL. Use the full origin, e.g. https://rooms.example.org");
    return parsed.data.replace(/\/$/, "");
  }
  if (isProduction()) throw new ConfigError("Missing SITE_URL. Set it to the app's public origin so email links work.");
  return null;
}

export type GoogleMode = "google" | "demo" | "disabled";

/**
 * Google Calendar sync. Required in production; in local development without
 * Google credentials it is disabled (bookings don't require a connection).
 */
export function getGoogleMode(): GoogleMode {
  if (getDataMode() === "demo") return "demo";
  if (hasAny("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_TOKEN_ENCRYPTION_KEY")) {
    parse(googleEnvSchema, "Google OAuth");
    return "google";
  }
  if (!isProduction()) return "disabled";
  throw new ConfigError("Missing Google Calendar configuration. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and GOOGLE_TOKEN_ENCRYPTION_KEY.");
}

export function getGoogleEnv(): GoogleEnv {
  return parse(googleEnvSchema, "Google OAuth");
}

/** ESV API key for the Verse of the Day (optional; the verse falls back to a reference link). */
export function getEsvApiKey(): string | null {
  return process.env.ESV_API_KEY?.trim() || null;
}

/** Public support address shown on the privacy and terms pages (optional). */
export function getSupportEmail(): string | null {
  const value = process.env.SUPPORT_EMAIL?.trim();
  return value && z.email().safeParse(value).success ? value : null;
}
