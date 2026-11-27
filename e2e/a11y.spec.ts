import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boot, main, nav, newPage, saved } from "./helpers";

/** Serious and critical WCAG 2.1 A/AA problems on the current screen, as readable lines. */
async function audit(page: Page, where: string): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${where}: ${v.id} (${v.impact}) ${v.help} :: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function seed(page: Page) {
  await newPage(page, "Accessibility check");
  await page.keyboard.type("A paragraph of text with a #tag.");
  await saved(page);
}

for (const theme of ["light", "dark"] as const) {
  test(`main screens have no serious accessibility problems (${theme})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: theme });
    await boot(page);
    await seed(page);
    const problems: string[] = [];
    problems.push(...(await audit(page, "page editor")));
    for (const view of ["Home", "Inbox", "Tasks", "Projects", "Calendar", "Databases", "Knowledge graph", "Files", "Templates", "Mindstone Intelligence"]) {
      await nav(page, view);
      await page.waitForTimeout(300);
      problems.push(...(await audit(page, view)));
    }
    await nav(page, "Databases");
    await main(page).getByRole("button", { name: "New database" }).click();
    await expect(page.getByRole("grid")).toBeVisible();
    problems.push(...(await audit(page, "database table")));
    await page.keyboard.press("Control+,");
    for (const sec of ["General", "Appearance", "Security", "Synchronization", "Plugins", "Backup & restore"]) {
      await main(page).getByRole("button", { name: sec, exact: true }).click();
      problems.push(...(await audit(page, `settings/${sec}`)));
    }
    await page.keyboard.press("Control+k");
    await page.keyboard.type("acc");
    await page.waitForTimeout(400); // let the opening animation finish before measuring contrast
    problems.push(...(await audit(page, "command palette")));
    expect(problems).toEqual([]);
  });
}

test("phone layout has no serious accessibility problems", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
  const problems = await audit(page, "phone home");
  await page.getByRole("button", { name: "Menu" }).click();
  problems.push(...(await audit(page, "phone menu")));
  expect(problems).toEqual([]);
});

test("keyboard only: create a page, write, find it, open settings, and see where focus is", async ({ page }) => {
  await boot(page);
  // Ctrl+N creates a page and focuses its title; Enter moves into the text.
  await page.keyboard.press("Control+n");
  await expect(page.getByLabel("Page title")).toBeFocused();
  await page.keyboard.type("Keyboard note");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rea-editor")).toBeFocused();
  await page.keyboard.type("Typed without a mouse.");
  await saved(page);
  // Find it with the palette and open it with Enter
  await page.keyboard.press("Control+k");
  await page.keyboard.type("keyboard note");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Page title")).toHaveValue("Keyboard note");
  // Tab reaches the sidebar controls, and focus is visible (an outline is drawn)
  await page.keyboard.press("Control+,");
  // Tab to the next button or link (focus order can differ between systems) and check a focus ring is drawn.
  let outline = "none";
  for (let i = 0; i < 15 && outline === "none"; i++) {
    await page.keyboard.press("Tab");
    outline = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el && el !== document.body && /^(BUTTON|A)$/.test(el.tagName) ? getComputedStyle(el).outlineStyle : "none"; });
  }
  expect(outline).not.toBe("none");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Toasts are announced politely to screen readers
  await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
  // Escape closes dialogs and returns
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
});

for (const variant of ["High contrast", "High contrast dark"] as const) {
  test(`${variant} theme meets the enhanced (7:1) contrast level`, async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await seed(page);
    await page.keyboard.press("Control+,");
    await main(page).getByRole("button", { name: "Appearance", exact: true }).click();
    await main(page).getByRole("button", { name: variant, exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/\bhc\b/);
    const problems: string[] = [];
    for (const view of ["Home", "Tasks", "Calendar", "Accessibility check"]) {
      await nav(page, view);
      await page.waitForTimeout(300);
      const r = await new AxeBuilder({ page }).withRules(["color-contrast-enhanced", "color-contrast"]).analyze();
      problems.push(...r.violations.flatMap((v) => v.nodes.slice(0, 3).map((n) => `${view}: ${v.id} ${n.target.join(" ")} ${(n.any[0]?.message ?? "").slice(0, 120)}`)));
    }
    expect(problems).toEqual([]);
  });
}

test("the System theme follows Windows' 'more contrast' setting", async ({ page }) => {
  await page.emulateMedia({ contrast: "more" } as Parameters<typeof page.emulateMedia>[0]);
  await boot(page);
  await expect(page.locator("html")).toHaveClass(/\bhc\b/);
  await page.emulateMedia({ contrast: "no-preference" } as Parameters<typeof page.emulateMedia>[0]);
  await expect(page.locator("html")).not.toHaveClass(/\bhc\b/);
});
