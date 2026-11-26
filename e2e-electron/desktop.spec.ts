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

/** Web clipper endpoint and calendar subscriptions, in the desktop app. */
test("desktop web clipper and calendar subscription", async () => {
  test.setTimeout(120_000);
  const profile = mkdtempSync(path.join(tmpdir(), "rea-e2e-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], cwd: process.cwd() });
  const http = await import("node:http");
  const cal = http.createServer((_req, res) => {
    const d = new Date(); d.setHours(11, 0, 0, 0);
    const s = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T110000`;
    res.writeHead(200, { "content-type": "text/calendar" });
    res.end(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:desk-1", "SUMMARY:Dentist appointment", `DTSTART:${s}`, "DURATION:PT30M", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
  });
  await new Promise<void>((r) => cal.listen(0, "127.0.0.1", () => r()));
  const calPort = (cal.address() as { port: number }).port;
  try {
    const win = await app.firstWindow();
    await expect(win.getByRole("navigation", { name: "Sidebar" })).toBeVisible({ timeout: 30_000 });
    const main = win.getByRole("region", { name: "Main view" });

    // Turn on the clipper and read the pairing code
    await win.keyboard.press("Control+,");
    await main.getByRole("button", { name: "Integrations" }).click();
    await main.getByRole("switch", { name: "Web clipper" }).click();
    const code = (await main.getByTestId("clipper-code").innerText()).trim();
    expect(code).toMatch(/^[0-9a-f]{24}$/);

    const post = (headers: Record<string, string>, body: unknown) => fetch("http://127.0.0.1:43117/clip", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const clip = { url: "https://example.org/recipe", title: "Lemon cake recipe", html: "<p>Zest of two lemons, SAFFRON-12</p>", text: "", kind: "page" };
    expect((await post({ authorization: "Bearer wrongwrongwrongwrongwron" }, clip)).status).toBe(401);
    expect((await post({ authorization: `Bearer ${code}`, origin: "https://evil.example" }, clip)).status).toBe(403);
    expect((await fetch("http://127.0.0.1:43117/ping", { headers: { authorization: `Bearer ${code}` } })).status).toBe(200);
    expect((await post({ authorization: `Bearer ${code}`, origin: "chrome-extension://abcdefghijklmnop" }, clip)).status).toBe(202);
    await expect(win.getByText("Clipped “Lemon cake recipe”")).toBeVisible();
    await win.getByRole("button", { name: "Open", exact: true }).click();
    await expect(win.locator(".rea-editor")).toContainText("SAFFRON-12");

    // Subscribe to a calendar (downloaded by the desktop app itself)
    await win.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name: "Calendar" }).click();
    await main.getByRole("button", { name: "Subscribe" }).click();
    const dlg = win.getByRole("dialog").filter({ hasText: "Subscribed calendars" });
    await dlg.getByLabel("Calendar name").fill("Health");
    await dlg.getByLabel("Calendar address").fill(`http://127.0.0.1:${calPort}/health.ics`);
    await dlg.getByRole("button", { name: "Subscribe" }).click();
    await expect(win.getByText("Subscribed to Health: 1 events")).toBeVisible();
    await win.keyboard.press("Escape");
    await expect(main.getByRole("button", { name: /Dentist appointment/ }).first()).toBeVisible();

    // Turning the clipper off closes the port
    await win.keyboard.press("Control+,");
    await main.getByRole("button", { name: "Integrations" }).click();
    await main.getByRole("switch", { name: "Web clipper" }).click();
    await expect.poll(async () => fetch("http://127.0.0.1:43117/ping").then(() => "open", () => "closed")).toBe("closed");
  } finally {
    cal.close();
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("desktop plugins run in their sandbox", async () => {
  test.setTimeout(90_000);
  const profile = mkdtempSync(path.join(tmpdir(), "rea-e2e-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], cwd: process.cwd() });
  try {
    const win = await app.firstWindow();
    await expect(win.getByRole("navigation", { name: "Sidebar" })).toBeVisible({ timeout: 30_000 });
    await win.keyboard.press("Control+n");
    await win.getByLabel("Page title").fill("Plugin check");
    await win.getByLabel("Page title").press("Enter");
    await win.keyboard.type("alpha beta gamma delta");
    await expect(win.getByRole("status")).toContainText("Saved locally", { timeout: 10_000 });
    await win.keyboard.press("Control+,");
    const main = win.getByRole("region", { name: "Main view" });
    await main.getByRole("button", { name: "Plugins" }).click();
    await main.getByLabel("Plugin folder").setInputFiles(path.join(process.cwd(), "plugins", "word-count"));
    await win.getByRole("dialog").getByRole("button", { name: "Install" }).click();
    await win.getByRole("navigation", { name: "Sidebar" }).getByRole("treeitem", { name: /Plugin check/ }).click();
    await win.keyboard.press("Control+k");
    await win.keyboard.type("word count of");
    await win.getByRole("dialog").getByRole("option", { name: /Word count of this page/ }).click();
    await expect(win.getByText("Word count: 4 words")).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
