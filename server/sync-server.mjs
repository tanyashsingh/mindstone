#!/usr/bin/env node
// Mindstone sync server: stores end-to-end encrypted change files for your devices, and can also serve the
// Mindstone web app (for phones: install it from the browser). It never sees your data or your sync passphrase:
// clients send only ciphertext and a token derived from their key. No dependencies; Node 20 or later.
//
//   node server/sync-server.mjs --port 8787 --data ./mindstone-sync-data [--static ./dist]
//
// Put it behind HTTPS (for example Caddy or Tailscale) before using it from a phone.
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc), []));
const PORT = Number(args.port ?? process.env.PORT ?? 8787);
const HOST = args.host ?? "0.0.0.0";
const DATA = path.resolve(args.data ?? "mindstone-sync-data");
const STATIC = args.static ? path.resolve(args.static) : null;
const MAX_FILE = Number(args["max-mb"] ?? 512) * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
mkdirSync(DATA, { recursive: true });

const sha = (s) => createHash("sha256").update(s).digest("hex");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2", ".gz": "application/gzip", ".onnx": "application/octet-stream", ".txt": "text/plain" };

function send(res, status, body = "", headers = {}) {
  res.writeHead(status, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, PUT, OPTIONS", "x-content-type-options": "nosniff", ...headers });
  res.end(body);
}
const json = (res, status, v) => send(res, status, JSON.stringify(v), { "content-type": "application/json" });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else parts.push(c); });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

function authorized(dir, req) {
  const file = path.join(dir, "auth.json");
  if (!existsSync(file)) return false;
  const want = Buffer.from(JSON.parse(readFileSync(file, "utf8")).tokenHash, "hex");
  const tok = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? "")?.[1];
  if (!tok) return false;
  const got = Buffer.from(sha(tok), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

function serveStatic(req, res, url) {
  if (!STATIC) return send(res, 404, "Not found");
  let rel = decodeURIComponent(url.pathname);
  let file = path.normalize(path.join(STATIC, rel));
  if (file !== STATIC && !file.startsWith(STATIC + path.sep)) return send(res, 400, "Bad path");
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(STATIC, "index.html"); // single-page app
  const ext = path.extname(file);
  const cache = /\/assets\//.test(rel) ? "public, max-age=31536000, immutable" : "no-cache";
  send(res, 200, readFileSync(file), { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": cache });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "OPTIONS") return send(res, 204);
    const m = /^\/v1\/spaces\/([^/]+)(?:\/(files)(?:\/([^/]+)\/(\d{1,9}))?)?$/.exec(url.pathname);
    if (!m) return req.method === "GET" ? serveStatic(req, res, url) : send(res, 404, "Not found");
    const [, space, files, device, seqStr] = m;
    if (!ID.test(space)) return send(res, 400, "Bad space id");
    const dir = path.join(DATA, space);

    if (!files) {
      if (req.method === "GET") return existsSync(path.join(dir, "space.json")) ? send(res, 200, readFileSync(path.join(dir, "space.json")), { "content-type": "application/json" }) : send(res, 404, "No such space");
      if (req.method === "PUT") { // create a space once; the creator's token becomes its credential
        if (existsSync(path.join(dir, "space.json"))) return send(res, 409, "Space exists");
        const tok = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? "")?.[1];
        if (!tok) return send(res, 401, "Missing token");
        const body = await readBody(req, 64 * 1024);
        const info = JSON.parse(body.toString("utf8"));
        if (info?.v !== 1 || typeof info.salt !== "string" || typeof info.check !== "string") return send(res, 400, "Bad space info");
        mkdirSync(dir, { recursive: true });
        atomicWrite(path.join(dir, "auth.json"), JSON.stringify({ tokenHash: sha(tok), createdAt: Date.now() }));
        atomicWrite(path.join(dir, "space.json"), JSON.stringify(info));
        return send(res, 201);
      }
      return send(res, 405, "Method not allowed");
    }
    if (!authorized(dir, req)) return send(res, 401, "Not authorised");
    if (!device) {
      if (req.method !== "GET") return send(res, 405, "Method not allowed");
      const out = [];
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || !ID.test(d.name)) continue;
        for (const f of readdirSync(path.join(dir, d.name))) { const s = /^(\d+)\.bin$/.exec(f); if (s) out.push({ device: d.name, seq: Number(s[1]) }); }
      }
      return json(res, 200, out);
    }
    if (!ID.test(device)) return send(res, 400, "Bad device id");
    const file = path.join(dir, device, `${Number(seqStr)}.bin`);
    if (req.method === "GET") return existsSync(file) ? send(res, 200, readFileSync(file), { "content-type": "application/octet-stream" }) : send(res, 404, "Not found");
    if (req.method === "PUT") {
      if (existsSync(file)) return send(res, 409, "File exists"); // change files are immutable
      const body = await readBody(req, MAX_FILE);
      mkdirSync(path.dirname(file), { recursive: true });
      atomicWrite(file, body);
      return send(res, 201);
    }
    return send(res, 405, "Method not allowed");
  } catch (e) {
    send(res, e.status ?? 500, e.status ? e.message : "Server error");
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, HOST, () => console.log(`Mindstone sync server on http://${HOST}:${PORT} (data: ${DATA}${STATIC ? `, app: ${STATIC}` : ""})`));
