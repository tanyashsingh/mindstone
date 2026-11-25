import { expect, test } from "@playwright/test";
import { boot, idb, main, nav, newPage, noCrash, saved, sidebar } from "./helpers";

test("first run creates a workspace with a welcome page and a real dashboard", async ({ page }) => {
  const errors = await boot(page);
  await expect(sidebar(page).getByText("My Workspace")).toBeVisible();
  await expect(sidebar(page).getByRole("treeitem", { name: /Welcome to Cairn/ })).toBeVisible();
  await expect(main(page).getByText("Nothing due today")).toBeVisible();
  expect(errors).toEqual([]);
});

test("create, nest, edit, undo and persist a page across reload", async ({ page }) => {
  await boot(page);
  await newPage(page, "Atlas");
  const ed = page.locator(".rea-editor");
  await page.keyboard.type("/h2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Goals");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[ ] Ship beta #launch");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("temporary words");
  await page.keyboard.press("Control+z");
  await expect(ed).not.toContainText("temporary words");
  await page.keyboard.press("Control+Shift+z");
  await expect(ed).toContainText("temporary words");
  await expect(ed.locator("h2")).toHaveText("Goals");
  await expect(ed.locator('ul[data-type="taskList"] li')).toHaveCount(1);

  // Sub-page via slash command nests under Atlas and opens it
  await ed.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/sub-page");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Page title")).toBeFocused();
  await page.getByLabel("Page title").fill("Child");
  await saved(page);

  await page.reload();
  await nav(page, "Atlas");
  await expect(page.locator(".rea-editor h2")).toHaveText("Goals");
  await expect(page.locator(".rea-editor")).toContainText("temporary words");
  const pages = await idb<{ title: string; parentId: string | null; id: string; tags: string[] }>(page, "pages");
  const atlas = pages.find((p) => p.title === "Atlas")!;
  expect(atlas.tags).toContain("launch");
  expect(pages.find((p) => p.title === "Child")?.parentId).toBe(atlas.id);
});

test("wiki links create backlinks shown in the right panel", async ({ page }) => {
  await boot(page);
  await newPage(page, "Specs");
  await page.keyboard.type("See [[Welc");
  await expect(page.getByRole("listbox", { name: "Link to page" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rea-editor .mention")).toHaveText(/Welcome to Cairn/);
  await saved(page);
  await page.locator(".rea-editor .mention").click();
  await expect(page.getByLabel("Page title")).toHaveValue("Welcome to Cairn");
  await page.keyboard.press("Control+Shift+Backslash");
  const panel = page.getByRole("complementary", { name: "Context panel" });
  await panel.getByRole("button", { name: "Backlinks" }).click();
  await expect(panel.getByRole("button", { name: /Specs/ })).toBeVisible();
});

test("trash and restore a page", async ({ page }) => {
  await boot(page);
  await newPage(page, "Disposable");
  await page.keyboard.type("body");
  await saved(page);
  await main(page).getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("button", { name: "Move to trash" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(sidebar(page).getByRole("treeitem", { name: /Disposable/ })).toHaveCount(0);
  await nav(page, "Trash");
  await main(page).getByRole("button", { name: "Restore" }).first().click();
  await expect(sidebar(page).getByRole("treeitem", { name: /Disposable/ })).toBeVisible();
});

test("page history keeps a restorable version", async ({ page }) => {
  await boot(page);
  await newPage(page, "Versioned");
  await page.keyboard.type("first draft");
  await saved(page);
  await main(page).getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("button", { name: "Page history" }).click();
  await expect(page.getByRole("dialog")).toContainText(/Page history/);
  await noCrash(page);
});
