// Copies the OCR engine (Tesseract.js worker, WebAssembly cores) and English language data from node_modules
// into public/ocr/ (git-ignored), so text recognition runs offline with no CDN. Nothing is downloaded:
// the files come from the tesseract.js, tesseract.js-core and @tesseract.js-data/eng npm packages.
// Runs on `npm install` (postinstall) and before `vite build`.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const OUT = path.join("public", "ocr");
const FILES = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  // LSTM-only cores (the variant Mindstone uses); tesseract.js picks SIMD, relaxed SIMD or plain at runtime.
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz", "lang/eng.traineddata.gz"],
];

if (!existsSync("node_modules/tesseract.js")) { console.log("ocr-setup: tesseract.js not installed, skipping"); process.exit(0); }
for (const [from, to] of FILES) {
  const dest = path.join(OUT, to);
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size === statSync(from).size) continue;
  copyFileSync(from, dest);
  console.log(`ocr-setup: ${to}`);
}
