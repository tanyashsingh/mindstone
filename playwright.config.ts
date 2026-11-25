import { defineConfig } from "@playwright/test";

// End-to-end tests run against the Vite dev server in the locally installed Chrome
// (no Playwright browser download). Each test gets a fresh profile, so a fresh IndexedDB.
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5183/",
    channel: "chrome",
    headless: true,
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: { command: "npx vite --port 5183 --strictPort", url: "http://localhost:5183/", reuseExistingServer: true, timeout: 60_000 },
});
