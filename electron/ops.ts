/**
 * Operational services for the desktop app: a local error log, automatic local backups, and auto-update.
 * Nothing here sends data anywhere except the update check, which only asks GitHub Releases for the
 * newest version (and can be turned off in Settings).
 */
import { app, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "node:fs";
import path from "node:path";

// ---- Error log ---------------------------------------------------------------------------------
const MAX_LOG_BYTES = 1024 * 1024;
const logDir = () => path.join(app.getPath("userData"), "logs");
const logFile = () => path.join(logDir(), "mindstone.log");

/** Removes anything that looks like an API key or bearer token before it reaches the log. */
export function redact(s: string): string {
  return s
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, "$1-***")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza***")
    .replace(/(authorization|x-api-key|x-goog-api-key)["':\s=]+[^\s"',]+/gi, "$1: ***")
    .replace(/[Bb]earer\s+[A-Za-z0-9._-]{12,}/g, "Bearer ***");
}

export function log(level: "info" | "warn" | "error", message: string, source = "main") {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > MAX_LOG_BYTES) fs.renameSync(f, `${f}.1`);
    const line = `${new Date().toISOString()} [${level}] [${source}] ${redact(message).slice(0, 4000).replace(/\r?\n/g, "\n    ")}\n`;
    fs.appendFileSync(f, line);
  } catch { /* logging must never crash the app */ }
}

export function installCrashLogging() {
  process.on("uncaughtException", (e) => log("error", `Uncaught: ${e.stack ?? e.message}`));
  process.on("unhandledRejection", (e) => log("error", `Unhandled rejection: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
  app.on("render-process-gone", (_e, _wc, details) => log("error", `Renderer gone: ${details.reason} (exit ${details.exitCode})`));
  app.on("child-process-gone", (_e, details) => log("error", `Child process gone: ${details.type} ${details.reason}`));
}

export const openLogFolder = () => { fs.mkdirSync(logDir(), { recursive: true }); return shell.openPath(logDir()); };

// ---- Automatic local backups -----------------------------------------------------------------
export const KEEP_BACKUPS = 14;
const backupDir = () => path.join(app.getPath("userData"), "backups");

/** Writes a backup and keeps the newest KEEP_BACKUPS files that share its workspace prefix. */
export function saveBackup(fileName: string, json: string): { path: string } {
  if (!/^[A-Za-z0-9 ._()-]{1,120}\.rea\.json$/.test(fileName)) throw new Error("Invalid backup file name");
  if (json.length > 2 * 1024 * 1024 * 1024) throw new Error("Backup too large");
  fs.mkdirSync(backupDir(), { recursive: true });
  const target = path.join(backupDir(), fileName);
  fs.writeFileSync(`${target}.tmp`, json);
  fs.renameSync(`${target}.tmp`, target); // atomic replace: a crash never leaves a half-written backup
  const prefix = fileName.replace(/ \d{4}-\d{2}-\d{2}\.rea\.json$/, "");
  const same = fs.readdirSync(backupDir()).filter((f) => f.startsWith(prefix) && f.endsWith(".rea.json"))
    .map((f) => ({ f, t: fs.statSync(path.join(backupDir(), f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const old of same.slice(KEEP_BACKUPS)) fs.rmSync(path.join(backupDir(), old.f));
  log("info", `Automatic backup written: ${fileName} (${Math.round(json.length / 1024)} KB)`);
  return { path: target };
}

export function listBackups() {
  if (!fs.existsSync(backupDir())) return [];
  return fs.readdirSync(backupDir()).filter((f) => f.endsWith(".rea.json"))
    .map((f) => { const s = fs.statSync(path.join(backupDir(), f)); return { name: f, size: s.size, at: s.mtimeMs }; })
    .sort((a, b) => b.at - a.at);
}

export const openBackupFolder = () => { fs.mkdirSync(backupDir(), { recursive: true }); return shell.openPath(backupDir()); };

// ---- Auto-update (GitHub Releases) --------------------------------------------------------------
type UpdateState = { status: "idle" | "checking" | "none" | "downloading" | "ready" | "error" | "disabled"; version?: string; message?: string };
let state: UpdateState = { status: "idle" };
let timer: ReturnType<typeof setInterval> | undefined;
const broadcast = () => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("rea:update:state", state));
const setState = (s: UpdateState) => { state = s; broadcast(); };

export function initUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m: unknown) => log("info", String(m), "updater"), warn: (m: unknown) => log("warn", String(m), "updater"), error: (m: unknown) => log("error", String(m), "updater"), debug: () => {} };
  autoUpdater.on("checking-for-update", () => setState({ status: "checking" }));
  autoUpdater.on("update-not-available", () => setState({ status: "none" }));
  autoUpdater.on("update-available", (i) => setState({ status: "downloading", version: i.version }));
  autoUpdater.on("update-downloaded", (i) => setState({ status: "ready", version: i.version }));
  autoUpdater.on("error", (e) => setState({ status: "error", message: e.message.split("\n")[0] }));
}

/** Enables or disables background checks: once a minute after start, then every 12 hours. */
export function configureUpdates(enabled: boolean) {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (!app.isPackaged) return setState({ status: "disabled", message: "Updates are only checked in the installed app" });
  if (!enabled) return setState({ status: "disabled", message: "Automatic update checks are off" });
  setTimeout(() => void checkForUpdates(), 60_000);
  timer = setInterval(() => void checkForUpdates(), 12 * 60 * 60 * 1000);
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return { status: "disabled", message: "Updates are only checked in the installed app" };
  try { await autoUpdater.checkForUpdates(); } catch (e) { setState({ status: "error", message: e instanceof Error ? e.message.split("\n")[0] : String(e) }); }
  return state;
}

export const updateState = () => state;
export const installUpdate = () => { if (state.status === "ready") autoUpdater.quitAndInstall(false, true); };
