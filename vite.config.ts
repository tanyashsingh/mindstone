import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Relative base so the production build loads from file:// inside Electron.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5183, strictPort: true },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
