/**
 * Local transcription front-end. Decodes any audio Chromium can play to 16 kHz mono, then runs Whisper
 * in a worker. Nothing is sent over the network: the model and runtime ship with the app.
 */
export interface Segment { text: string; start: number; end: number | null }
export interface Transcript { text: string; segments: Segment[]; seconds: number; device: string }

const SAMPLE_RATE = 16000;
export const MAX_SECONDS = 3 * 60 * 60; // three hours

/** Where the voice assets live: the desktop app serves them on a private scheme; the browser build serves them over http. */
export function voiceBase(): string {
  return location.protocol === "file:" ? "cairn-asset://voice/" : new URL("voice/", document.baseURI).href;
}

let worker: Worker | null = null;
let ready: Promise<string> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (t: Omit<Transcript, "seconds" | "device">) => void; reject: (e: Error) => void }>();

function start(): Promise<string> {
  if (ready) return ready;
  worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  ready = new Promise<string>((resolve, reject) => {
    worker!.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id?: number; device?: string; text?: string; chunks?: Segment[]; message?: string };
      if (m.type === "ready") resolve(m.device ?? "wasm");
      else if (m.type === "result") { pending.get(m.id!)?.resolve({ text: m.text ?? "", segments: m.chunks ?? [] }); pending.delete(m.id!); }
      else if (m.type === "error") {
        const err = new Error(`Speech model: ${m.message}`);
        if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!.reject(err); pending.delete(m.id); } else reject(err);
      }
    };
    worker!.onerror = (e) => reject(new Error(`Speech worker failed: ${e.message}`));
    worker!.postMessage({ type: "init", base: voiceBase() });
  });
  ready.catch(() => { ready = null; worker?.terminate(); worker = null; });
  return ready;
}

/** Load the model ahead of time (for example when a recorder opens), so the first transcript is quicker. */
export function warmUp() { void start().catch(() => {}); }

export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  if (buf.duration > MAX_SECONDS) throw new Error("Recordings longer than three hours can't be transcribed");
  // Render to 16 kHz mono (Chromium resamples and downmixes for us).
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * SAMPLE_RATE), SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

export async function transcribe(blob: Blob, opts: { language?: string | null } = {}): Promise<Transcript> {
  const audio = await decodeAudio(blob);
  const device = await start();
  const id = ++seq;
  const result = await new Promise<Omit<Transcript, "seconds" | "device">>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ type: "transcribe", id, audio, language: opts.language ?? null }, [audio.buffer]);
  });
  return { ...result, seconds: audio.length / SAMPLE_RATE, device };
}

export function fmtClock(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
