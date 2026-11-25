// Renders brand/logo-scene.ts in headless Chrome (WebGL) and writes the logo PNGs.
// Usage: node scripts/render-logo.mjs [--preview]
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const out = await build({ entryPoints: ["brand/logo-scene.ts"], bundle: true, format: "iife", write: false, target: "chrome120", logLevel: "error" });
const html = `<!doctype html><html><body style="margin:0;background:transparent"><script>${out.outputFiles[0].text}</script></body></html>`;

const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
page.on("pageerror", (e) => { console.error("render error:", e.message); process.exitCode = 1; });
await page.setContent(html);
await page.waitForFunction(() => window.cairnLogo, null, { timeout: 120_000 });
const logo = await page.evaluate(() => window.cairnLogo);
await browser.close();

const png = (size) => Buffer.from(logo[size].split(",")[1], "base64");
mkdirSync("brand", { recursive: true });
mkdirSync("build", { recursive: true });
mkdirSync("public", { recursive: true });
mkdirSync("src/assets", { recursive: true });
writeFileSync("brand/cairn-logo-1024.png", png(1024));
writeFileSync("brand/cairn-logo-512.png", png(512));
writeFileSync("build/icon.png", png(512)); // electron-builder builds the .ico (256 and below) from this
writeFileSync("public/favicon.png", png(64));
writeFileSync("src/assets/cairn-mark.png", png(128)); // in-app mark (sidebar, welcome, about)
writeFileSync("src/assets/cairn-mark-32.png", png(32));
console.log("wrote brand/cairn-logo-{1024,512}.png, build/icon.png, public/favicon.png, src/assets/cairn-mark*.png");
