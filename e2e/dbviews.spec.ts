import { expect, test, type Page } from "@playwright/test";
import { boot, idb, main, nav, noCrash } from "./helpers";

const grid = (page: Page) => page.getByRole("grid");
const row = (page: Page, i: number) => grid(page).getByRole("row").nth(i);

async function newDatabase(page: Page, title: string, records: string[]) {
  await nav(page, "Databases");
  await main(page).getByRole("button", { name: "New database" }).click();
  await page.getByLabel("Page title").fill(title);
  await expect(grid(page)).toBeVisible();
  for (const name of records) {
    await page.getByRole("button", { name: "New record" }).click();
    const r = row(page, records.indexOf(name) + 1);
    await r.getByRole("gridcell").nth(1).click();
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    await expect(r).toContainText(name);
  }
}

async function addProperty(page: Page, type: string) {
  await grid(page).getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: type, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function setDate(page: Page, rowIndex: number, col: number, iso: string) {
  await row(page, rowIndex).getByRole("gridcell").nth(col + 1).click(); // cell 0 is the row's selection checkbox
  const input = page.locator('input[type="date"]').first();
  await input.fill(iso);
  await input.press("Enter");
}

test("two-way relations and rollups across databases", async ({ page }) => {
  await boot(page);
  await newDatabase(page, "Initiatives", ["Launch", "Hiring"]);
  await newDatabase(page, "Errands", ["Write copy", "Design", "Interview"]);

  // Relation from Work to Projects, made two-way
  await addProperty(page, "Relation");
  await grid(page).getByRole("columnheader").filter({ hasText: "Relation" }).getByRole("button").click();
  await page.getByLabel("Related database").selectOption({ label: "Initiatives" });
  await page.getByText(/Two-way: also show on Initiatives/).click();
  await page.keyboard.press("Escape");

  // Link records with the picker
  const link = async (i: number, target: string) => {
    await row(page, i).getByRole("gridcell").nth(5).click();
    await page.getByRole("button", { name: target }).click();
    await page.keyboard.press("Escape");
  };
  await link(1, "Launch");
  await link(2, "Launch");
  await link(3, "Hiring");
  await expect(row(page, 1)).toContainText("Launch");

  // The other database shows the links back, and a rollup counts them
  await nav(page, "Initiatives");
  const header = grid(page).getByRole("columnheader").filter({ hasText: "Errands" });
  await expect(header).toHaveCount(1);
  await expect(row(page, 1)).toContainText("Write copy");
  await expect(row(page, 1)).toContainText("Design");
  await expect(row(page, 2)).toContainText("Interview");

  await addProperty(page, "Rollup");
  await grid(page).getByRole("columnheader").filter({ hasText: "Rollup" }).getByRole("button").click();
  await page.getByLabel("Rollup relation").selectOption({ label: "Errands" });
  await page.getByLabel("Rollup property").selectOption({ label: "Name" });
  await page.getByLabel("Rollup calculation").selectOption("count");
  await page.keyboard.press("Escape");
  await expect(row(page, 1).getByRole("gridcell").last()).toHaveText("2");
  await expect(row(page, 2).getByRole("gridcell").last()).toHaveText("1");

  // Unlink from the Projects side: Work follows
  await row(page, 2).getByRole("gridcell").nth(5).click();
  await page.getByRole("button", { name: "Interview" }).click();
  await page.keyboard.press("Escape");
  await expect(row(page, 2).getByRole("gridcell").last()).toHaveText("0");
  await nav(page, "Errands");
  await expect(row(page, 3)).not.toContainText("Hiring");
  await noCrash(page);
});

test("chart view: bars, horizontal bars, line, pie and donut with real values", async ({ page }) => {
  await boot(page);
  await newDatabase(page, "Pipeline", ["A", "B", "C"]);
  // Status: two "In progress", one "Done"
  for (const [i, s] of [[1, "In progress"], [2, "In progress"], [3, "Done"]] as const) {
    await row(page, i).getByRole("gridcell").nth(2).click();
    await page.getByRole("button", { name: s }).click();
  }
  await addProperty(page, "Number");
  for (const [i, v] of [[1, "10"], [2, "30"], [3, "5"]] as const) {
    await row(page, i).getByRole("gridcell").nth(5).click();
    await page.keyboard.type(v);
    await page.keyboard.press("Enter");
  }
  await main(page).getByRole("button", { name: "Add view" }).click();
  await page.getByRole("button", { name: "Chart", exact: true }).click();
  await page.getByLabel("Chart group").selectOption({ label: "Status" });
  const marks = page.getByTestId("chart-mark");
  const values = async () => Object.fromEntries(await marks.evaluateAll((els) => els.map((e) => [e.getAttribute("data-label"), Number(e.getAttribute("data-value"))])));
  await expect.poll(values).toMatchObject({ "In progress": 2, Done: 1 });

  for (const kind of ["hbar", "line", "pie", "donut", "bar"]) {
    await page.getByLabel("Chart type").selectOption(kind);
    await expect(page.getByTestId("chart")).toHaveAttribute("data-kind", kind);
    await expect.poll(values).toMatchObject({ "In progress": 2, Done: 1 });
  }
  await page.getByLabel("Chart value").selectOption("sum");
  await page.getByLabel("Chart property").selectOption({ label: "Number" });
  await expect.poll(values).toMatchObject({ "In progress": 40, Done: 5 });
  await page.getByLabel("Chart value").selectOption("avg");
  await expect.poll(values).toMatchObject({ "In progress": 20, Done: 5 });
  await expect(page.getByRole("figure")).toHaveAccessibleName("Average of Number by Status");

  // The setting is saved with the view
  await page.reload();
  await nav(page, "Pipeline");
  await main(page).getByRole("button", { name: "Chart" }).click();
  await expect.poll(values).toMatchObject({ "In progress": 20, Done: 5 });
  await noCrash(page);
});

test("timeline view: drag to move, drag ends to resize, zoom and today line", async ({ page }) => {
  await boot(page);
  await newDatabase(page, "Roadmap", ["Alpha", "Beta"]);
  await addProperty(page, "Date range");
  // Alpha: Dec 1 → Dec 3 (date range, column 4); Beta: single date Dec 10 (Date, column 3)
  await row(page, 1).getByRole("gridcell").nth(5).click();
  const [s, e] = [page.locator('input[type="date"]').nth(0), page.locator('input[type="date"]').nth(1)];
  await s.fill("2026-12-01");
  await e.fill("2026-12-03");
  await page.keyboard.press("Escape");
  await setDate(page, 2, 3, "2026-12-10");

  await main(page).getByRole("button", { name: "Add view" }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await main(page).getByRole("button", { name: "Properties" }).click();
  await page.getByRole("button", { name: "Date range" }).click();
  await page.keyboard.press("Escape");
  const bar = page.getByTestId("timeline-bar").filter({ hasText: "Alpha" });
  await expect(bar).toHaveAccessibleName("Alpha: 2026-12-01 to 2026-12-03");
  await expect(page.getByTestId("today-line")).toHaveCount(1);

  const dragBy = async (el: ReturnType<Page["locator"]>, dx: number) => {
    const b = (await el.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
  };
  // Day zoom: 40 px per day. Move Alpha 2 days later.
  await dragBy(bar.locator("span").first(), 80);
  await expect(bar).toHaveAccessibleName("Alpha: 2026-12-03 to 2026-12-05");
  // Stretch the end 3 days
  await bar.hover();
  await dragBy(bar.getByTestId("bar-end"), 120);
  await expect(bar).toHaveAccessibleName("Alpha: 2026-12-03 to 2026-12-08");
  // Pull the start 1 day earlier
  await bar.hover();
  await dragBy(bar.getByTestId("bar-start"), -40);
  await expect(bar).toHaveAccessibleName("Alpha: 2026-12-02 to 2026-12-08");

  const recs = await idb<{ values: Record<string, unknown> }>(page, "records");
  expect(recs.some((r) => JSON.stringify(r.values).includes('"start":"2026-12-02","end":"2026-12-08"'))).toBe(true);

  // Zoom changes the scale
  const w1 = (await bar.boundingBox())!.width;
  await main(page).getByRole("button", { name: "Week", exact: true }).click();
  await expect.poll(async () => (await bar.boundingBox())!.width).toBeLessThan(w1 / 2);
  await main(page).getByRole("button", { name: "Month", exact: true }).click();
  await expect(main(page).getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
  await noCrash(page);
});
