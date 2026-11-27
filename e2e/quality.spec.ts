import { expect, test } from "@playwright/test";
import { boot, idb, main, nav, newPage, sidebar } from "./helpers";

// Regression tests for the 2026-11-27 quality audit (docs/quality-audit/APP_AUDIT.md).

test("quick add understands days of the week and calendar dates (QA-02)", async ({ page }) => {
  await boot(page);
  await nav(page, "Tasks");
  for (const t of ["Book venue next friday", "File taxes dec 5", "Ship in 3 days"]) {
    await page.getByLabel("New task").fill(t);
    await page.getByLabel("New task").press("Enter");
  }
  await expect.poll(async () => (await idb(page, "tasks")).length).toBeGreaterThanOrEqual(3);
  const tasks = await idb<{ title: string; dueDate: string | null }>(page, "tasks");
  for (const title of ["Book venue", "File taxes", "Ship"]) {
    const t = tasks.find((x) => x.title === title);
    expect(t, title).toBeTruthy();
    expect(t!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});

test("dialogs keep focus inside and give it back on close (QA-08)", async ({ page }) => {
  await boot(page);
  const searchItem = sidebar(page).getByRole("button", { name: /Search/ });
  await searchItem.focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.locator("input")).toBeFocused();
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(await palette.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(searchItem).toBeFocused();

  // A regular dialog: focus moves in, Shift+Tab wraps, Escape returns focus.
  await nav(page, "Home");
  const digest = main(page).getByRole("button", { name: "Today's digest" });
  await digest.focus();
  await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog").last();
  await expect(dlg).toBeVisible();
  await expect.poll(() => dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+Tab");
  expect(await dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(digest).toBeFocused();
});

test("copy buttons confirm, new databases have no glyph icon, sidebar sections remember state (QA-03,04,06,07)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await boot(page);
  // No placeholder "Shared" section
  await expect(sidebar(page).getByRole("button", { name: "Shared", exact: true })).toHaveCount(0);
  // Collapsible sections say whether they are open, and remember it across a reload
  const recent = sidebar(page).getByRole("button", { name: "Recent", exact: true });
  await expect(recent).toHaveAttribute("aria-expanded", "false");
  await recent.click();
  await expect(recent).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(sidebar(page).getByRole("button", { name: "Recent", exact: true })).toHaveAttribute("aria-expanded", "true");

  await nav(page, "Databases");
  await main(page).getByRole("button", { name: "New database" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  const pages = await idb<{ kind: string; icon: string }>(page, "pages");
  expect(pages.filter((p) => p.kind === "database").every((p) => p.icon === "")).toBe(true);
  await expect(main(page).getByText("▦")).toHaveCount(0);

  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "Synchronization", exact: true }).click();
  const copy = main(page).getByRole("button", { name: /Copy sync code/ });
  if (await copy.count()) {
    await copy.click();
    await expect(page.getByText(/copied to the clipboard/i)).toBeVisible();
  }
});

test("inbox activity shows a page's current name (QA-09)", async ({ page }) => {
  await boot(page);
  await newPage(page, "Renamed after creation");
  await nav(page, "Inbox");
  await expect(main(page).getByRole("button", { name: "“Renamed after creation”" })).toBeVisible();
});

test("Files view makes no state update during render (QA-01)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await boot(page);
  await nav(page, "Files");
  await expect(main(page).getByRole("heading", { name: "Files" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors.filter((e) => e.includes("hasn't mounted yet"))).toEqual([]);
});

test("a damaged backup file is refused with a plain message and changes nothing (QA-11)", async ({ page }) => {
  await boot(page);
  const before = (await idb(page, "pages")).length;
  await page.keyboard.press("Control+,");
  await main(page).getByRole("button", { name: "Backup & restore" }).click();
  const input = main(page).locator('input[type="file"][accept*="json"]');
  await input.setInputFiles({ name: "notes.rea.json", mimeType: "application/json", buffer: Buffer.from("{ this is not json") });
  await expect(page.getByText(/Nothing was changed\. “notes\.rea\.json” isn't a Mindstone backup/)).toBeVisible();
  await input.setInputFiles({ name: "other.json", mimeType: "application/json", buffer: Buffer.from('{"hello":"world"}') });
  await expect(page.getByText(/Nothing was changed\. Not a Mindstone backup file/)).toBeVisible();
  expect((await idb(page, "pages")).length).toBe(before);
});

test("Ctrl+F opens find in page even when the text isn't focused (QA-12)", async ({ page }) => {
  await boot(page);
  await newPage(page, "Find me");
  await page.keyboard.type("alpha beta alpha");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Find in page")).toBeFocused();
});
