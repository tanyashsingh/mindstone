import { expect, test } from "@playwright/test";
import { boot, idb, main, nav, newPage, saved } from "./helpers";

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
  await nav(page, "REA Intelligence");
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

  await nav(page, "REA Intelligence");
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

test("a stopped server produces a clear error, not a crash", async ({ page }) => {
  await boot(page);
  await useOllama(page);
  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "AI providers", exact: true }).click();
  const card = main(page).locator(".panel").filter({ hasText: "Ollama (local)" });
  await card.getByLabel("Endpoint").fill("http://127.0.0.1:9"); // nothing listens on the discard port
  await nav(page, "REA Intelligence");
  await main(page).getByLabel("Context").selectOption("general");
  await main(page).getByLabel("Message").fill("hello");
  await main(page).getByLabel("Message").press("Enter");
  await expect(main(page).getByText(/Could not reach Ollama/)).toBeVisible({ timeout: 30_000 });
});
