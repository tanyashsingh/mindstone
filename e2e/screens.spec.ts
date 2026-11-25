import { test } from "@playwright/test";
import { boot, main, nav, newPage, saved } from "./helpers";

// Visual review aid, not an assertion test. Run with: $env:REA_SCREENS="<dir>"; npx playwright test e2e/screens.spec.ts
const dir = process.env.REA_SCREENS;
test.skip(!dir, "set REA_SCREENS to a folder to capture screenshots");

for (const theme of ["light", "dark"] as const) {
  test(`capture key views (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    await boot(page);
    for (const t of ["Write launch post tomorrow !high #marketing", "Review budget !medium", "Fix login bug !urgent #eng"]) {
      await nav(page, "Tasks");
      await page.getByLabel("New task").fill(t);
      await page.getByLabel("New task").press("Enter");
    }
    await nav(page, "Home");
    await page.screenshot({ path: `${dir}/${theme}-home.png` });
    await newPage(page, "Launch plan");
    await page.keyboard.type("/h2"); await page.keyboard.press("Enter"); await page.keyboard.type("Goals"); await page.keyboard.press("Enter");
    await page.keyboard.type("[ ] Ship the beta"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.keyboard.type("See [[Welc"); await page.keyboard.press("Enter");
    await saved(page);
    await page.screenshot({ path: `${dir}/${theme}-page.png` });
    await nav(page, "Databases");
    await main(page).getByRole("button", { name: "New database" }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "New record" }).click();
    await page.mouse.click(5, 5);
    await page.screenshot({ path: `${dir}/${theme}-database.png` });
    await nav(page, "Settings");
    await main(page).getByRole("button", { name: "Appearance" }).click();
    await page.screenshot({ path: `${dir}/${theme}-settings.png` });
  });
}
