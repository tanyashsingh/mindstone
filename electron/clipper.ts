// Web clipper endpoint: a tiny HTTP server on 127.0.0.1 that the Mindstone browser extension posts clips to.
// Off until you turn it on in Settings → Integrations. Every request needs the pairing code; web pages are refused.
import { app, type BrowserWindow } from "electron";
import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CLIP_PORT = 43117;
interface Config { enabled: boolean; token: string }
const file = () => path.join(app.getPath("userData"), "clipper.json");
let server: Server | null = null;
let lastError = "";

function load(): Config {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")) as Config; } catch { return { enabled: false, token: "" }; }
}
function save(c: Config) { fs.writeFileSync(file(), JSON.stringify(c)); }

export function clipperState() { const c = load(); return { enabled: c.enabled, token: c.enabled ? c.token : "", port: CLIP_PORT, running: !!server, error: lastError }; }

export async function setClipper(enabled: boolean, getWindow: () => BrowserWindow | null) {
  const c = load();
  if (enabled && !c.token) c.token = randomBytes(12).toString("hex");
  c.enabled = enabled;
  save(c);
  await stop();
  if (enabled) await start(getWindow);
  return clipperState();
}

export async function newClipperCode(getWindow: () => BrowserWindow | null) {
  const c = load();
  c.token = randomBytes(12).toString("hex");
  save(c);
  if (c.enabled) { await stop(); await start(getWindow); }
  return clipperState();
}

function stop(): Promise<void> {
  return new Promise((r) => { if (!server) return r(); server.close(() => r()); server = null; });
}

const okOrigin = (o: string | undefined) => !o || /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(o);

export function start(getWindow: () => BrowserWindow | null): Promise<void> {
  const c = load();
  if (!c.enabled || server) return Promise.resolve();
  const token = Buffer.from(c.token);
  const authed = (h: string | undefined) => { const t = Buffer.from(/^Bearer (\S+)$/.exec(h ?? "")?.[1] ?? ""); return t.length === token.length && timingSafeEqual(t, token); };
  server = createServer((req, res) => {
    const origin = req.headers.origin;
    const cors = okOrigin(origin) && origin ? { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST" } : {};
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
    if (!okOrigin(origin)) return send(403, { error: "Web pages can't send clips" });
    if (req.method === "OPTIONS") return send(204, {});
    if (!authed(req.headers.authorization)) return send(401, { error: "Wrong pairing code" });
    if (req.method === "GET" && req.url === "/ping") return send(200, { app: "Mindstone", version: app.getVersion() });
    if (req.method !== "POST" || req.url !== "/clip") return send(404, { error: "Not found" });
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (d: Buffer) => { size += d.length; if (size > 8 * 1024 * 1024) { send(413, { error: "Clip too large" }); req.destroy(); } else parts.push(d); });
    req.on("end", () => {
      if (res.writableEnded) return;
      let clip: { url?: unknown; title?: unknown; html?: unknown; text?: unknown; kind?: unknown };
      try { clip = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { return send(400, { error: "Bad JSON" }); }
      const url = typeof clip.url === "string" && /^https?:\/\//i.test(clip.url) ? clip.url.slice(0, 2000) : "";
      const html = typeof clip.html === "string" ? clip.html.slice(0, 5_000_000) : "";
      const text = typeof clip.text === "string" ? clip.text.slice(0, 2_000_000) : "";
      if (!url || (!html && !text)) return send(400, { error: "A clip needs a page address and some content" });
      const win = getWindow();
      if (!win) return send(503, { error: "Mindstone has no open window" });
      win.webContents.send("rea:clip", { url, title: typeof clip.title === "string" ? clip.title.slice(0, 300) : url, html, text, kind: clip.kind === "selection" || clip.kind === "article" ? clip.kind : "page" });
      send(202, { ok: true });
    });
  });
  return new Promise((resolve) => {
    server!.once("error", (e: NodeJS.ErrnoException) => { lastError = e.code === "EADDRINUSE" ? `Port ${CLIP_PORT} is in use by another program` : e.message; server = null; resolve(); });
    server!.listen(CLIP_PORT, "127.0.0.1", () => { lastError = ""; resolve(); });
  });
}
