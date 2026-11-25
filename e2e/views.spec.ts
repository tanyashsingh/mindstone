import { expect, test } from "@playwright/test";
import { boot, main, nav, newPage, noCrash, saved } from "./helpers";

test("every database view type and a formula property work", async ({ page }) => {
  await boot(page);
  await nav(page, "Databases");
  await main(page).getByRole("button", { name: "New database" }).click();
  const grid = page.getByRole("grid");
  await page.getByRole("button", { name: "New record" }).click();
  await grid.getByRole("row").nth(1).getByRole("gridcell").first().click();
  await page.keyboard.type("Alpha");
  await page.keyboard.press("Enter");

  // Add a Number property, then a Formula using it
  await grid.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Number", exact: true }).click();
  await grid.getByRole("row").nth(1).getByRole("gridcell").nth(4).click();
  await page.keyboard.type("21");
  await page.keyboard.press("Enter");
  await grid.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Formula", exact: true }).click();
  await grid.getByRole("columnheader").filter({ hasText: "Formula" }).getByRole("button").click();
  await page.getByPlaceholder('prop("Price") * prop("Qty")').fill('prop("Number") * 2');
  await page.getByRole("button", { name: "Save formula" }).click();
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("row").nth(1)).toContainText("42");

  // Add each remaining view type and render it
  for (const v of ["List", "Gallery", "Timeline", "Chart"]) {
    await main(page).getByRole("button", { name: "Add view" }).click();
    await page.getByRole("button", { name: v, exact: true }).click();
    await noCrash(page);
  }
  await main(page).getByRole("button", { name: "List" }).click();
  await expect(main(page)).toContainText("Alpha");
  await main(page).getByRole("button", { name: "Gallery" }).click();
  await expect(main(page)).toContainText("Alpha");
  await main(page).getByRole("button", { name: "Calendar" }).click();
  await noCrash(page);
});

test("right panel tabs and split view", async ({ page }) => {
  await boot(page);
  await newPage(page, "Panel test");
  await page.keyboard.type("/h1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Section A");
  await saved(page);
  await page.keyboard.press("Control+Shift+Backslash");
  const panel = page.getByRole("complementary", { name: "Context panel" });
  await panel.getByRole("button", { name: "Outline" }).click();
  await expect(panel.getByRole("button", { name: "Section A" })).toBeVisible();
  for (const tab of ["Backlinks", "Related", "Properties", "Activity"]) {
    await panel.getByRole("button", { name: tab }).click();
    await noCrash(page);
  }
  await panel.getByRole("button", { name: "Comments" }).click();
  await panel.getByPlaceholder("Add a comment").fill("Looks good");
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel).toContainText("Looks good");

  await main(page).getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("button", { name: "Open in split view" }).click();
  await expect(page.getByRole("region", { name: "Split view" }).getByLabel("Page title")).toHaveValue("Panel test");
});
