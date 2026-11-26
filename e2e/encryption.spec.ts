import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, main, nav, newPage, noCrash, saved } from "./helpers";

/** All rows of every store, straight from IndexedDB, as text. */
const rawDump = (page: Page) => page.evaluate(async () => {
  const req = indexedDB.open("rea");
  const idb: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
  const out: unknown[] = [];
  for (const s of [...idb.objectStoreNames]) out.push(await new Promise((r) => { const q = idb.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); }));
  idb.close();
  return JSON.stringify(out, (_k, v) => (v instanceof Uint8Array ? "<bytes>" : v));
});

const PASS = "orchard lantern 1987";

async function openSecurity(page: Page) {
  await page.keyboard.press("Control+,");
  await main(page).getByRole("button", { name: "Security" }).click();
}

test("passphrase protection: encrypt, lock, unlock, recover, auto-lock, encrypted backup, turn off", async ({ page }) => {
  test.setTimeout(150_000);
  await page.clock.install();
  await boot(page);
  await newPage(page, "Medical history");
  await page.keyboard.type("Allergy to penicillin, code EMERALD-7");
  await saved(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("emerald");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator("div.fixed.inset-0.z-50")).toHaveCount(0);
  expect(await rawDump(page)).toContain("EMERALD-7");

  // Turn on
  await openSecurity(page);
  await main(page).getByRole("button", { name: "Turn on passphrase protection" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("New passphrase").fill("short");
  await expect(dlg).toContainText("at least 10 characters");
  await dlg.getByLabel("New passphrase").fill(PASS);
  await dlg.getByLabel("Repeat passphrase").fill(PASS);
  await expect(dlg.getByRole("button", { name: "Encrypt my data" })).toBeDisabled();
  await dlg.getByText(/I understand/).click();
  await dlg.getByRole("button", { name: "Encrypt my data" }).click();
  const recovery = (await page.getByTestId("recovery-key").innerText()).trim();
  expect(recovery).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
  await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
  await page.getByText("I have saved my recovery key").click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(main(page).getByRole("region", { name: "Passphrase protection" })).toContainText("is on");

  const raw = await rawDump(page);
  for (const s of ["EMERALD", "penicillin", "Medical history", "My Workspace"]) expect(raw).not.toContain(s);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rea.draft.") || k === "rea.recentSearches"))).toEqual([]);

  // Editing while encrypted keeps working and stays encrypted
  await nav(page, "Medical history");
  await page.locator(".rea-editor").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and RUBY-3");
  await saved(page);
  expect(await rawDump(page)).not.toContain("RUBY-3");

  // Encrypted backup download
  await openSecurity(page);
  await main(page).getByRole("button", { name: "Backup & restore" }).click();
  const dl = page.waitForEvent("download");
  await main(page).getByRole("button", { name: "Download backup" }).click();
  const backupPath = await (await dl).path();
  const backupText = readFileSync(backupPath!, "utf8");
  expect(JSON.parse(backupText).format).toBe("rea-backup-encrypted");
  expect(backupText).not.toContain("EMERALD");

  // Lock now → lock screen; wrong passphrase refused; right one opens the data
  await openSecurity(page);
  await main(page).getByRole("button", { name: "Lock now" }).click();
  const lock = page.getByRole("main", { name: "Mindstone is locked" });
  await expect(lock).toBeVisible();
  await lock.getByLabel("Passphrase").fill("not the passphrase");
  await lock.getByRole("button", { name: "Unlock" }).click();
  await expect(lock.getByRole("alert")).toContainText("not correct");
  await lock.getByLabel("Passphrase").fill(PASS);
  await lock.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  await nav(page, "Medical history");
  await expect(page.locator(".rea-editor")).toContainText("EMERALD-7 and RUBY-3");

  // Reopening the app asks again; the recovery key resets a forgotten passphrase
  await page.reload();
  await expect(lock).toBeVisible();
  await lock.getByRole("button", { name: /Forgot your passphrase/ }).click();
  await lock.getByLabel("Recovery key").fill(recovery.toLowerCase());
  await lock.getByLabel("New passphrase").fill("new phrase after reset");
  await lock.getByRole("button", { name: "Reset and unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();

  // Auto-lock after 5 idle minutes
  await openSecurity(page);
  await main(page).getByLabel("Auto-lock").selectOption("5");
  await page.clock.fastForward("06:00");
  await expect(lock).toBeVisible({ timeout: 20_000 });
  await lock.getByLabel("Passphrase").fill("new phrase after reset");
  await lock.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();

  // The encrypted backup restores with the passphrase it was made with
  await openSecurity(page);
  await main(page).getByRole("button", { name: "Backup & restore" }).click();
  await main(page).locator('input[type="file"][accept*="json"]').setInputFiles(backupPath!);
  await page.getByRole("dialog").getByLabel("This backup is encrypted").fill(PASS);
  await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Replace workspace" }).click();
  await expect(page.getByText(/Restored “My Workspace”/)).toBeVisible();

  // Turn off: data readable again, no lock screen
  await openSecurity(page);
  await main(page).getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("dialog").getByLabel("Current passphrase").fill("new phrase after reset");
  await page.getByRole("dialog").getByRole("button", { name: "Decrypt and turn off" }).click();
  await expect(main(page).getByRole("region", { name: "Passphrase protection" })).toContainText("is off");
  expect(await rawDump(page)).toContain("EMERALD-7");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  await noCrash(page);
});
