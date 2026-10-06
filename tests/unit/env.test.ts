import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, getCalendarMode, getDataMode, getSiteUrl, getStorageMode } from "@/lib/env";

const KEYS = [
  "DEMO_MODE",
  "DATABASE_URL",
  "NEON_AUTH_BASE_URL",
  "GHL_PRIVATE_INTEGRATION_TOKEN",
  "GHL_LOCATION_ID",
  "AWS_ENDPOINT_URL_S3",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "SITE_URL",
];

function setEnv(values: Record<string, string>) {
  for (const key of KEYS) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production configuration", () => {
  it("never falls back to demo mode", () => {
    setEnv({ NODE_ENV: "production" });
    expect(() => getDataMode()).toThrow(ConfigError);
    expect(() => getDataMode()).toThrow(/DATABASE_URL/);
  });

  it("refuses DEMO_MODE", () => {
    setEnv({ NODE_ENV: "production", DEMO_MODE: "true" });
    expect(() => getDataMode()).toThrow(/only available in development/);
  });

  it("requires GHL, storage and SITE_URL once Neon is configured", () => {
    setEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@host/db", NEON_AUTH_BASE_URL: "https://auth.example.com/neondb/auth" });
    expect(getDataMode()).toBe("neon");
    expect(() => getCalendarMode()).toThrow(/GHL/);
    expect(() => getStorageMode()).toThrow(/object storage/);
    expect(() => getSiteUrl()).toThrow(/SITE_URL/);
  });

  it("uses the real adapters when everything is configured", () => {
    setEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@host/db",
      NEON_AUTH_BASE_URL: "https://auth.example.com/neondb/auth",
      GHL_PRIVATE_INTEGRATION_TOKEN: "pit-1234567890",
      GHL_LOCATION_ID: "loc12345",
      AWS_ENDPOINT_URL_S3: "https://br-x.storage.c-1.us-east-2.aws.neon.tech",
      AWS_REGION: "us-east-2",
      AWS_ACCESS_KEY_ID: "nak_live_x",
      AWS_SECRET_ACCESS_KEY: "nsk_live_x",
      SITE_URL: "https://rooms.example.org/",
    });
    expect(getDataMode()).toBe("neon");
    expect(getCalendarMode()).toBe("ghl");
    expect(getStorageMode()).toBe("s3");
    expect(getSiteUrl()).toBe("https://rooms.example.org");
  });
});

describe("development configuration", () => {
  it("uses demo mode only when nothing is configured", () => {
    setEnv({ NODE_ENV: "development" });
    expect(getDataMode()).toBe("demo");
    expect(getCalendarMode()).toBe("demo");
    expect(getStorageMode()).toBe("demo");
  });
});
