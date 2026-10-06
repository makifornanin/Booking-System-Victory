import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * E2E runs against `next dev` with DEMO_MODE=true: the in-memory development
 * adapter (auth, data, storage and simulated GHL). It cannot run in production.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Asia/Manila",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Test-only bot key for the demo server (not a real secret).
    env: { DEMO_MODE: "true", NEXT_DIST_DIR: ".next-e2e", N8N_BOOKING_API_KEY: "e2e-demo-bot-key-not-a-secret-0123456789" },
  },
});
