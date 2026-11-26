import { expect, test } from "@playwright/test";
import { boot } from "./helpers";

// Chrome's fake microphone plays a beep; the "computer audio" is a 330 Hz tone that starts 1.5 s in.
test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
});

test("meeting recordings keep the microphone on the left and the computer audio on the right", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.value = 330;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.setValueAtTime(0.8, ctx.currentTime + 1.5);
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      const video = document.createElement("canvas").captureStream(1).getVideoTracks();
      return new MediaStream([...dest.stream.getAudioTracks(), ...video]);
    };
  });
  await boot(page);
  const r = await page.evaluate(async () => {
    const { startRecording } = await import(/* @vite-ignore */ String("/src/voice/recorder.ts"));
    const { decodeStereo } = await import(/* @vite-ignore */ String("/src/voice/transcribe.ts"));
    const { attributeSpeakers } = await import(/* @vite-ignore */ String("/src/voice/speakers.ts"));
    const rec = await startRecording({ systemAudio: true });
    await new Promise((res) => setTimeout(res, 3500));
    const blob = await rec.stop();
    const [left, right] = await decodeStereo(blob);
    const energy = (ch: Float32Array, from: number, to: number) => { let s = 0; for (let i = from * 16000; i < to * 16000; i++) s += ch[i]! * ch[i]!; return Math.sqrt(s / ((to - from) * 16000)); };
    const labels = attributeSpeakers([{ text: "a", start: 0.1, end: 1.3 }, { text: "b", start: 2, end: 3.2 }], left, right, 16000).map((s: { speaker?: string }) => s.speaker);
    return { systemAudio: rec.systemAudio, earlyRight: energy(right, 0.1, 1.3), lateRight: energy(right, 2, 3.2), left: energy(left, 0.1, 3.2), labels };
  });
  expect(r.systemAudio).toBe(true);
  expect(r.left).toBeGreaterThan(0.001); // the fake microphone's beep
  expect(r.lateRight).toBeGreaterThan(0.05); // the "call" tone, on the right only
  expect(r.earlyRight).toBeLessThan(0.01); // nothing from the microphone leaks to the right
  expect(r.labels[1]).toBe("right");
});
