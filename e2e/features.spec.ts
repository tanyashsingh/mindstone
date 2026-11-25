import { expect, test } from "@playwright/test";
import { boot, idb, main, nav, newPage, saved } from "./helpers";
import { makeDocx, makePdf } from "./fixtures";

test("PDF and Word attachments become searchable", async ({ page }) => {
  await boot(page);
  await nav(page, "Files");
  const chooser = page.waitForEvent("filechooser");
  await main(page).getByRole("button", { name: "Upload" }).click();
  await (await chooser).setFiles([
    { name: "supplier-contract.pdf", mimeType: "application/pdf", buffer: makePdf(["Supplier agreement", "Delivery window: Tuesdays only", "Penalty clause ZEBRAFISH applies"]) },
    { name: "onboarding.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: makeDocx(["Onboarding checklist", "Order a laptop from MARMALADE IT"]) },
  ]);
  await expect(main(page).getByText("Searchable")).toHaveCount(2, { timeout: 20_000 });
  const atts = await idb<{ name: string; text: string }>(page, "attachments");
  expect(atts.find((a) => a.name.endsWith(".pdf"))?.text).toContain("Penalty clause ZEBRAFISH applies");
  expect(atts.find((a) => a.name.endsWith(".docx"))?.text).toContain("MARMALADE");

  // The Word text is shown in the preview, and both files are found by Ctrl+K.
  await main(page).getByRole("button", { name: "onboarding.docx" }).click();
  await expect(page.getByRole("dialog")).toContainText("Order a laptop from MARMALADE IT");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1700); // debounced search index refresh
  for (const [q, file] of [["zebrafish", "supplier-contract.pdf"], ["marmalade", "onboarding.docx"]] as const) {
    await page.keyboard.press("Control+k");
    const pal = page.getByRole("dialog", { name: "Command palette" });
    await pal.getByRole("combobox").fill(q);
    await expect(pal.getByRole("option").first()).toContainText(file);
    await page.keyboard.press("Escape");
  }
});

test("database record templates: save, create from, delete", async ({ page }) => {
  await boot(page);
  await nav(page, "Databases");
  await main(page).getByRole("button", { name: "New database" }).click();
  // Create a record through the main New button; it opens in a window.
  await main(page).getByRole("button", { name: "New", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button").filter({ hasText: "Empty" }).first().click();
  await page.keyboard.type("Weekly report");
  await page.keyboard.press("Enter");
  await dlg.getByRole("button", { name: "Save as template" }).click();
  await page.getByRole("dialog").last().locator("input").fill("Weekly");
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("Saved template “Weekly”")).toBeVisible();
  await page.keyboard.press("Escape");

  await main(page).getByRole("button", { name: "New from template" }).click();
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Weekly report");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("grid").getByRole("row").filter({ hasText: "Weekly report" })).toHaveCount(2);

  await main(page).getByRole("button", { name: "New from template" }).click();
  await page.getByRole("button", { name: "Delete template Weekly" }).click();
  await expect(page.getByText("Open a record and choose")).toBeVisible();
});

test("drag handle moves a block, and the move is undoable", async ({ page }) => {
  await boot(page);
  await newPage(page, "Reorder");
  for (const t of ["First", "Second", "Third"]) {
    await page.keyboard.type(t);
    await page.keyboard.press("Enter");
  }
  const paras = page.locator(".rea-editor > p");
  await expect(paras.nth(2)).toHaveText("Third");

  // Hover "Third" to reveal its handle, then drag it above "First".
  await paras.nth(2).hover();
  const handle = page.getByRole("button", { name: /Drag to move block/ });
  await expect(handle).toBeVisible();
  const target = await paras.nth(0).boundingBox();
  await handle.dragTo(page.locator(".rea-editor"), { targetPosition: { x: 1, y: target!.y - (await page.locator(".rea-editor").boundingBox())!.y + 3 } });
  await expect(paras.nth(0)).toHaveText("Third");
  await expect(paras.nth(1)).toHaveText("First");
  await expect(page.locator(".rea-editor > p", { hasText: "Third" })).toHaveCount(1);
  await saved(page);

  await page.keyboard.press("Control+z");
  await expect(paras.nth(0)).toHaveText("First");

  // Clicking the handle selects the whole block; Ctrl+D duplicates it.
  await paras.nth(1).hover();
  await page.getByRole("button", { name: /Drag to move block/ }).click();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".rea-editor > p", { hasText: "Second" })).toHaveCount(2);
});
