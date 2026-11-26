import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boot, main, nav, noCrash } from "./helpers";

let server: ChildProcess;
const dir = mkdtempSync(path.join(tmpdir(), "ms-feed-"));
const PORT = 8900 + Math.floor(Math.random() * 90);
const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`;

test.beforeAll(async () => {
  const today = new Date(); today.setHours(10, 0, 0, 0);
  const later = new Date(today); later.setHours(15, 30);
  writeFileSync(path.join(dir, "team.ics"), [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:standup-1", "SUMMARY:Team standup", `DTSTART:${stamp(today)}`, "DURATION:PT15M", "RRULE:FREQ=DAILY;COUNT=30", "LOCATION:Room 2", "END:VEVENT",
    "BEGIN:VEVENT", "UID:review-1", "SUMMARY:Design review", `DTSTART:${stamp(later)}`, "DURATION:PT1H", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n"));
  server = spawn(process.execPath, ["server/sync-server.mjs", "--port", String(PORT), "--host", "127.0.0.1", "--static", dir, "--data", path.join(dir, "data")], { stdio: "pipe" });
  await new Promise<void>((resolve) => server.stdout!.on("data", (d) => { if (String(d).includes("sync server on")) resolve(); }));
});
test.afterAll(() => { server.kill(); rmSync(dir, { recursive: true, force: true }); });

test("subscribe to a calendar by its address; events show read-only; unsubscribe removes them", async ({ page }) => {
  await boot(page);
  await nav(page, "Calendar");
  await main(page).getByRole("button", { name: "Subscribe" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Subscribed calendars" });
  await dlg.getByLabel("Calendar name").fill("Team");
  await dlg.getByLabel("Calendar address").fill(`http://localhost:${PORT}/team.ics`);
  await dlg.getByRole("radio", { name: "green" }).click();
  await dlg.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByText("Subscribed to Team: 2 events")).toBeVisible();
  await expect(dlg.getByTestId("feed")).toContainText("2 events · refreshed");
  await page.keyboard.press("Escape");

  // The events appear (today's standup and review), in the feed's calendar
  await expect(main(page).getByRole("button", { name: /Team standup/ }).first()).toBeVisible();
  await expect(main(page).getByRole("button", { name: /Design review/ }).first()).toBeVisible();
  await expect(main(page).getByText("Team", { exact: true })).toBeVisible(); // calendar filter

  // Read-only details
  await main(page).getByRole("button", { name: /Team standup/ }).first().click();
  const detail = page.getByTestId("feed-event");
  await expect(detail).toContainText("Location: Room 2");
  await expect(detail).toContainText("read-only");
  await page.keyboard.press("Escape");

  // Unsubscribe
  await main(page).getByRole("button", { name: "Subscribe" }).click();
  await dlg.getByRole("button", { name: "Remove Team" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(dlg.getByTestId("feed")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(main(page).getByRole("button", { name: /Team standup/ })).toHaveCount(0);
  await noCrash(page);
});
