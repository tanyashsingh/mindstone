import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import { boot, main, nav, newPage, saved } from "./helpers";

// Visual review aid, not an assertion test. Captures every main screen in light and dark, plus window sizes, and
// writes the browser console's errors and warnings next to the pictures.
// Run with: $env:REA_SCREENS="<dir>"; npx playwright test e2e/screens.spec.ts
const dir = process.env.REA_SCREENS;
test.skip(!dir, "set REA_SCREENS to a folder to capture screenshots");

async function seedContent(page: Page) {
  for (const t of ["Write launch post tomorrow !high #marketing", "Review budget !medium", "Fix login bug !urgent #eng", "Book venue next friday"]) {
    await nav(page, "Tasks");
    await page.getByLabel("New task").fill(t);
    await page.getByLabel("New task").press("Enter");
  }
  await newPage(page, "Launch plan");
  await page.keyboard.type("/h2"); await page.keyboard.press("Enter"); await page.keyboard.type("Goals"); await page.keyboard.press("Enter");
  await page.keyboard.type("[ ] Ship the beta"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await page.keyboard.type("A paragraph with **bold** text and a #launch tag. See [[Welc"); await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("> A quote to set the tone."); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await page.keyboard.type("```"); await page.keyboard.press("Enter"); await page.keyboard.type("const ready = true;");
  await saved(page);
}

const VIEWS = ["Home", "Inbox", "Tasks", "Projects", "Calendar", "Databases", "Knowledge graph", "Files", "Templates", "Mindstone Intelligence", "Trash"];

for (const theme of ["light", "dark"] as const) {
  test(`capture every screen (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    const log: string[] = [];
    let where = "boot";
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.push(`[${where}] ${m.type()}: ${m.text().slice(0, 300)}`); });
    page.on("pageerror", (e) => log.push(`[${where}] pageerror: ${e.message}`));
    const shot = async (name: string) => { where = name; await page.waitForFunction(() => !document.querySelector("main .skeleton"), null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300); await page.screenshot({ path: `${dir}/${theme}-${name}.png` }); };

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ colorScheme: theme });
    await boot(page);
    await shot("00-first-run");
    await seedContent(page);
    await shot("page-editor");
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await shot("slash-menu");
    await page.keyboard.press("Escape");
    for (const v of VIEWS) {
      await nav(page, v);
      await shot(`view-${v.toLowerCase().replace(/\s+/g, "-")}`);
    }
    await nav(page, "Databases");
    await main(page).getByRole("button", { name: "New database" }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "New record" }).click();
    await page.mouse.click(5, 5);
    await shot("database-table");
    await page.keyboard.press("Control+k");
    await shot("palette-empty");
    await page.keyboard.type("launch");
    await shot("palette-query");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+,");
    for (const sec of ["General", "Appearance", "Editor", "Security", "Synchronization", "Plugins", "Backup & restore", "About"]) {
      const b = main(page).getByRole("button", { name: sec, exact: true });
      if (await b.count()) { await b.first().click(); await shot(`settings-${sec.toLowerCase().replace(/[^a-z]+/g, "-")}`); }
    }
    for (const [w, h] of [[800, 600], [1024, 768], [1280, 720], [1920, 1080]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await nav(page, "Home");
      await shot(`size-${w}x${h}-home`);
    }
    fs.writeFileSync(`${dir}/${theme}-console.txt`, [...new Set(log)].join("\n") + "\n");
  });
}
