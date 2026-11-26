import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The installed web app (PWA), tested against the production build served by the sync server, the way a phone
// would use it. Build first: npm run build:web. Run: npx playwright test -c playwright.pwa.config.ts
const PORT = 5192;
const data = mkdtempSync(path.join(tmpdir(), "ms-pwa-sync-"));
export default defineConfig({
  testDir: "e2e-pwa",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}/`, channel: "chrome", headless: true, viewport: { width: 390, height: 844 } },
  webServer: { command: `node server/sync-server.mjs --port ${PORT} --host 127.0.0.1 --static dist --data "${data}"`, url: `http://localhost:${PORT}/`, reuseExistingServer: false, timeout: 30_000 },
});
