// Bundles the Electron main and preload scripts with esbuild (CommonJS, Node target).
import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node22", format: "cjs", sourcemap: false, external: ["electron"], logLevel: "info", tsconfig: "tsconfig.json" };
await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs" });
await build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs" });
