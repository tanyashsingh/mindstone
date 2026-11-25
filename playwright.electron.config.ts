import { defineConfig } from "@playwright/test";

// Desktop smoke test against the built app. Run `npm run build` first.
export default defineConfig({
  testDir: "e2e-electron",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
});
