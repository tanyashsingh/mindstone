import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeDocx, makePdf } from "../e2e/fixtures";

/**
 * Runs the built desktop app (dist/ + dist-electron/) in real Electron with a throwaway profile.
 * Build first: npm run build. Run: npx playwright test -c playwright.electron.config.ts
 */
test("desktop app boots from file://, persists data, and extracts PDF and Word text", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "rea-e2e-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], cwd: process.cwd() }); // run from the repo root
  try {
    const win = await app.firstWindow();
    await expect(win.getByRole("navigation", { name: "Sidebar" })).toBeVisible({ timeout: 30_000 });
    expect(await win.evaluate(() => location.protocol)).toBe("file:");
    expect(await win.evaluate(() => typeof window.rea?.secrets?.available)).toBe("function");
    // The sandboxed renderer must not see Node.
    expect(await win.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe("undefined");

    await win.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name: "Files" }).click();
    const chooser = win.waitForEvent("filechooser");
    await win.getByRole("region", { name: "Main view" }).getByRole("button", { name: "Upload" }).click();
    await (await chooser).setFiles([
      { name: "manual.pdf", mimeType: "application/pdf", buffer: makePdf(["Desktop PDF check", "Codeword HERON"]) },
      { name: "memo.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: makeDocx(["Codeword OSPREY"]) },
    ]);
    await expect(win.getByRole("region", { name: "Main view" }).getByText("Searchable")).toHaveCount(2, { timeout: 30_000 });
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
