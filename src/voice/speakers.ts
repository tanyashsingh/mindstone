/**
 * Speaker labels for meeting recordings. When a recording includes the computer's audio, the microphone is
 * kept on the left channel and the computer audio (the other people on a call) on the right, so each
 * transcript segment can be attributed by which channel carries more speech energy.
 */
export interface Seg { text: string; start: number; end: number | null; speaker?: "left" | "right" }
export const DEFAULT_SPEAKERS = { left: "You", right: "Others" } as const;

function rms(ch: Float32Array, from: number, to: number): number {
  let sum = 0;
  const a = Math.max(0, Math.floor(from)), b = Math.min(ch.length, Math.ceil(to));
  for (let i = a; i < b; i++) sum += ch[i]! * ch[i]!;
  return b > a ? Math.sqrt(sum / (b - a)) : 0;
}

/** Labels each segment "left" (microphone) or "right" (computer audio); near-silent segments stay unlabelled. */
export function attributeSpeakers<T extends Seg>(segs: T[], left: Float32Array, right: Float32Array, sampleRate: number): T[] {
  const total = Math.max(left.length, right.length) / sampleRate;
  return segs.map((s, i) => {
    const end = s.end ?? segs[i + 1]?.start ?? total;
    const l = rms(left, s.start * sampleRate, end * sampleRate), r = rms(right, s.start * sampleRate, end * sampleRate);
    if (Math.max(l, r) < 0.003) return { ...s, speaker: undefined };
    return { ...s, speaker: l >= r ? "left" : "right" };
  });
}

/** Transcript lines with speaker names, for inserting into a page or summarising. */
export function labelledLines(segs: Seg[], names: { left: string; right: string } | undefined, clock: (s: number) => string): string[] {
  return segs.map((s) => `[${clock(s.start)}] ${names && s.speaker ? `${names[s.speaker]}: ` : ""}${s.text.trim()}`);
}
