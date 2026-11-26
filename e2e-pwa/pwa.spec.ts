import { expect, test } from "@playwright/test";

test("installable, works offline, and syncs with the server it was installed from", async ({ browser }) => {
  // Phone: open the app from the server, as you would before "Add to home screen"
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await phone.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible({ timeout: 30_000 });

  // Installable: a valid manifest with icons, and a service worker in control
  const manifest = await (await page.request.get(await page.locator('link[rel="manifest"]').getAttribute("href") ?? "")).json();
  expect(manifest).toMatchObject({ name: "Mindstone", display: "standalone" });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).status()).toBe(200);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true), null, { timeout: 30_000 });
  await page.reload(); // now served through the service worker
  await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Capture something, then go offline: the app still opens and shows it
  await page.getByRole("button", { name: "Capture" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Offline-proof task OPAL");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue(""); // added
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Tasks" }).click();
  await expect(page.getByRole("region", { name: "Main view" })).toContainText("OPAL");
  await phone.setOffline(true);
  await page.reload();
  await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Tasks" }).click();
  await expect(page.getByRole("region", { name: "Main view" })).toContainText("OPAL");
  await phone.setOffline(false);

  // Sync from the phone app to the same server (same origin), then pick it up on a "laptop"
  const main = page.getByRole("region", { name: "Main view" });
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: /^Settings/ }).click();
  await main.getByRole("button", { name: "Synchronization" }).click();
  await main.getByLabel("Sync server").fill(new URL(page.url()).origin);
  await main.getByLabel("Sync passphrase").fill("phone and laptop phrase");
  await main.getByRole("button", { name: "Turn on sync" }).click();
  await expect(main.getByTestId("sync-code")).toBeVisible({ timeout: 30_000 });
  const code = (await main.getByTestId("sync-code").innerText()).trim();

  const laptop = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  const lp = await laptop.newPage();
  await lp.goto("/");
  await expect(lp.getByRole("navigation", { name: "Sidebar" })).toBeVisible({ timeout: 30_000 });
  await lp.keyboard.press("Control+,");
  const lmain = lp.getByRole("region", { name: "Main view" });
  await lmain.getByRole("button", { name: "Synchronization" }).click();
  await lmain.getByLabel("Sync server").fill(code);
  await lmain.getByLabel("Sync passphrase").fill("phone and laptop phrase");
  await lmain.getByRole("button", { name: "Turn on sync" }).click();
  await expect(lp.getByText("Joined the sync space")).toBeVisible({ timeout: 30_000 });
  await lp.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name: "Tasks" }).click();
  await expect(lmain).toContainText("OPAL");
  expect(errors).toEqual([]);
});
