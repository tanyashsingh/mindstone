import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { boot, idb, newPage, saved } from "./helpers";

/**
 * Voice: real speech, real local Whisper. Opt-in because it needs the model (node scripts/voice-setup.mjs)
 * and a speech WAV used as a fake microphone:
 *   $env:CAIRN_SPEECH_WAV="C:\path\speech.wav"; npx playwright test e2e/voice.spec.ts
 * The WAV says: "Remind me to send the quarterly budget to Priya on Friday. The project codename is Falcon."
 */
const wav = process.env.CAIRN_SPEECH_WAV;
test.skip(!wav || !existsSync(wav) || !existsSync("public/voice/models"), "set CAIRN_SPEECH_WAV and run scripts/voice-setup.mjs");
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`] } });
test.setTimeout(240_000);

test("a voice note records, saves the audio and transcribes it locally", async ({ page }) => {
  await boot(page);
  await newPage(page, "Standup");
  await page.keyboard.type("/meeting notes");
  await page.keyboard.press("Enter");
  const block = page.locator(".rea-editor .node-voiceNote").first();
  await block.getByRole("button", { name: "Start recording" }).click();
  await expect(block.getByText(/Recording/)).toBeVisible();
  await page.waitForTimeout(9000); // the fake microphone plays the sentence (about 7 s)
  await block.getByRole("button", { name: "Stop" }).click();
  await expect(block.getByRole("button", { name: /Transcript/ })).toBeVisible({ timeout: 180_000 });
  const text = (await block.locator("p").allInnerTexts()).join(" ");
  console.log("TRANSCRIPT:", text);
  expect(text.toLowerCase()).toContain("budget");
  expect(text.toLowerCase()).toMatch(/falcon/);
  await expect(block.locator("audio")).toHaveCount(1);
  const atts = await idb<{ mime: string; textStatus: string; text: string }>(page, "attachments");
  expect(atts[0]?.mime).toMatch(/^audio\//);
  expect(atts[0]?.textStatus).toBe("ok");
  // Transcripts are searchable.
  await saved(page);
  await page.waitForTimeout(1700);
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("falcon");
  await expect(page.getByRole("dialog", { name: "Command palette" }).getByRole("option").first()).toContainText(/Meeting notes/);
});

test("dictation types what you say at the cursor", async ({ page }) => {
  await boot(page);
  await newPage(page, "Dictated");
  await page.keyboard.type("Note:");
  await page.keyboard.press("Control+Shift+M");
  await expect(page.getByRole("dialog", { name: "Dictation" })).toBeVisible();
  await page.waitForTimeout(9000);
  await page.getByRole("button", { name: "Insert text" }).click();
  await expect(page.locator(".rea-editor")).toContainText(/budget/i, { timeout: 180_000 });
  await expect(page.locator(".rea-editor")).toContainText(/^Note: /);
  console.log("DICTATED:", await page.locator(".rea-editor").innerText());
});
