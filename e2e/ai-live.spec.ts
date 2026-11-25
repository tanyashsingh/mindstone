import { expect, test } from "@playwright/test";
import { boot, idb, main, nav, newPage, saved } from "./helpers";
import { makePdf } from "./fixtures";

/**
 * Live AI checks against a local Ollama server (no cloud, no keys).
 * Opt-in: $env:REA_LIVE_AI="1"; npx playwright test e2e/ai-live.spec.ts
 * Needs: ollama serve, plus `ollama pull llama3.2` and `ollama pull nomic-embed-text`.
 */
test.skip(!process.env.REA_LIVE_AI, "set REA_LIVE_AI=1 with Ollama running to run live AI tests");
test.setTimeout(240_000);

async function useOllama(page: import("@playwright/test").Page) {
  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "AI providers", exact: true }).click();
  const card = main(page).locator(".panel").filter({ hasText: "Ollama (local)" });
  await card.getByRole("radio").check();
  await card.getByRole("button", { name: "Test connection" }).click();
  await expect(card.getByText(/Connected · \d+ models available/)).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Send test message" }).click();
  await expect(card.getByText(/tokens$/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("status")).toContainText("Ollama (local) · llama3.2");
}

test("chat with a local model, with history and token usage", async ({ page }) => {
  await boot(page);
  await useOllama(page);
  await nav(page, "Cairn Intelligence");
  await main(page).getByLabel("Context").selectOption("general");
  await main(page).getByLabel("Message").fill("Reply with exactly the word PINEAPPLE and nothing else.");
  await main(page).getByLabel("Message").press("Enter");
  await expect(main(page).locator(".rea-editor").last()).toContainText(/pineapple/i, { timeout: 120_000 });
  const msgs = await idb<{ role: string; outputTokens: number; provider: string }>(page, "aiMessages");
  const reply = msgs.find((m) => m.role === "assistant")!;
  expect(reply.provider).toBe("ollama");
  expect(reply.outputTokens).toBeGreaterThan(0);
  expect((await idb(page, "aiConversations")).length).toBe(1);
});

test("writing tool previews a summary and replaces the selection on accept", async ({ page }) => {
  await boot(page);
  await useOllama(page);
  await newPage(page, "Long note");
  await page.keyboard.type("Our team met on Monday to discuss the product launch. We agreed to move the launch to March because the payment integration is not finished. Sara will finish the integration by February 20. Tom will update the marketing site. We also decided to hire a second designer.");
  await saved(page);
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Ask AI" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("Ollama (local)");
  await expect(dlg).toContainText("on this computer");
  await dlg.getByRole("button", { name: "Summarize" }).click();
  await expect(dlg.getByRole("button", { name: "Replace selection" })).toBeVisible({ timeout: 120_000 });
  const suggestion = await dlg.locator(".rea-editor").innerText();
  expect(suggestion.length).toBeGreaterThan(20);
  await dlg.getByRole("button", { name: "Replace selection" }).click();
  await expect(page.locator(".rea-editor").first()).not.toContainText("We also decided to hire a second designer.");
  await page.locator(".rea-editor").first().click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".rea-editor").first()).toContainText("We also decided to hire a second designer.");
});

test("workspace-aware answer cites the right page, with semantic index", async ({ page }) => {
  await boot(page);
  await useOllama(page);
  await newPage(page, "Launch logistics");
  await page.keyboard.type("Internal notes. The launch codename is BLUEFIN and the venue is the Harbour Hall in Lisbon.");
  await saved(page);
  await newPage(page, "Groceries");
  await page.keyboard.type("Milk, eggs, bread, coffee.");
  await saved(page);
  await page.waitForTimeout(1700); // debounced search index refresh

  await nav(page, "Cairn Intelligence");
  await main(page).getByRole("button", { name: "Index" }).click();
  await expect(page.getByText(/Indexed \d+ pages for semantic search/)).toBeVisible({ timeout: 120_000 });
  const emb = await idb<{ vector: number[]; model: string }>(page, "embeddings");
  expect(emb.length).toBeGreaterThan(0);
  expect(emb[0]!.vector.length).toBeGreaterThan(100);

  await main(page).getByLabel("Context").selectOption("workspace");
  await main(page).getByLabel("Message").fill("What is the launch codename, and where is the venue?");
  await main(page).getByLabel("Message").press("Enter");
  const answer = main(page).locator(".rea-editor").last();
  await expect(answer).toContainText(/bluefin/i, { timeout: 120_000 });
  await expect(main(page).getByRole("button", { name: /\[\d\] Launch logistics/ })).toBeVisible();
  await main(page).getByRole("button", { name: /\[\d\] Launch logistics/ }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Launch logistics");
});

test("answers from an uploaded PDF and cites the file", async ({ page }) => {
  await boot(page);
  await useOllama(page);
  await nav(page, "Files");
  const chooser = page.waitForEvent("filechooser");
  await main(page).getByRole("button", { name: "Upload" }).click();
  await (await chooser).setFiles({ name: "warranty.pdf", mimeType: "application/pdf", buffer: makePdf(["Warranty terms", "The warranty period for the KX-9 drill is 36 months.", "Claims require the original receipt."]) });
  await expect(main(page).getByText("Searchable")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1700);
  await nav(page, "Cairn Intelligence");
  await main(page).getByRole("button", { name: "Index" }).click();
  await expect(page.getByText(/Indexed \d+ pages for semantic search/)).toBeVisible({ timeout: 120_000 });
  await main(page).getByLabel("Context").selectOption("workspace");
  await main(page).getByLabel("Message").fill("How long is the warranty period for the KX-9 drill?");
  await main(page).getByLabel("Message").press("Enter");
  await expect(main(page).locator(".rea-editor").last()).toContainText(/36 months|three years/i, { timeout: 120_000 });
  await expect(main(page).getByRole("button", { name: /\[\d\] 📎 warranty\.pdf/ })).toBeVisible();
});

test("asking for tasks yields a proposal that creates real tasks after confirmation", async ({ page }) => {
  await boot(page);
  await useOllama(page);
  await nav(page, "Cairn Intelligence");
  await main(page).getByLabel("Context").selectOption("general");
  await main(page).getByLabel("Message").fill("can you make a task for tomorrow , i have flight at 12 am and then train at 2 pm");
  await main(page).getByLabel("Message").press("Enter");
  const card = main(page).getByRole("group", { name: "Proposed tasks" });
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(main(page).getByText("cairn-tasks")).toHaveCount(0); // raw JSON is never shown
  expect(await idb(page, "tasks")).toHaveLength(0); // nothing is created before confirming
  const create = card.getByRole("button", { name: /^Create \d+ tasks?$/ });
  const n = Number((await create.innerText()).match(/\d+/)![0]);
  await create.click();
  await expect(card).toContainText("Added to Tasks");
  const tasks = await idb<{ title: string; dueDate: string | null; reminderAt: number | null }>(page, "tasks");
  expect(tasks).toHaveLength(n);
  const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  expect(tasks.some((t) => t.dueDate === tomorrow)).toBe(true);
  console.log("PROPOSED", JSON.stringify(tasks.map((t) => [t.title, t.dueDate, t.reminderAt && new Date(t.reminderAt).toTimeString().slice(0, 5)])));
});

test("no placeholder citations, and only cited sources are shown", async ({ page }) => {
  await boot(page);
  await useOllama(page);
  await nav(page, "Cairn Intelligence");
  await main(page).getByLabel("Context").selectOption("workspace");
  await main(page).getByLabel("Message").fill("Suggest a project plan from my notes");
  await main(page).getByLabel("Message").press("Enter");
  const answer = main(page).locator(".rea-editor").last();
  await expect(answer).not.toBeEmpty({ timeout: 120_000 });
  await expect(main(page).getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 120_000 }); // reply finished
  const text = await answer.innerText();
  expect(text).not.toContain("[n]");
  const chips = await main(page).locator("button.chip.c-blue").allInnerTexts();
  for (const c of chips) expect(text).toContain(c.match(/^\[\d+\]/)![0]);
});

test("a stopped server produces a clear error, not a crash", async ({ page }) => {
  await boot(page);
  await useOllama(page);
  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "AI providers", exact: true }).click();
  const card = main(page).locator(".panel").filter({ hasText: "Ollama (local)" });
  await card.getByLabel("Endpoint").fill("http://127.0.0.1:9"); // nothing listens on the discard port
  await nav(page, "Cairn Intelligence");
  await main(page).getByLabel("Context").selectOption("general");
  await main(page).getByLabel("Message").fill("hello");
  await main(page).getByLabel("Message").press("Enter");
  await expect(main(page).getByText(/Could not reach Ollama/)).toBeVisible({ timeout: 30_000 });
});
