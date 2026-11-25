import { expect, type Page } from "@playwright/test";

export async function boot(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  return errors;
}

export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
export const main = (page: Page) => page.getByRole("region", { name: "Main view" });

export async function nav(page: Page, label: string) {
  // Navigation items are buttons; pages in the tree are treeitems.
  await sidebar(page).getByRole("button", { name: label, exact: false }).or(sidebar(page).getByRole("treeitem", { name: label, exact: false })).first().click();
}

/** Creates a page with Ctrl+N and gives it a title; leaves the caret in the editor. */
export async function newPage(page: Page, title: string) {
  await page.keyboard.press("Control+n");
  const t = page.getByLabel("Page title");
  await expect(t).toBeFocused();
  await t.fill(title);
  await t.press("Enter");
  await expect(page.locator(".rea-editor")).toBeFocused();
}

/** Waits until the status bar reports a completed save. */
export async function saved(page: Page) {
  await expect(page.getByRole("status")).toContainText("Saved locally", { timeout: 10_000 });
}

/** Reads all rows of an IndexedDB store from the page. */
export async function idb<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (s) => {
    const req = indexedDB.open("rea");
    await new Promise((r) => (req.onsuccess = r));
    return await new Promise<unknown[]>((r) => {
      const q = req.result.transaction(s).objectStore(s).getAll();
      q.onsuccess = () => r(q.result);
    });
  }, store) as Promise<T[]>;
}

export async function noCrash(page: Page) {
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
}
