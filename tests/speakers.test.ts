import { describe, expect, it } from "vitest";
import { attributeSpeakers, labelledLines } from "@/voice/speakers";

const SR = 100;
function track(spans: [number, number][], seconds: number): Float32Array {
  const a = new Float32Array(seconds * SR);
  for (const [s, e] of spans) for (let i = s * SR; i < e * SR; i++) a[i] = Math.sin(i) * 0.4;
  return a;
}

describe("speaker labels", () => {
  it("labels segments by the louder channel and leaves silence unlabelled", () => {
    const left = track([[0, 3], [7, 9]], 10), right = track([[3, 6]], 10);
    const segs = [
      { text: "Hi, thanks for joining", start: 0, end: 3 },
      { text: "Happy to be here", start: 3, end: 6 },
      { text: "", start: 6, end: 7 },
      { text: "Let's start", start: 7, end: null },
    ];
    expect(attributeSpeakers(segs, left, right, SR).map((s) => s.speaker)).toEqual(["left", "right", undefined, "left"]);
  });

  it("uses the louder side when both channels carry sound", () => {
    const left = track([[0, 2]], 2).map((v) => v * 0.2), right = track([[0, 2]], 2);
    expect(attributeSpeakers([{ text: "x", start: 0, end: 2 }], left, right, SR)[0]!.speaker).toBe("right");
  });

  it("writes lines with speaker names and timestamps", () => {
    const lines = labelledLines([{ text: " Hello ", start: 65, end: 70, speaker: "right" }, { text: "Hi", start: 70, end: 71 }], { left: "Tanya", right: "Client" }, (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
    expect(lines).toEqual(["[1:05] Client: Hello", "[1:10] Hi"]);
  });
});
