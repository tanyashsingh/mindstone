import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { boot, idb, main, nav, newPage, noCrash, saved, sidebar } from "./helpers";

test("command palette searches content and runs commands", async ({ page }) => {
  await boot(page);
  await newPage(page, "Quarterly planning");
  await page.keyboard.type("budget allocation for marketing");
  await saved(page);
  await page.waitForTimeout(1700); // search index refresh is debounced
  await page.keyboard.press("Control+k");
  const dlg = page.getByRole("dialog", { name: "Command palette" });
  await dlg.getByRole("combobox").fill("budgat");
  await expect(dlg.getByRole("option").first()).toContainText("Quarterly planning");
  await dlg.getByRole("combobox").fill(">go to tasks");
  await page.keyboard.press("Enter");
  await expect(main(page).getByRole("heading", { name: "Tasks" })).toBeVisible();
});

test("backup downloads and restores the workspace", async ({ page }) => {
  await boot(page);
  await newPage(page, "Keep me");
  await page.keyboard.type("precious content");
  await saved(page);
  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "Backup & restore" }).click();
  const dl = page.waitForEvent("download");
  await main(page).getByRole("button", { name: "Download backup" }).click();
  const file = await (await dl).path();
  const backup = JSON.parse(readFileSync(file, "utf8"));
  expect(backup.format).toBe("rea-backup");
  expect(backup.tables.pages.some((p: { title: string }) => p.title === "Keep me")).toBe(true);

  // Damage the workspace, then restore
  await sidebar(page).getByRole("treeitem", { name: /Keep me/ }).click();
  await page.locator(".rea-editor").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("damaged");
  await saved(page);
  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "Backup & restore" }).click();
  const chooser = page.waitForEvent("filechooser");
  await main(page).getByRole("button", { name: "Choose file…" }).click();
  await (await chooser).setFiles(file);
  await page.getByRole("button", { name: "Replace workspace" }).click();
  await expect(page.getByText(/Restored/)).toBeVisible();
  const pages = await idb<{ title: string; text: string }>(page, "pages");
  expect(pages.find((p) => p.title === "Keep me")?.text).toBe("precious content");
});

test("imports Markdown and exports a page as Markdown", async ({ page }) => {
  await boot(page);
  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "Import & export" }).click();
  const chooser = page.waitForEvent("filechooser");
  await main(page).getByRole("button", { name: "Choose files…" }).click();
  await (await chooser).setFiles({
    name: "Meeting.md", mimeType: "text/markdown",
    buffer: Buffer.from("# Agenda\n\n- [ ] Budget\n- [x] Hiring\n\n> [!TIP]\n> Be brief\n\n$$\nE=mc^2\n$$\n\nSee [[Welcome to Mindstone]]\n"),
  });
  await expect(page.getByText(/Imported 1 pages/)).toBeVisible();
  await sidebar(page).getByRole("treeitem", { name: /Meeting/ }).click();
  const ed = page.locator(".rea-editor");
  await expect(ed.locator("h1")).toHaveText("Agenda");
  await expect(ed.locator('li[data-checked="true"]')).toHaveCount(1);
  await expect(ed.locator("[data-callout], .katex").first()).toBeVisible();
  const links = await idb<{ kind: string }>(page, "links");
  expect(links.some((l) => l.kind === "wiki")).toBe(true);

  await main(page).getByRole("button", { name: "Page actions" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export as Markdown" }).click();
  const md = readFileSync(await (await dl).path(), "utf8");
  expect(md).toContain("# Agenda");
  expect(md).toContain("- [x] Hiring");
});

test("theme switching applies dark, light and OLED", async ({ page }) => {
  await boot(page);
  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "Appearance" }).click();
  await main(page).getByRole("button", { name: "dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await main(page).getByRole("button", { name: "light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await main(page).getByRole("button", { name: "OLED black" }).click();
  await expect(page.locator("html")).toHaveClass(/oled/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/oled/);
});

test("works offline: edits save and the status bar reports it", async ({ page, context }) => {
  await boot(page);
  // The dev server serves view code lazily; open a page once so its code is loaded (the desktop build loads from disk).
  await nav(page, "Welcome to Mindstone");
  await expect(page.locator(".rea-editor")).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("Offline");
  await newPage(page, "Offline note");
  await page.keyboard.type("written without network");
  await saved(page);
  const pages = await idb<{ title: string; text: string }>(page, "pages");
  expect(pages.find((p) => p.title === "Offline note")?.text).toBe("written without network");
});

test("AI is off by default and explains how to enable it", async ({ page }) => {
  await boot(page);
  await nav(page, "Mindstone Intelligence");
  await expect(main(page).getByRole("button", { name: "Set up AI" })).toBeVisible();
  await main(page).getByLabel("Message").fill("hello");
  await main(page).getByLabel("Message").press("Enter");
  await expect(main(page).getByText(/No AI provider is enabled/)).toBeVisible();
});

test("templates, files, graph, inbox and home render and work", async ({ page }) => {
  await boot(page);
  await nav(page, "Templates");
  await main(page).locator(".panel").filter({ hasText: "Reading tracker" }).getByRole("button", { name: "Use template" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Reading tracker");
  await expect(page.locator(".rea-editor")).toContainText("Books");

  await nav(page, "Files");
  const chooser = page.waitForEvent("filechooser");
  await main(page).getByRole("button", { name: "Upload" }).click();
  await (await chooser).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello file") });
  await main(page).getByRole("button", { name: "notes.txt" }).click();
  await expect(page.getByRole("dialog")).toContainText("hello file");
  await page.keyboard.press("Escape");
  const blocked = page.waitForEvent("filechooser");
  await main(page).getByRole("button", { name: "Upload" }).click();
  await (await blocked).setFiles({ name: "evil.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByText(/not allowed/)).toBeVisible();

  await nav(page, "Knowledge graph");
  await expect(main(page)).toContainText(/\d+ nodes/);
  await nav(page, "Inbox");
  await nav(page, "Home");
  await noCrash(page);
});
