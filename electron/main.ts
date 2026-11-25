/**
 * REA desktop shell (Electron main process).
 * Security posture: context isolation + sandboxed renderer, no Node in the renderer, navigation
 * locked to the bundled app, external links opened in the system browser, permission requests
 * denied, IPC senders verified, API keys encrypted with OS facilities (DPAPI on Windows).
 */
import { app, BrowserWindow, ipcMain, Menu, Notification, safeStorage, session, shell, Tray, nativeImage, dialog, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import fs from "node:fs";
import { streamChat, embed, listModels, AiError, PROVIDER_LABELS, type ChatRequest } from "../src/ai/providers";
import type { AiProviderId } from "../src/data/types";

const DEV_URL = process.env.REA_DEV_URL; // e.g. http://localhost:5183 during development
const INDEX = path.join(__dirname, "../dist/index.html");
const ICON = path.join(__dirname, "../build/icon.png");
const windows = new Set<BrowserWindow>();
let tray: Tray | null = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();

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
    title: "REA",
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
  tray.setToolTip("REA");
  const show = () => { const w = [...windows][0] ?? createWindow(); w.show(); w.focus(); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open REA", click: show },
    { label: "New window", click: () => createWindow() },
    { type: "separator" },
    { label: "Quit REA", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", show);
}

app.on("second-instance", () => { const w = [...windows][0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });
app.on("before-quit", () => { quitting = true; });
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (ev) => ev.preventDefault());
});

void app.whenReady().then(() => {
  app.setAppUserModelId("app.rea.workspace"); // Windows notifications and taskbar grouping
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [{ label: "New window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow() }, { type: "separator" }, { role: "quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    { label: "Help", submenu: [{ label: "Data folder", click: () => void dialog.showMessageBox({ message: `REA stores its data in:\n${app.getPath("userData")}` }) }] },
  ]));
  registerIpc();
  createWindow();
  createTray();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin" && quitting) app.quit(); });
