import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boot, idb, main, newPage, noCrash, saved } from "./helpers";

const file = (name: string, text: string) => ({ name, mimeType: name.endsWith(".json") ? "application/json" : "text/javascript", buffer: Buffer.from(text) });

/** Writes the files into a new temporary folder, as a plugin folder on disk. */
function folderOf(files: { name: string; buffer: Buffer }[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ms-plugin-"));
  for (const f of files) writeFileSync(path.join(dir, f.name), f.buffer);
  return dir;
}

async function installFromFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.keyboard.press("Control+,");
  await main(page).getByRole("button", { name: "Plugins" }).click();
  await main(page).getByLabel("Plugin folder").setInputFiles(folderOf(files));
  return page.getByRole("dialog");
}

test("the example plugin: install after reviewing permissions, command, slash item, panel, disable and remove", async ({ page }) => {
  await boot(page);
  await newPage(page, "Essay");
  await page.keyboard.type("One two three four five six seven eight nine ten.");
  await saved(page);

  const dir = path.join(process.cwd(), "plugins", "word-count");
  const dlg = await installFromFiles(page, [file("manifest.json", readFileSync(path.join(dir, "manifest.json"), "utf8")), file("main.js", readFileSync(path.join(dir, "main.js"), "utf8"))]);
  await expect(dlg.getByRole("list", { name: "Requested permissions" })).toContainText("Read your pages");
  await expect(dlg.getByRole("list", { name: "Requested permissions" })).toContainText("Create pages and add to them");
  await dlg.getByRole("button", { name: "Install" }).click();
  await expect(main(page).getByTestId("plugin")).toContainText("Word count");

  // Command from the palette
  await page.getByRole("navigation", { name: "Sidebar" }).getByRole("treeitem", { name: /Essay/ }).click();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("word count of");
  await page.getByRole("dialog").getByRole("option", { name: /Word count: Word count of this page/ }).click();
  await expect(page.getByText("Word count: 10 words, about 1 min to read")).toBeVisible();

  // Slash item inserts what the plugin returns
  await page.locator(".rea-editor").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/word count");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rea-editor")).toContainText("Word count: 10");

  // Panel in the right sidebar
  await page.keyboard.press("Control+Shift+\\");
  const panel = page.getByRole("complementary", { name: "Context panel" });
  await panel.getByRole("button", { name: "Plugins" }).click();
  await expect(panel.getByRole("region", { name: "Word count panel" })).toContainText("about 1 min to read");

  // A command that writes (pages:write)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("longest");
  await page.getByRole("dialog").getByRole("option", { name: /List my longest pages/ }).click();
  await expect(page.getByText("Word count: Saved a list of")).toBeVisible();
  expect((await idb<{ title: string }>(page, "pages")).some((p) => p.title === "Longest pages")).toBe(true);

  // Disable: its command disappears; remove: it's gone
  await page.keyboard.press("Control+,");
  await main(page).getByRole("button", { name: "Plugins" }).click();
  await main(page).getByRole("switch", { name: "Enable Word count" }).click();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("word count of");
  await expect(page.getByRole("dialog").getByRole("option", { name: /Word count of this page/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await main(page).getByRole("button", { name: "Remove Word count" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(main(page).getByTestId("plugin")).toHaveCount(0);
  await noCrash(page);
});

test("the sandbox blocks the network, the app's page and storage, and permissions not granted", async ({ page }) => {
  await boot(page);
  const probe = `
    const out = {};
    const attempt = async (name, fn) => { try { await fn(); out[name] = "ALLOWED"; } catch (e) { out[name] = "blocked"; } };
    await attempt("fetch", () => fetch("http://localhost:5191/"));
    await attempt("parentDom", () => window.parent.document.body.innerHTML);
    await attempt("topDom", () => window.top.document.title);
    await attempt("indexedDB", () => new Promise((res, rej) => { const r = indexedDB.open("rea"); r.onsuccess = res; r.onerror = () => rej(r.error); }));
    await attempt("localStorage", () => localStorage.getItem("x"));
    await attempt("cookies", () => { if (document.cookie === undefined) throw 0; document.cookie = "a=1"; });
    await attempt("readPages", () => mindstone.pages.list());
    await attempt("createTask", () => mindstone.tasks.create({ title: "sneaky" }));
    await attempt("image", () => new Promise((res, rej) => { const i = new Image(); i.onload = res; i.onerror = rej; i.src = "http://localhost:5191/favicon.png"; }));
    mindstone.panel.render("RESULTS " + JSON.stringify(out));
  `;
  const manifest = JSON.stringify({ id: "probe", name: "Probe", version: "0.0.1", description: "Tries to escape", permissions: [] });
  const dlg = await installFromFiles(page, [file("manifest.json", manifest), file("main.js", probe)]);
  await expect(dlg).toContainText("Nothing beyond showing commands and a panel");
  await dlg.getByRole("button", { name: "Install" }).click();
  await page.keyboard.press("Control+Shift+\\");
  const panel = page.getByRole("complementary", { name: "Context panel" });
  await panel.getByRole("button", { name: "Plugins" }).click();
  const results = panel.getByRole("region", { name: "Probe panel" });
  await expect(results).toContainText("RESULTS", { timeout: 15_000 });
  const json = JSON.parse((await results.innerText()).replace(/^[\s\S]*RESULTS\s*/, "").trim());
  expect(json).toEqual({ fetch: "blocked", parentDom: "blocked", topDom: "blocked", indexedDB: "blocked", localStorage: "blocked", cookies: "blocked", readPages: "blocked", createTask: "blocked", image: "blocked" });
  expect((await idb<{ title: string }>(page, "tasks")).some((t) => t.title === "sneaky")).toBe(false);
});

test("bad plugin folders are refused with a clear message", async ({ page }) => {
  await boot(page);
  await installFromFiles(page, [file("main.js", "1")]);
  await expect(page.getByText("No manifest.json found")).toBeVisible();
  await main(page).getByLabel("Plugin folder").setInputFiles(folderOf([file("manifest.json", JSON.stringify({ id: "xx", name: "X", version: "1", permissions: ["everything"] })), file("main.js", "1")]));
  await expect(page.getByText(/Unknown permission/)).toBeVisible();
});
