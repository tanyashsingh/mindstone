/**
 * Mindstone desktop shell (Electron main process).
 * Security posture: context isolation + sandboxed renderer, no Node in the renderer, navigation
 * locked to the bundled app, external links opened in the system browser, permission requests
 * denied, IPC senders verified, API keys encrypted with OS facilities (DPAPI on Windows).
 */
import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, Notification, protocol, safeStorage, session, shell, Tray, nativeImage, dialog, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import fs from "node:fs";
import { streamChat, embed, listModels, AiError, PROVIDER_LABELS, type ChatRequest } from "../src/ai/providers";
import type { AiProviderId } from "../src/data/types";
import { clipperState, newClipperCode, setClipper, start as startClipper } from "./clipper";
import { chooseFolder, currentFolder, folderList, folderRead, folderWrite, syncHttp } from "./syncio";
import { checkForUpdates, configureUpdates, initUpdater, installCrashLogging, installUpdate, listBackups, log, openBackupFolder, openLogFolder, saveBackup, updateState } from "./ops";

const DEV_URL = process.env.REA_DEV_URL; // e.g. http://localhost:5183 during development
const INDEX = path.join(__dirname, "../dist/index.html");
const ICON = path.join(__dirname, "../build/icon.png");
const windows = new Set<BrowserWindow>();
let tray: Tray | null = null;
let quitting = false;

// The data folder follows the product name. Earlier builds were called Cairn and, before that, REA, and
// their data must carry over. Electron creates the new folder itself at startup, so "does it exist?" is
// no signal; a marker file says a folder is this app's established home. Until the new folder has one,
// an older folder that holds a database wins.
{
  const home = app.getPath("userData");
  const marker = path.join(home, ".mindstone-data");
  if (!app.commandLine.hasSwitch("user-data-dir") && !fs.existsSync(marker)) { // an explicit --user-data-dir is used as given
    const legacy = ["Cairn", "REA"].map((n) => path.join(app.getPath("appData"), n)).find((p) => fs.existsSync(path.join(p, "IndexedDB")));
    if (legacy) app.setPath("userData", legacy);
    else {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(marker, "This folder holds Mindstone's data.\n");
    }
  }
}

if (!app.requestSingleInstanceLock()) app.quit();

// Private read-only scheme for the bundled speech model and runtime (fetch() cannot read file:// URLs).
protocol.registerSchemesAsPrivileged([{ scheme: "cairn-asset", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const ASSET_ROOTS: Record<string, string> = { voice: path.join(__dirname, "../dist/voice"), ocr: path.join(__dirname, "../dist/ocr"), plugins: path.join(__dirname, "../dist") };
const MIME: Record<string, string> = { ".wasm": "application/wasm", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain", ".onnx": "application/octet-stream", ".gz": "application/gzip", ".html": "text/html; charset=utf-8" };
function serveAsset(req: Request): Response {
  const url = new URL(req.url);
  const root = Object.hasOwn(ASSET_ROOTS, url.hostname) ? ASSET_ROOTS[url.hostname]! : null;
  if (!root) return new Response("Not found", { status: 404 });
  if (url.hostname === "plugins" && !/^\/plugin-sandbox\.(html|js)$/.test(url.pathname)) return new Response("Not found", { status: 404 }); // only the plugin sandbox
  const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" } });
}

/** Our own page: the bundled app, or the dev server during development. */
function isAppUrl(url: string): boolean {
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://");
}

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://");
}
function handle<A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => R | Promise<R>) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error("Untrusted IPC sender");
    return fn(e, ...(args as A));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 900, minHeight: 600,
    title: "Mindstone",
    backgroundColor: "#191919",
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  windows.add(win);
  win.on("closed", () => windows.delete(win));
  win.on("close", (e) => {
    // Closing the last window hides to the tray instead of quitting (Quit is in the tray menu).
    if (!quitting && windows.size === 1 && tray) { e.preventDefault(); win.hide(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || url.startsWith("mailto:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const ok = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://");
    if (!ok) { e.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url); }
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(INDEX);
  return win;
}

// ---- Secrets (API keys) ------------------------------------------------------------
const secretsFile = () => path.join(app.getPath("userData"), "secrets.json");
function readSecrets(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(secretsFile(), "utf8")) as Record<string, string>; } catch { return {}; }
}
function writeSecrets(s: Record<string, string>) {
  fs.writeFileSync(secretsFile(), JSON.stringify(s), { mode: 0o600 });
}
function getSecret(name: string): string {
  const enc = readSecrets()[name];
  if (!enc || !safeStorage.isEncryptionAvailable()) return "";
  try { return safeStorage.decryptString(Buffer.from(enc, "base64")); } catch { return ""; }
}
const SECRET_NAME = /^ai:(anthropic|openai|gemini|ollama|openaiCompatible)$/;

// ---- AI request validation -----------------------------------------------------------
const PROVIDERS = Object.keys(PROVIDER_LABELS) as AiProviderId[];
function validUrl(u: string) {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; }
}
function checkReq(r: { provider: string; baseUrl: string }) {
  if (!PROVIDERS.includes(r.provider as AiProviderId)) throw new Error("Unknown provider");
  if (!validUrl(r.baseUrl)) throw new Error("Endpoint must be an http(s) URL");
}
const inflight = new Map<string, AbortController>();

function registerIpc() {
  handle("rea:notify", (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 400), icon: fs.existsSync(ICON) ? ICON : undefined }).show();
  });
  handle("rea:newWindow", () => { createWindow(); });
  handle("rea:dataPath", () => app.getPath("userData"));
  handle("rea:log", (_e, level: string, message: string) => {
    if (level !== "error" && level !== "warn" && level !== "info") return;
    log(level, String(message).slice(0, 4000), "renderer");
  });
  handle("rea:logs:open", () => openLogFolder());
  handle("rea:backup:save", (_e, name: string, json: string) => saveBackup(String(name), String(json)));
  handle("rea:backup:list", () => listBackups());
  handle("rea:backup:open", () => openBackupFolder());
  const mainWin = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
  handle("rea:clipper:state", () => clipperState());
  handle("rea:clipper:set", (_e, on: boolean) => setClipper(on === true, mainWin));
  handle("rea:clipper:newCode", () => newClipperCode(mainWin));
  handle("rea:clipper:folder", () => shell.openPath(app.isPackaged ? path.join(process.resourcesPath, "clipper") : path.join(__dirname, "../clipper")));
  void startClipper(mainWin);
  handle("rea:feed:fetch", async (_e, url: string) => {
    const u = new URL(String(url));
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Calendar addresses must use https");
    const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { accept: "text/calendar, */*" } });
    if (!res.ok) throw new Error(`The calendar server answered ${res.status}`);
    const text = await res.text();
    if (text.length > 20 * 1024 * 1024) throw new Error("That calendar is too large (over 20 MB)");
    return text;
  });
  handle("rea:sync:http", (_e, method: string, url: string, headers: Record<string, string>, body: Uint8Array | null) => syncHttp(String(method), String(url), headers, body instanceof Uint8Array ? body : null));
  handle("rea:sync:folder:choose", (e) => chooseFolder(BrowserWindow.fromWebContents(e.sender)));
  handle("rea:sync:folder:get", () => currentFolder());
  handle("rea:sync:folder:read", (_e, rel: string) => folderRead(String(rel)));
  handle("rea:sync:folder:write", (_e, rel: string, bytes: Uint8Array) => { if (!(bytes instanceof Uint8Array)) throw new Error("bytes expected"); folderWrite(String(rel), bytes); });
  handle("rea:sync:folder:list", () => folderList());
  handle("rea:update:configure", (_e, enabled: boolean) => configureUpdates(enabled === true));
  handle("rea:update:check", () => checkForUpdates());
  handle("rea:update:state", () => updateState());
  handle("rea:update:install", () => installUpdate());
  handle("rea:secrets:available", () => safeStorage.isEncryptionAvailable());
  handle("rea:secrets:set", (_e, name: string, value: string) => {
    if (!SECRET_NAME.test(name)) throw new Error("Invalid secret name");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable; the key was not stored.");
    const s = readSecrets();
    s[name] = safeStorage.encryptString(String(value)).toString("base64");
    writeSecrets(s);
  });
  handle("rea:secrets:has", (_e, name: string) => SECRET_NAME.test(name) && !!readSecrets()[name]);
  handle("rea:secrets:delete", (_e, name: string) => { const s = readSecrets(); delete s[name]; writeSecrets(s); });

  handle("rea:ai:chat", async (e, id: string, req: ChatRequest) => {
    try {
      checkReq(req);
      const ctrl = new AbortController();
      inflight.set(id, ctrl);
      const res = await streamChat(req, getSecret(`ai:${req.provider}`), (t) => { if (!e.sender.isDestroyed()) e.sender.send(`rea:ai:chunk:${id}`, t); }, ctrl.signal);
      return res;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), kind: err instanceof AiError ? err.kind : "server" };
    } finally { inflight.delete(id); }
  });
  ipcMain.on("rea:ai:abort", (_e, id: string) => inflight.get(id)?.abort());
  handle("rea:ai:embed", async (_e, req: { provider: AiProviderId; model: string; baseUrl: string; texts: string[] }) => {
    try { checkReq(req); return await embed({ ...req, texts: req.texts.slice(0, 256).map((t) => String(t).slice(0, 8000)) }, getSecret(`ai:${req.provider}`)); }
    catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
  });
  handle("rea:ai:listModels", async (_e, req: { provider: AiProviderId; baseUrl: string }) => {
    try { checkReq(req); return await listModels(req.provider, req.baseUrl, getSecret(`ai:${req.provider}`)); }
    catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
  });
}

function createTray() {
  const img = fs.existsSync(ICON) ? nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip("Mindstone");
  const show = () => { const w = [...windows][0] ?? createWindow(); w.show(); w.focus(); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Mindstone", click: show },
    { label: "New window", click: () => createWindow() },
    { type: "separator" },
    { label: "Quit Mindstone", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", show);
}

app.on("second-instance", () => { const w = [...windows][0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });
app.on("before-quit", () => { quitting = true; });
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (ev) => ev.preventDefault());
});

installCrashLogging();

void app.whenReady().then(() => {
  log("info", `Mindstone ${app.getVersion()} started (${process.platform}, Electron ${process.versions.electron})`);
  initUpdater();
  app.setAppUserModelId("app.cairn.workspace"); // Windows notifications and taskbar grouping
  protocol.handle("cairn-asset", serveAsset);
  // Only the microphone (audio only) and screen-audio capture for voice notes, and only for our own page.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const ours = isAppUrl(details.requestingUrl ?? wc.getURL());
    if (perm === "media") {
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      return cb(ours && types.length > 0 && types.every((t) => t === "audio"));
    }
    if (perm === "display-capture") return cb(ours);
    cb(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, perm, origin) => (perm === "media" || perm === "display-capture") && (origin === "file:///" || isAppUrl(origin)));
  // "Include computer audio": Windows loopback capture; the video track is discarded by the page.
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    if (!isAppUrl(req.frame?.url ?? "")) return cb({});
    void desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      const screen = sources[0];
      if (!screen) return cb({});
      cb(process.platform === "win32" ? { video: screen, audio: "loopback" } : { video: screen });
    });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [{ label: "New window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow() }, { type: "separator" }, { role: "quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    { label: "Help", submenu: [{ label: "Data folder", click: () => void dialog.showMessageBox({ message: `Mindstone stores its data in:\n${app.getPath("userData")}` }) }] },
  ]));
  registerIpc();
  createWindow();
  createTray();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin" && quitting) app.quit(); });
