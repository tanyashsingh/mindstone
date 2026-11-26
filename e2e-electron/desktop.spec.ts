import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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

    // OCR runs offline from cairn-asset://ocr/ in the desktop app.
    const png = await win.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 900; c.height = 160;
      const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 160); g.fillStyle = "#000"; g.font = "56px Arial"; g.fillText("Codeword KESTREL 77", 40, 100);
      const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), "image/png"));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    const chooser2 = win.waitForEvent("filechooser");
    await win.getByRole("region", { name: "Main view" }).getByRole("button", { name: "Upload" }).click();
    await (await chooser2).setFiles([{ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(png) }]);
    await expect(win.getByRole("region", { name: "Main view" }).getByText("Searchable (OCR)")).toBeVisible({ timeout: 60_000 });
    await win.keyboard.press("Control+k");
    await win.keyboard.type("kestrel");
    await expect(win.getByRole("dialog").getByText("photo.png")).toBeVisible();
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

/** Voice in the packaged app: microphone permission, the cairn-asset:// scheme, and local Whisper. */
const wav = process.env.CAIRN_SPEECH_WAV;
test("desktop voice note records and transcribes locally", async () => {
  test.skip(!wav || !existsSync(wav) || !existsSync("dist/voice/models"), "needs CAIRN_SPEECH_WAV and a build with the voice model");
  test.setTimeout(240_000);
  const profile = mkdtempSync(path.join(tmpdir(), "rea-e2e-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${profile}`, "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`],
    cwd: process.cwd(),
  });
  try {
    const win = await app.firstWindow();
    const errors: string[] = [];
    win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await expect(win.getByRole("navigation", { name: "Sidebar" })).toBeVisible({ timeout: 30_000 });
    await win.keyboard.press("Control+n");
    await win.getByLabel("Page title").fill("Desktop meeting");
    await win.getByLabel("Page title").press("Enter");
    await win.keyboard.type("/meeting notes");
    await win.keyboard.press("Enter");
    const block = win.locator(".rea-editor .node-voiceNote").first();
    await block.getByRole("button", { name: "Start recording" }).click();
    await expect(block.getByText(/Recording/)).toBeVisible();
    await win.waitForTimeout(9000);
    await block.getByRole("button", { name: "Stop" }).click();
    await expect(block.getByRole("button", { name: /Transcript/ })).toBeVisible({ timeout: 180_000 });
    const text = (await block.locator("p").allInnerTexts()).join(" ").toLowerCase();
    console.log("DESKTOP TRANSCRIPT:", text.slice(0, 160));
    expect(text).toContain("budget");
    expect(errors.filter((e) => /cairn-asset|Content Security Policy|wasm/i.test(e))).toEqual([]);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

/** Two desktop "devices" (separate profiles) keep in step through one shared folder. */
test("desktop folder sync between two profiles", async () => {
  test.setTimeout(180_000);
  const shared = mkdtempSync(path.join(tmpdir(), "ms-folder-"));
  const launch = async () => {
    const profile = mkdtempSync(path.join(tmpdir(), "rea-e2e-"));
    const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], cwd: process.cwd(), env: { ...process.env, MINDSTONE_E2E_SYNC_DIR: shared } });
    const win = await app.firstWindow();
    await expect(win.getByRole("navigation", { name: "Sidebar" })).toBeVisible({ timeout: 30_000 });
    return { app, win, profile };
  };
  const turnOn = async (win: import("@playwright/test").Page) => {
    await win.keyboard.press("Control+,");
    const main = win.getByRole("region", { name: "Main view" });
    await main.getByRole("button", { name: "Synchronization" }).click();
    await main.getByRole("button", { name: "Choose folder…" }).click();
    await expect(main.getByTestId("sync-folder")).toContainText(path.basename(shared));
    await main.getByLabel("Sync passphrase").fill("folder sync phrase");
    await main.getByRole("button", { name: "Turn on sync" }).click();
  };
  const A = await launch();
  const B = await launch();
  try {
    await A.win.keyboard.press("Control+n");
    await A.win.getByLabel("Page title").fill("Garden plan");
    await A.win.getByLabel("Page title").press("Enter");
    await A.win.keyboard.type("Plant tomatoes, code JASPER-9");
    await expect(A.win.getByRole("status")).toContainText("Saved locally", { timeout: 10_000 });
    await turnOn(A.win);
    await expect(A.win.getByTestId("sync-status")).toContainText("sent", { timeout: 30_000 });
    const files = readdirSync(path.join(shared, "Mindstone Sync"), { recursive: true }) as string[];
    expect(files.some((f) => /space\.json$/.test(f))).toBe(true);
    expect(files.some((f) => /\.bin$/.test(f))).toBe(true);

    await turnOn(B.win);
    await expect(B.win.getByText("Joined the sync space")).toBeVisible({ timeout: 30_000 });
    await B.win.getByRole("navigation", { name: "Sidebar" }).getByRole("treeitem", { name: /Garden plan/ }).click();
    await expect(B.win.locator(".rea-editor")).toContainText("JASPER-9");
  } finally {
    await A.app.close();
    await B.app.close();
    rmSync(A.profile, { recursive: true, force: true });
    rmSync(B.profile, { recursive: true, force: true });
    rmSync(shared, { recursive: true, force: true });
  }
});
