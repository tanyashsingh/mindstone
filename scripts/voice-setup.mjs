// Downloads the local speech model (Whisper base, onnx-community, Apache-2.0) and stages the ONNX Runtime
// WebAssembly files, so voice transcription runs fully offline. Files go to public/voice/ (git-ignored)
// and are bundled into the app by `vite build`. Large files are verified against Hugging Face's SHA-256.
// Usage: node scripts/voice-setup.mjs
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const MODEL = "onnx-community/whisper-base";
const REV = "main";
const OUT = path.join("public", "voice");
const FILES = [
  "config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json",
  "added_tokens.json", "special_tokens_map.json", "vocab.json", "merges.txt", "normalizer.json",
  "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
];

const api = async (p) => (await fetch(`https://huggingface.co/api/models/${MODEL}/tree/${REV}/${p}`)).json();
const listing = [...(await api("")), ...(await api("onnx"))];
const meta = new Map(listing.map((e) => [e.path, e]));

for (const f of FILES) {
  const dest = path.join(OUT, "models", MODEL, f);
  const info = meta.get(f);
  if (!info) throw new Error(`${f} not found in ${MODEL}`);
  const want = info.lfs?.oid; // sha256 for large files
  if (existsSync(dest)) {
    const have = readFileSync(dest);
    if (want ? createHash("sha256").update(have).digest("hex") === want : have.length === info.size) { console.log(`ok      ${f}`); continue; }
  }
  const res = await fetch(`https://huggingface.co/${MODEL}/resolve/${REV}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (want && createHash("sha256").update(buf).digest("hex") !== want) throw new Error(`${f}: SHA-256 mismatch`);
  if (!want && buf.length !== info.size) throw new Error(`${f}: size mismatch`);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  console.log(`fetched ${f} (${(buf.length / 1048576).toFixed(1)} MB)${want ? ", sha256 verified" : ""}`);
}

const ortSrc = path.join("node_modules", "onnxruntime-web", "dist");
const ortOut = path.join(OUT, "ort");
mkdirSync(ortOut, { recursive: true });
// Only the build Transformers.js loads (asyncify: WebGPU and CPU in one); the other variants are unused.
for (const f of readdirSync(ortOut)) if (!/^ort-wasm-simd-threaded\.asyncify\.(wasm|mjs)$/.test(f)) rmSync(path.join(ortOut, f));
for (const f of readdirSync(ortSrc).filter((n) => /^ort-wasm-simd-threaded\.asyncify\.(wasm|mjs)$/.test(n))) copyFileSync(path.join(ortSrc, f), path.join(ortOut, f));
console.log("staged ONNX Runtime WebAssembly files in", ortOut);
