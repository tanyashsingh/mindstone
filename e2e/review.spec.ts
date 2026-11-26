import { expect, test, type Page } from "@playwright/test";
import { boot, idb, main, nav, newPage, noCrash, saved } from "./helpers";

const ed = (page: Page) => page.locator(".rea-editor").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Context panel" });

async function selectText(page: Page, text: string) {
  await ed(page).evaluate((root, t) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(t);
      if (i >= 0) { (root as HTMLElement).focus(); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); return; }
    }
    throw new Error(`text not found: ${t}`);
  }, text);
  await page.waitForTimeout(150); // ProseMirror picks up DOM selection changes on the next selectionchange event
}

test("comments on text: add, reply, resolve, reopen, survive reload, delete", async ({ page }) => {
  await boot(page);
  await newPage(page, "Review me");
  await page.keyboard.type("The budget is ten thousand dollars for the year.");
  await saved(page);

  await selectText(page, "ten thousand dollars");
  await page.getByRole("button", { name: "Comment (Ctrl+Alt+M)" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Is this before tax?");
  await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
  await expect(ed(page).locator("span.comment-mark")).toHaveText("ten thousand dollars");
  const thread = panel(page).getByTestId("comment-thread");
  await expect(thread).toHaveCount(1);
  await expect(thread).toContainText("Is this before tax?");
  await expect(thread).toContainText("ten thousand dollars");

  // Keyboard shortcut on a second selection
  await selectText(page, "the year");
  await page.keyboard.press("Control+Alt+m");
  await page.getByRole("dialog").getByRole("textbox").fill("Calendar or fiscal?");
  await page.keyboard.press("Enter");
  await expect(thread).toHaveCount(2);

  // Reply and resolve
  await thread.first().getByLabel("Reply").fill("Yes, before tax");
  await thread.first().getByLabel("Reply").press("Enter");
  await expect(thread.first()).toContainText("Yes, before tax");
  await thread.first().getByRole("button", { name: "Resolve thread" }).click();
  await expect(thread).toHaveCount(1);
  await saved(page);

  // Reload: marks and threads persist; clicking a mark opens its thread
  await page.reload();
  await nav(page, "Review me");
  await expect(ed(page).locator("span.comment-mark")).toHaveCount(2);
  await ed(page).locator("span.comment-mark", { hasText: "ten thousand" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByTestId("comment-thread")).toHaveCount(2); // the clicked (resolved) thread is shown
  await panel(page).getByRole("button", { name: "Reopen thread" }).click();
  await expect(panel(page).getByRole("button", { name: "Resolve thread" })).toHaveCount(2);

  // Delete a thread removes its highlight
  await panel(page).getByTestId("comment-thread").filter({ hasText: "Calendar or fiscal" }).getByRole("button", { name: "Delete thread" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(ed(page).locator("span.comment-mark")).toHaveCount(1);
  await saved(page);
  const comments = await idb<{ body: string }>(page, "comments");
  expect(comments.map((c) => c.body).sort()).toEqual(["Is this before tax?", "Yes, before tax"]);

  // Page-level comment
  await panel(page).getByLabel("Comment on this page").fill("Overall looks good");
  await panel(page).getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel(page).getByTestId("comment-thread").filter({ hasText: "Overall looks good" })).toHaveCount(1);
  await noCrash(page);
});

test("suggestion mode: tracked insertions and deletions, accept and reject", async ({ page }) => {
  await boot(page);
  await newPage(page, "Draft");
  await page.keyboard.type("We will ship the beta in March.");
  await saved(page);

  await main(page).getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("button", { name: "Suggest edits" }).click();
  await expect(page.getByRole("note", { name: "Suggestion mode" })).toBeVisible();

  // Replace "March" by selecting it and typing: becomes a deletion plus an insertion
  await selectText(page, "March");
  await page.keyboard.type("April");
  await expect(ed(page).locator("del.sugg-del")).toHaveText("March");
  await expect(ed(page).locator("ins.sugg-ins")).toHaveText("April");
  // Backspace over existing text marks it instead of removing it
  await selectText(page, "beta ");
  await page.keyboard.press("Backspace");
  await expect(ed(page).locator("del.sugg-del")).toHaveCount(2);
  await expect(ed(page)).toContainText("We will ship the beta in MarchApril.");
  await saved(page);

  await page.keyboard.press("Control+Shift+\\");
  await page.getByRole("button", { name: "Comments" }).click();
  const items = panel(page).getByTestId("suggestion");
  await expect(items).toHaveCount(3);

  // Accept the replacement, reject the deletion of "beta "
  await panel(page).getByRole("button", { name: "Accept: March" }).click();
  await panel(page).getByRole("button", { name: "Accept: April" }).click();
  await panel(page).getByRole("button", { name: "Reject: beta" }).click();
  await expect(ed(page).locator("del, ins")).toHaveCount(0);
  await expect(ed(page)).toHaveText("We will ship the beta in April.");
  await saved(page);

  // Accept all / reject all
  await ed(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Maybe.");
  await expect(ed(page).locator("ins.sugg-ins")).toHaveText(" Maybe.");
  await saved(page);
  await expect(items).toHaveCount(1);
  await panel(page).getByRole("button", { name: "Reject all" }).click();
  await expect(ed(page)).toHaveText("We will ship the beta in April.");

  // Turning suggestion mode off makes edits direct again
  await main(page).getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("button", { name: "Stop suggesting" }).click();
  await ed(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Done.");
  await expect(ed(page).locator("ins")).toHaveCount(0);
  await saved(page);
  await page.reload();
  await nav(page, "Draft");
  await expect(ed(page)).toHaveText("We will ship the beta in April. Done.");
  await noCrash(page);
});
