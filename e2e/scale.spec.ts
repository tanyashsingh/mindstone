import { expect, test, type Page } from "@playwright/test";
import { boot, main } from "./helpers";

/**
 * Large-workspace timings: 50,000 pages, 100,000 tasks and a 20,000-record database.
 * Opt-in (it takes a few minutes): $env:REA_SCALE="1"; npx playwright test e2e/scale.spec.ts
 * Budgets are generous for slower machines; the timings are printed.
 */
test.skip(!process.env.REA_SCALE, "set REA_SCALE=1 to run the large-workspace timings");
test.setTimeout(900_000);

async function seed(page: Page) {
  return page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ String("/src/data/db.ts"));
    const repo = await import(/* @vite-ignore */ String("/src/data/repo.ts"));
    const { useApp } = await import(/* @vite-ignore */ String("/src/store/app.ts"));
    const ws = useApp.getState().workspaceId as string;
    const words = "river stone garden ledger orbit pencil harbour meadow lantern copper violet signal quarry maple ember canyon falcon willow summit beacon".split(" ");
    const t0 = performance.now();
    let id = 0;
    const nid = () => `scale${String(++id).padStart(8, "0")}`;
    const now = Date.now();
    // 500 top-level pages with 99 children each = 50,000 pages, ~120 words each
    const pages: unknown[] = [];
    for (let i = 0; i < 500; i++) {
      const parent = nid();
      const make = (pid: string, parentId: string | null, n: number) => {
        const text = Array.from({ length: 120 }, (_, k) => words[(n * 7 + k * 3) % words.length]).join(" ") + ` marker${n}`;
        pages.push({ id: pid, workspaceId: ws, parentId, kind: "page", title: `Note ${n}`, icon: "", cover: "", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }, text, databaseId: null, tags: n % 50 === 0 ? ["scale"] : [], favorite: 0, locked: 0, sortKey: n, createdAt: now - n * 1000, updatedAt: now - n * 1000, lastOpenedAt: 0, deletedAt: 0 });
      };
      make(parent, null, i * 100);
      for (let c = 1; c < 100; c++) make(nid(), parent, i * 100 + c);
    }
    for (let i = 0; i < pages.length; i += 5000) await db().pages.bulkAdd(pages.slice(i, i + 5000));
    const tasks: unknown[] = [];
    for (let i = 0; i < 100_000; i++) {
      const due = new Date(now + ((i % 400) - 200) * 864e5);
      tasks.push({ id: nid(), workspaceId: ws, projectId: null, parentTaskId: null, title: `Task ${i} ${words[i % words.length]}`, description: "", status: i % 3 === 0 ? "done" : "todo", priority: "none", startDate: null, dueDate: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`, reminderAt: null, tags: [], dependsOn: [], recurrence: null, estimateMin: 0, actualMin: 0, important: 0, sortKey: i, completedAt: i % 3 === 0 ? now - i : 0, createdAt: now - i, updatedAt: now - i, deletedAt: 0 });
    }
    for (let i = 0; i < tasks.length; i += 10000) await db().tasks.bulkAdd(tasks.slice(i, i + 10000));
    const { database } = await repo.createDatabase(ws, null, "Big table");
    const [name, status, , date] = database.properties;
    const recs: unknown[] = [];
    for (let i = 0; i < 20_000; i++) recs.push({ id: nid(), databaseId: database.id, seq: i + 1, values: { [name.id]: `Row ${i}`, [status.id]: status.options[i % 3].id, [date.id]: "2026-12-01" }, sortKey: i, createdAt: now, updatedAt: now, deletedAt: 0 });
    for (let i = 0; i < recs.length; i += 5000) await db().records.bulkAdd(recs.slice(i, i + 5000));
    await db().databases.update(database.id, { nextSeq: 20_001 });
    return Math.round(performance.now() - t0);
  });
}

test("a very large workspace stays responsive", async ({ page }) => {
  await boot(page);
  const seeded = await seed(page);
  const times: Record<string, number> = { seed: seeded };
  const time = async (name: string, fn: () => Promise<unknown>) => { const t = Date.now(); try { await fn(); times[name] = Date.now() - t; } catch (e) { times[name] = -1; console.log("STEP FAILED", name, String(e).slice(0, 200)); } };

  await time("start (reload until the sidebar shows pages)", async () => {
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Sidebar" }).getByRole("treeitem").first()).toBeVisible({ timeout: 120_000 });
  });
  await time("first search (builds the index)", async () => {
    await page.keyboard.press("Control+k");
    await page.keyboard.type("marker31337");
    await expect(page.locator("#palette-list [role=option]").first()).toContainText("Note 31337", { timeout: 300_000 });
  });
  await time("second search", async () => {
    await page.keyboard.press("Control+a");
    await page.keyboard.type("marker4242");
    await expect(page.locator("#palette-list [role=option]").first()).toContainText("Note 4242", { timeout: 30_000 });
  });
  await time("open a page from search", async () => {
    await page.keyboard.press("Enter");
    await expect(page.locator(".rea-editor")).toContainText("marker4242", { timeout: 30_000 });
  });
  await time("expand a page with 99 children", async () => {
    const item = page.getByRole("navigation", { name: "Sidebar" }).getByRole("treeitem", { name: /Note 0\b/ }).first();
    await item.getByRole("button", { name: "Expand" }).click();
    await expect(page.getByRole("navigation", { name: "Sidebar" }).getByRole("treeitem", { name: /Note 99\b/ })).toBeVisible({ timeout: 30_000 });
  });
  await time("open Tasks (100,000 tasks)", async () => {
    await page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name: "Tasks" }).click();
    await expect(main(page).getByRole("button", { name: /^Task \d+/ }).first()).toBeVisible({ timeout: 60_000 });
  });
  await time("open Home", async () => {
    await page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name: "Home" }).click();
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
  });
  await time("open a 20,000-record database", async () => {
    await page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name: "Databases" }).click();
    await main(page).getByRole("button", { name: /Big table/ }).click();
    await expect(page.getByRole("grid").getByRole("row").nth(1)).toBeVisible({ timeout: 60_000 });
  });
  await time("filter the database by search", async () => {
    await main(page).getByPlaceholder("Search").fill("Row 19999");
    await expect(page.getByRole("grid").getByRole("row")).toHaveCount(2, { timeout: 30_000 });
  });
  console.log("SCALE TIMINGS (ms)", JSON.stringify(times, null, 1));
  const budget: Record<string, number> = {
    "start (reload until the sidebar shows pages)": 8000, "first search (builds the index)": 15000, "second search": 1500, "open a page from search": 3000,
    "expand a page with 99 children": 2000, "open Tasks (100,000 tasks)": 5000, "open Home": 5000, "open a 20,000-record database": 5000, "filter the database by search": 2000,
  };
  for (const [k, ms] of Object.entries(budget)) expect.soft(times[k], k).toBeLessThan(ms);
});
