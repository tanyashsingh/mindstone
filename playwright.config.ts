import { defineConfig } from "@playwright/test";

// End-to-end tests run against the Vite dev server in the locally installed Chrome
// (no Playwright browser download). Each test gets a fresh profile, so a fresh IndexedDB.
// CI runners are slower (2 cores, cold dev server): fewer workers, longer waits, and retries for timing flakes.
const CI = !!process.env.CI;
// The tests start their own dev server on a port of their own, so a different app on the usual dev port can never be tested by mistake.
export const TEST_PORT = 5191;

export default defineConfig({
  testDir: "e2e",
  timeout: CI ? 90_000 : 45_000,
  expect: { timeout: CI ? 20_000 : 7_000 },
  fullyParallel: true,
  workers: CI ? 2 : 4,
  retries: CI ? 2 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${TEST_PORT}/`,
    channel: "chrome",
    headless: true,
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: { command: `npx vite --port ${TEST_PORT} --strictPort`, url: `http://localhost:${TEST_PORT}/`, reuseExistingServer: false, timeout: 90_000 },
});
