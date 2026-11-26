import { expect, test, type Page } from "@playwright/test";
import { boot, idb, main, nav, newPage, noCrash, saved } from "./helpers";

const outer = (page: Page) => page.locator(".rea-editor:not(.synced-inner)").first();

async function slash(page: Page, cmd: string) {
  await page.keyboard.type(`/${cmd}`);
  await expect(page.getByRole("listbox").or(page.locator("[data-slash-menu]")).first()).toBeVisible();
  await page.keyboard.press("Enter");
}

test("columns: insert, type into each column, persist and export", async ({ page }) => {
  await boot(page);
  await newPage(page, "Layout");
  await slash(page, "3 columns");
  const cols = outer(page).locator("div[data-columns] > div[data-column]");
  await expect(cols).toHaveCount(3);
  await page.keyboard.type("Left text");
  await cols.nth(1).locator("p").click();
  await page.keyboard.type("Middle text");
  await cols.nth(2).locator("p").click();
  await page.keyboard.type("Right text");
  // Columns sit side by side on a wide window.
  const [a, b] = [await cols.nth(0).boundingBox(), await cols.nth(1).boundingBox()];
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  await saved(page);

  await page.reload();
  await nav(page, "Layout");
  await expect(cols.nth(1)).toHaveText("Middle text");
  const pages = await idb<{ title: string; text: string }>(page, "pages");
  expect(pages.find((p) => p.title === "Layout")!.text).toContain("Right text"); // searchable

  const download = page.waitForEvent("download");
  await main(page).getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("button", { name: "Export as Markdown" }).click();
  const md = await (await download).createReadStream().then(async (s) => { let t = ""; for await (const c of s) t += c; return t; });
  expect(md).toMatch(/Left text[\s\S]*Middle text[\s\S]*Right text/);
  await noCrash(page);
});

test("synced block: edits in one copy appear in the other, across pages, and unsync keeps a copy", async ({ page }) => {
  await boot(page);
  await newPage(page, "Source");
  await slash(page, "synced block");
  const inner = page.locator(".synced-inner");
  await expect(inner).toHaveCount(1);
  await inner.click();
  await page.keyboard.type("Shared fact: launch on Friday");
  await expect.poll(async () => (await idb<{ text: string }>(page, "syncedBlocks"))[0]?.text).toContain("launch on Friday");

  // Insert a second copy of the same block on this page.
  await outer(page).locator("> p").last().click();
  await slash(page, "insert synced block");
  await page.getByRole("option", { name: /launch on Friday/ }).click();
  await expect(inner).toHaveCount(2);
  await expect(inner.nth(1)).toContainText("Shared fact: launch on Friday");

  // Edit the second copy; the first follows.
  await inner.nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" at noon");
  await expect(inner.nth(0)).toContainText("launch on Friday at noon");
  await saved(page);

  // Another page shows the same content, and edits there come back.
  await newPage(page, "Elsewhere");
  await slash(page, "insert synced block");
  await page.getByRole("option", { name: /at noon/ }).click();
  await expect(inner).toContainText("launch on Friday at noon");
  await inner.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect.poll(async () => (await idb<{ text: string }>(page, "syncedBlocks"))[0]?.text).toContain("at noon!");
  await saved(page);
  await nav(page, "Source");
  await expect(inner.first()).toContainText("at noon!");

  // Search finds the synced content.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("noon");
  await expect(page.getByRole("dialog").getByText(/synced block/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Unsync the first copy: it becomes ordinary text; the other copy stays synced.
  await inner.first().hover();
  await page.getByRole("button", { name: "Unsync" }).first().click();
  await expect(inner).toHaveCount(1);
  await expect(outer(page).locator("> p", { hasText: "at noon!" })).toHaveCount(1);
  await saved(page);
  await page.reload();
  await nav(page, "Source");
  await expect(page.locator(".synced-inner")).toHaveCount(1);
  await noCrash(page);
});

test("buttons: checklist, task, open page and template actions", async ({ page }) => {
  await boot(page);
  await newPage(page, "Target page");
  await newPage(page, "Buttons");

  // Checklist item
  await slash(page, "button");
  let editor = page.getByTestId("button-editor").last();
  await editor.getByLabel("Button label").fill("Add chore");
  await editor.getByLabel("Button text").fill("Water plants");
  await editor.getByRole("button", { name: "Done" }).click();
  await main(page).getByRole("button", { name: "Add chore" }).click();
  await main(page).getByRole("button", { name: "Add chore" }).click();
  await expect(outer(page).locator('ul[data-type="taskList"] li', { hasText: "Water plants" })).toHaveCount(2);

  // Task
  await outer(page).locator("> p").last().click();
  await slash(page, "button");
  editor = page.getByTestId("button-editor").last();
  await editor.getByLabel("Button label").fill("Log call");
  await editor.getByLabel("Button action").selectOption("task");
  await editor.getByLabel("Button text").fill("Call the bank");
  await editor.getByLabel("Task due").selectOption("tomorrow");
  await editor.getByRole("button", { name: "Done" }).click();
  await main(page).getByRole("button", { name: "Log call" }).click();
  await expect(page.getByText("Task created: Call the bank")).toBeVisible();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await expect.poll(async () => (await idb<{ title: string; dueDate: string }>(page, "tasks")).find((t) => t.title === "Call the bank")?.dueDate).toBe(iso);

  // Template
  await outer(page).locator("> p").last().click();
  await slash(page, "button");
  editor = page.getByTestId("button-editor").last();
  await editor.getByLabel("Button label").fill("Add meeting notes");
  await editor.getByLabel("Button action").selectOption("template");
  await editor.getByLabel("Button template").selectOption({ index: 1 });
  await editor.getByRole("button", { name: "Done" }).click();
  const before = await outer(page).locator("> *").count();
  await main(page).getByRole("button", { name: "Add meeting notes" }).click();
  await expect.poll(async () => outer(page).locator("> *").count()).toBeGreaterThan(before);

  // Open page
  await outer(page).locator("> p").last().click();
  await slash(page, "button");
  editor = page.getByTestId("button-editor").last();
  await editor.getByLabel("Button label").fill("Go to target");
  await editor.getByLabel("Button action").selectOption("page");
  await editor.getByLabel("Button page").selectOption({ label: "Target page" });
  await editor.getByRole("button", { name: "Done" }).click();
  await saved(page);
  await page.reload();
  await nav(page, "Buttons");
  await main(page).getByRole("button", { name: "Go to target" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Target page");
  await noCrash(page);
});
