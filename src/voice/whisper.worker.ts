/// <reference lib="webworker" />
// Speech-to-text in a worker: Whisper base (q8) via Transformers.js + ONNX Runtime Web. Local files only.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

type Req =
  | { type: "init"; base: string }
  | { type: "transcribe"; id: number; audio: Float32Array; language: string | null };

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let device = "wasm";

function load(base: string) {
  env.allowRemoteModels = false; // never fetch weights from the internet
  env.allowLocalModels = true;
  // Transformers.js only checks for optional files (tokenizer, pre-processor) on non-http "local" paths;
  // given a full http URL with remote loading off, it wrongly treats them as missing. A root-relative
  // path keeps http hosting working; cairn-asset:// (desktop) is already non-http.
  env.localModelPath = /^https?:/.test(base) ? `${new URL(base).pathname}models/` : `${base}models/`;
  env.useBrowserCache = false;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number } };
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = `${base}ort/`;
    onnx.wasm.numThreads = 1; // threads need cross-origin isolation, which a desktop app page does not have
  }
  const make = (d: "webgpu" | "wasm") =>
    pipeline("automatic-speech-recognition", "onnx-community/whisper-base", { dtype: "q8", device: d }) as Promise<AutomaticSpeechRecognitionPipeline>;
  const hasGpu = typeof (self.navigator as Navigator & { gpu?: unknown }).gpu !== "undefined";
  asr = (hasGpu ? make("webgpu").then((p) => { device = "webgpu"; return p; }) : Promise.reject(new Error("no WebGPU")))
    .catch(() => { device = "wasm"; return make("wasm"); });
  return asr;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      await load(msg.base);
      self.postMessage({ type: "ready", device });
      return;
    }
    const p = await (asr ?? Promise.reject(new Error("Speech model not loaded")));
    const out = await p(msg.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      ...(msg.language ? { language: msg.language } : {}),
      task: "transcribe",
    });
    const result = Array.isArray(out) ? out[0]! : out;
    const chunks = (result as { chunks?: { text: string; timestamp: [number, number | null] }[] }).chunks ?? [];
    self.postMessage({ type: "result", id: msg.id, text: result.text.trim(), chunks: chunks.map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] })) });
  } catch (err) {
    self.postMessage({ type: "error", id: "id" in msg ? msg.id : -1, message: err instanceof Error ? err.message : String(err) });
  }
};
