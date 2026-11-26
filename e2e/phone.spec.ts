import { expect, test } from "@playwright/test";
import { idb, newPage, noCrash } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("phone layout: bottom bar, menu drawer, capture, search, and pages that fit the screen", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByRole("navigation", { name: "Phone navigation" });
  await expect(bar).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toHaveCount(0); // the menu starts closed
  await expect(page.getByRole("complementary", { name: "Context panel" })).toHaveCount(0);

  // Capture a task from the bottom bar
  await bar.getByRole("button", { name: "Capture" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Buy stamps tomorrow");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await idb<{ title: string }>(page, "tasks")).map((t) => t.title)).toContain("Buy stamps");
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Tasks" }).click();
  await expect(page.getByRole("region", { name: "Main view" })).toContainText("Buy stamps");

  // The menu opens as a drawer and closes after choosing a page
  await bar.getByRole("button", { name: "Menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await drawer.getByRole("treeitem", { name: /Welcome to Mindstone/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByLabel("Page title")).toHaveValue("Welcome to Mindstone");

  // Writing works and nothing overflows sideways
  await newPage(page, "Phone note");
  await page.keyboard.type("Written on a phone");
  await expect.poll(async () => (await idb<{ title: string; text: string }>(page, "pages")).find((p) => p.title === "Phone note")?.text).toContain("Written on a phone");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await bar.getByRole("button", { name: "Search" }).click();
  await page.keyboard.type("phone note");
  await expect(page.getByRole("dialog").getByRole("option").first()).toContainText("Phone note");
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Home" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await noCrash(page);
});
