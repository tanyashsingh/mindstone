import { expect, test } from "@playwright/test";
import { boot, main, nav, noCrash } from "./helpers";

test("digest: today and this week from real data, saved as a page, and shown once a day on start", async ({ page }) => {
  await boot(page);
  // Real data: a task done, one overdue, one due tomorrow, and meeting notes with a decision and an action item.
  await page.evaluate(async () => {
    const repo = await import(/* @vite-ignore */ String("/src/data/repo.ts"));
    const { db } = await import(/* @vite-ignore */ String("/src/data/db.ts"));
    const { useApp } = await import(/* @vite-ignore */ String("/src/store/app.ts"));
    const ws = useApp.getState().workspaceId as string;
    const iso = (d: number) => { const x = new Date(Date.now() + d * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    const done = await repo.createTask(ws, { title: "Send the proposal" });
    await db().tasks.update(done.id, { status: "done", completedAt: Date.now() });
    await repo.createTask(ws, { title: "Renew passport", dueDate: iso(-2) });
    await repo.createTask(ws, { title: "Book dentist", dueDate: iso(1) });
  });
  await page.evaluate(async () => {
    // Put the notes in the shape recording summaries produce (headings with lists).
    const repo = await import(/* @vite-ignore */ String("/src/data/repo.ts"));
    const { useApp } = await import(/* @vite-ignore */ String("/src/store/app.ts"));
    const p = await repo.createPage(useApp.getState().workspaceId as string, null, { title: "Client sync" });
    const li = (t: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    await repo.savePageContent(p.id, { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Decisions" }] }, { type: "bulletList", content: [li("Ship the beta first")] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Action items" }] }, { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Priya: share the deck" }] }] }] },
    ] });
  });

  await nav(page, "Home");
  await main(page).getByRole("button", { name: "Today's digest" }).click();
  const dlg = page.getByRole("dialog");
  const body = dlg.getByTestId("digest");
  await expect(body).toContainText("Send the proposal");
  await expect(body.getByRole("heading", { name: "Overdue" })).toBeVisible();
  await expect(body).toContainText("Renew passport");
  await expect(body).toContainText("Book dentist");
  await expect(body).toContainText("Ship the beta first");
  await expect(body).toContainText("Priya: share the deck");
  await expect(dlg.getByRole("button", { name: "Write summary" })).toHaveCount(0); // AI is off; the digest still works
  await dlg.getByRole("button", { name: "This week" }).click();
  await expect(dlg).toContainText("Weekly digest");
  await dlg.getByRole("button", { name: "Save as page" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue(/^Weekly digest/);
  await expect(page.locator(".rea-editor").first()).toContainText("Renew passport");

  // Palette command
  await page.keyboard.press("Control+k");
  await page.keyboard.type("digest");
  await page.getByRole("dialog").getByRole("option", { name: /Today's digest/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Daily digest");
  await page.keyboard.press("Escape");

  // Daily digest on start: shown on the first start of the day only
  await page.keyboard.press("Control+,");
  await main(page).getByRole("button", { name: "Storage" }).click();
  await main(page).getByRole("switch", { name: "Daily digest" }).click();
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("Daily digest", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await noCrash(page);
});
