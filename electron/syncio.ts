// Main-process side of sync: the chosen sync folder (file access limited to "<folder>/Mindstone Sync") and
// HTTP requests to a sync server (sent from here so the page's Content Security Policy can stay strict).
import { app, dialog, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";

const configFile = () => path.join(app.getPath("userData"), "sync-folder.json");
let root: string | null = null;

function loadRoot(): string | null {
  if (root) return root;
  try { root = (JSON.parse(fs.readFileSync(configFile(), "utf8")) as { folder: string }).folder; } catch { root = null; }
  return root;
}
const syncDir = () => { const r = loadRoot(); return r ? path.join(r, "Mindstone Sync") : null; };

/** Opens a folder picker. Tests can preset the folder in development builds only. */
export async function chooseFolder(win: BrowserWindow | null): Promise<string | null> {
  const preset = !app.isPackaged ? process.env.MINDSTONE_E2E_SYNC_DIR : undefined;
  let folder = preset ?? null;
  if (!folder) {
    const r = await (win ? dialog.showOpenDialog(win, { title: "Choose a folder to sync through", properties: ["openDirectory", "createDirectory"] }) : dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] }));
    if (r.canceled || !r.filePaths[0]) return null;
    folder = r.filePaths[0];
  }
  root = folder;
  fs.writeFileSync(configFile(), JSON.stringify({ folder }));
  fs.mkdirSync(path.join(folder, "Mindstone Sync"), { recursive: true });
  return folder;
}

export const currentFolder = () => loadRoot();

function safe(rel: string): string {
  const dir = syncDir();
  if (!dir) throw new Error("No sync folder chosen");
  if (!/^(space\.json|[A-Za-z0-9_-]{8,64}\/\d{1,9}\.bin)$/.test(rel)) throw new Error("Invalid sync path");
  return path.join(dir, rel);
}

export function folderRead(rel: string): Uint8Array | null {
  const f = safe(rel);
  return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
}

export function folderWrite(rel: string, bytes: Uint8Array) {
  const f = safe(rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, f); // other devices never see half-written files
}

export function folderList(): string[] {
  const dir = syncDir();
  if (!dir || !fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^[A-Za-z0-9_-]{8,64}$/.test(d.name)) continue;
    for (const f of fs.readdirSync(path.join(dir, d.name))) if (/^\d{1,9}\.bin$/.test(f)) out.push(`${d.name}/${f}`);
  }
  return out;
}

export async function syncHttp(method: string, url: string, headers: Record<string, string>, body: Uint8Array | null): Promise<{ status: number; body: Uint8Array }> {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Sync servers must use http or https");
  if (method !== "GET" && method !== "PUT") throw new Error("Unsupported method");
  if (!/^\/v1\/spaces\//.test(u.pathname)) throw new Error("Not a sync server address");
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) if (/^(authorization|content-type)$/i.test(k) && typeof v === "string") clean[k] = v;
  const res = await fetch(u, { method, headers: clean, body: body ? Buffer.from(body) : undefined, signal: AbortSignal.timeout(120_000) });
  return { status: res.status, body: new Uint8Array(await res.arrayBuffer()) };
}
