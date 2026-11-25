import { expect, test } from "@playwright/test";
import { boot, idb, main, nav, noCrash } from "./helpers";

test("database records stay consistent across table and board, with filter and sort", async ({ page }) => {
  await boot(page);
  await nav(page, "Databases");
  await main(page).getByRole("button", { name: "New database" }).click();
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "New record" }).click();
  await expect(grid.getByRole("row")).toHaveCount(4); // header + 3

  const names = ["Banana", "Apple", "Cherry"];
  for (let i = 0; i < 3; i++) {
    await grid.getByRole("row").nth(i + 1).getByRole("gridcell").first().click();
    await page.keyboard.type(names[i]!);
    await page.keyboard.press("Enter");
  }
  // Status on the first row
  await grid.getByRole("row").nth(1).getByRole("gridcell").nth(1).click();
  await page.getByRole("button", { name: "In progress" }).click();

  // Sort by name via the header menu
  await grid.getByRole("columnheader").first().getByRole("button").click();
  await page.getByRole("button", { name: "Sort ascending" }).click();
  await expect(grid.getByRole("row").nth(1)).toContainText("Apple");
  await expect(grid.getByRole("row").nth(3)).toContainText("Cherry");

  // Filter: name contains "an"
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.locator(".menu input.input").last().fill("an");
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("row")).toHaveCount(2);
  await expect(grid.getByRole("row").nth(1)).toContainText("Banana");

  // Board shows the same record in the right column
  await page.getByRole("button", { name: "Board" }).click();
  const col = page.locator("div.rounded-lg.bg-sunken").filter({ hasText: "In progress" });
  await expect(col).toContainText("Banana");
  await noCrash(page);
});

test("tasks: quick add parses metadata, completion and detail editing persist", async ({ page }) => {
  await boot(page);
  await nav(page, "Tasks");
  const input = page.getByLabel("New task");
  await input.fill("Call supplier tomorrow !high #ops");
  await input.press("Enter");
  await expect(main(page).getByRole("button", { name: "Call supplier" })).toBeVisible();
  await main(page).getByRole("button", { name: "Call supplier" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("combobox").first().selectOption("doing");
  await dlg.getByPlaceholder("Add a subtask").fill("Find number");
  await dlg.getByPlaceholder("Add a subtask").press("Enter");
  await expect(dlg).toContainText("Find number");
  await page.keyboard.press("Escape");
  await main(page).getByRole("button", { name: "Mark done" }).first().click();
  const tasks = await idb<{ title: string; status: string; priority: string; tags: string[]; parentTaskId: string | null }>(page, "tasks");
  const t = tasks.find((x) => x.title === "Call supplier")!;
  expect(t.priority).toBe("high");
  expect(t.tags).toEqual(["ops"]);
  expect(t.status).toBe("done");
  expect(tasks.some((x) => x.title === "Find number" && x.parentTaskId)).toBe(true);
  for (const mode of ["Board", "Eisenhower", "List"]) await main(page).getByRole("button", { name: mode, exact: true }).click();
  await noCrash(page);
});

test("projects: create, add task and milestone", async ({ page }) => {
  await boot(page);
  await nav(page, "Projects");
  await main(page).getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Website relaunch");
  await page.getByLabel("Project name").blur();
  await page.getByPlaceholder("Add a milestone").fill("Beta");
  await page.getByPlaceholder("Add a milestone").press("Enter");
  await page.getByLabel("New task").fill("Draft copy");
  await page.getByLabel("New task").press("Enter");
  await expect(main(page)).toContainText("Draft copy");
  await expect(main(page)).toContainText("Beta");
  await expect(main(page).getByText("0 / 1")).toBeVisible();
  await noCrash(page);
});

test("calendar: create an event and see it in week, month and agenda views", async ({ page }) => {
  await boot(page);
  await nav(page, "Calendar");
  await main(page).getByRole("button", { name: "Event", exact: true }).click();
  const dlg = page.getByRole("dialog");
  const title = dlg.locator("input").first();
  await title.fill("Design review");
  await title.blur();
  await page.keyboard.press("Escape");
  for (const v of ["week", "month", "agenda", "day"]) {
    await main(page).getByRole("button", { name: v, exact: true }).click();
    await noCrash(page);
  }
  await main(page).getByRole("button", { name: "week", exact: true }).click();
  await expect(main(page).getByText("Design review").first()).toBeVisible();
  const evs = await idb<{ title: string }>(page, "events");
  expect(evs.map((e) => e.title)).toContain("Design review");
});
