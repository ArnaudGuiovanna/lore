import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the LORE web smoke suite.
 *
 * Local run (default): tests the SHARED, already-running instance at
 * http://127.0.0.1:3001 — no webServer is started, the suite is read-mostly
 * (login + navigation + RBAC + render checks).
 *
 * CI run: set PLAYWRIGHT_WEB_SERVER=1 and the `webServer` block below boots
 * `next start` on the same port (the CI job is responsible for the backend +
 * seed + build). This keeps the same config correct in both worlds.
 */
// Use `localhost` (not 127.0.0.1) as the canonical host: the app's middleware
// emits redirects on `localhost`, and the session cookie is host-only — so the
// browser host must match the redirect host for the cookie to survive an RBAC
// redirect. (Both resolve to the same shared instance on :3001.)
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";
const START_SERVER = process.env.PLAYWRIGHT_WEB_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  // Read-mostly smoke: a single worker keeps ordering predictable and avoids
  // hammering the shared instance.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Demo logins are enabled on the shared instance; we still type credentials
    // explicitly so the suite is independent of any pre-filled hints.
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Only spin up a server in CI (or when explicitly requested). For the local
  // run against the shared instance this stays disabled so we never restart it.
  webServer: START_SERVER
    ? {
        command: "npm run start",
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
