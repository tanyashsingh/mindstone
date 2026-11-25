import { test } from "@playwright/test";
import { boot, main, nav } from "./helpers";

// Visual review aid, not an assertion test. Run with: $env:REA_SCREENS="<dir>"; npx playwright test e2e/screens.spec.ts
const dir = process.env.REA_SCREENS;
test.skip(!dir, "set REA_SCREENS to a folder to capture screenshots");

test("capture key views", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await nav(page, "Tasks");
  for (const t of ["Write launch post tomorrow !high #marketing", "Review budget !medium", "Book venue next week", "Fix login bug !urgent #eng"]) {
    await page.getByLabel("New task").fill(t);
    await page.getByLabel("New task").press("Enter");
  }
  await page.screenshot({ path: `${dir}/tasks.png` });
  await nav(page, "Calendar");
  await main(page).getByRole("button", { name: "Event", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.screenshot({ path: `${dir}/calendar.png` });
  await nav(page, "Settings");
  await main(page).getByRole("button", { name: "AI providers", exact: true }).click();
  await page.screenshot({ path: `${dir}/settings-ai.png` });
});
