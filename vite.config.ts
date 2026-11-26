import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Relative base so the production build loads from file:// inside Electron.
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5183, strictPort: true },
  // Pre-bundle lazily imported libraries so the dev server never reloads the page mid-session to optimise them.
  optimizeDeps: { include: ["tesseract.js", "pdfjs-dist"] },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
