// Removes the ONNX Runtime WebAssembly copy that Vite emits from the speech library's import graph.
// Cairn loads the runtime from dist/voice/ort/ instead (served on cairn-asset:// in the desktop app),
// so this second ~25 MB copy is never requested.
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const dir = path.join("dist", "assets");
let freed = 0;
for (const f of readdirSync(dir)) {
  if (/^ort-wasm.*\.wasm$/.test(f)) {
    freed += statSync(path.join(dir, f)).size;
    rmSync(path.join(dir, f));
  }
}
console.log(`pruned unused runtime copies: ${(freed / 1048576).toFixed(1)} MB`);
