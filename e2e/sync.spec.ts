import { expect, test, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boot, main, nav, newPage, saved } from "./helpers";

let server: ChildProcess;
let dataDir = "";
const PORT = 8790 + Math.floor(Math.random() * 100);
const SERVER = `http://localhost:${PORT}`;

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "ms-sync-"));
  server = spawn(process.execPath, ["server/sync-server.mjs", "--port", String(PORT), "--host", "127.0.0.1", "--data", dataDir], { stdio: "pipe" });
  await new Promise<void>((resolve, reject) => {
    server.stdout!.on("data", (d) => { if (String(d).includes("sync server on")) resolve(); });
    server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
});
test.afterAll(() => { server.kill(); rmSync(dataDir, { recursive: true, force: true }); });

async function device(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:5191/", viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await boot(page);
  return page;
}

async function openSync(page: Page) {
  await page.keyboard.press("Control+,");
  await main(page).getByRole("button", { name: "Synchronization" }).click();
}

const allFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? allFiles(p) : [p]; });

test("two devices sync through the server, end-to-end encrypted, both ways", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await device(browser);
  await newPage(a, "Trip to Lisbon");
  await a.keyboard.type("Hotel booking reference TOURMALINE-55");
  await saved(a);

  // Device A starts a sync space
  await openSync(a);
  await main(a).getByLabel("Sync server").fill(SERVER);
  await main(a).getByLabel("Sync passphrase").fill("same phrase everywhere");
  await main(a).getByRole("button", { name: "Turn on sync" }).click();
  await expect(main(a).getByTestId("sync-status")).toContainText("sent", { timeout: 30_000 });
  const code = (await main(a).getByTestId("sync-code").innerText()).trim();
  expect(code).toMatch(new RegExp(`^${SERVER}#[a-z0-9]{20}$`));
  // The server stores only ciphertext
  for (const f of allFiles(dataDir)) expect(readFileSync(f).toString("latin1")).not.toContain("TOURMALINE");

  // Device B joins with the code: wrong passphrase refused, right one brings the data over
  const b = await device(browser);
  await openSync(b);
  await main(b).getByLabel("Sync server").fill(code);
  await main(b).getByLabel("Sync passphrase").fill("not the same phrase");
  await main(b).getByRole("button", { name: "Turn on sync" }).click();
  await expect(main(b).getByRole("alert")).toContainText("doesn't match");
  await main(b).getByLabel("Sync passphrase").fill("same phrase everywhere");
  await main(b).getByRole("button", { name: "Turn on sync" }).click();
  await expect(b.getByText("Joined the sync space")).toBeVisible({ timeout: 30_000 }); // and it switches to the synced workspace
  await nav(b, "Trip to Lisbon");
  await expect(b.locator(".rea-editor")).toContainText("TOURMALINE-55");
  // B's untouched starter workspace was replaced by the synced one
  await expect(b.getByRole("navigation", { name: "Sidebar" }).getByRole("treeitem", { name: /Welcome to Mindstone/ })).toHaveCount(1);

  // B edits; A receives it
  await b.locator(".rea-editor").click();
  await b.keyboard.press("End");
  await b.keyboard.type(", check-in 3 pm");
  await saved(b);
  await openSync(b);
  await main(b).getByRole("button", { name: "Sync now" }).click();
  await expect(main(b).getByTestId("sync-status")).toContainText(/[1-9]\d* sent/);
  await openSync(a);
  await main(a).getByRole("button", { name: "Sync now" }).click();
  await expect(main(a).getByTestId("sync-status")).toContainText(/[1-9]\d* received/);
  await nav(a, "Trip to Lisbon");
  await expect(a.locator(".rea-editor")).toContainText("check-in 3 pm");
  await expect(a.getByTestId("sync-indicator")).toContainText("Sync:");

  // Deleting on A removes it on B
  await a.evaluate(async () => {
    const repo = await import(/* @vite-ignore */ String("/src/data/repo.ts"));
    const { useApp } = await import(/* @vite-ignore */ String("/src/store/app.ts"));
    await repo.createTask(useApp.getState().workspaceId as string, { title: "Temporary task" });
  });
  await openSync(a);
  await main(a).getByRole("button", { name: "Sync now" }).click();
  await openSync(b);
  await main(b).getByRole("button", { name: "Sync now" }).click();
  await nav(b, "Tasks");
  await expect(main(b)).toContainText("Temporary task");
  await a.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ String("/src/data/db.ts"));
    await db().tasks.filter((t: { title: string }) => t.title === "Temporary task").delete();
  });
  await openSync(a);
  await main(a).getByRole("button", { name: "Sync now" }).click();
  await expect(main(a).getByTestId("sync-status")).toContainText(/[1-9]\d* sent/);
  await openSync(b);
  await main(b).getByRole("button", { name: "Sync now" }).click();
  await nav(b, "Tasks");
  await expect(main(b)).not.toContainText("Temporary task");
});
