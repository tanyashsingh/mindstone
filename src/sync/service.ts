/** Sync setup, scheduling and status for this device. The configuration (including the derived key) stays on this device. */
import { create } from "zustand";
import { db } from "@/data/db";
import { getSetting, setSetting } from "@/data/repo";
import { useApp } from "@/store/app";
import { authToken, joinSpace, newSpace, syncOnce, unb64, type SyncState, type Transport } from "./engine";
import { folderTransport, normalizeServerUrl, serverTransport } from "./transports";

export interface SyncConfig extends SyncState { kind: "folder" | "server"; url?: string; space?: string; key: string; folder?: string }
const KEY = "sync";
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const randomId = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

export const useSync = create<{ config: SyncConfig | null; busy: boolean; lastSync: number; lastError: string; lastResult: string }>(() => ({ config: null, busy: false, lastSync: 0, lastError: "", lastResult: "" }));

export async function loadSyncConfig() {
  const config = await getSetting<SyncConfig | null>(KEY, null);
  useSync.setState({ config, lastSync: (await getSetting<number>("syncLast", 0)) || 0 });
  return config;
}

function transportFor(c: Pick<SyncConfig, "kind" | "url" | "space">, token: string): Transport {
  return c.kind === "folder" ? folderTransport() : serverTransport(c.url!, c.space!, token);
}

/** A code for adding another device to a server sync space: "<server>#<space>". The passphrase is entered separately. */
export const syncCode = (c: SyncConfig) => (c.kind === "server" ? `${c.url}#${c.space}` : "");

/**
 * Sets up sync on this device. For a server: pass the server address to start a new space, or a sync code to join one.
 * For a folder (desktop): the folder chosen in the desktop app; joins the space found there or starts one.
 */
export async function setUpSync(opts: { kind: "server"; address: string; passphrase: string } | { kind: "folder"; passphrase: string }): Promise<{ joined: boolean }> {
  let url: string | undefined, space: string | undefined;
  if (opts.kind === "server") {
    const [addr, code] = opts.address.trim().split("#");
    url = normalizeServerUrl(addr!);
    space = code?.trim() || randomId(20);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(space)) throw new Error("That sync code isn't valid.");
  }
  const probe = transportFor({ kind: opts.kind, url, space }, "");
  const existing = await probe.readSpace();
  let key: Uint8Array;
  if (existing) key = await joinSpace(existing, opts.passphrase);
  else {
    if (opts.passphrase.length < 10) throw new Error("Use a sync passphrase of at least 10 characters.");
    const s = await newSpace(opts.passphrase);
    key = s.key;
    await transportFor({ kind: opts.kind, url, space }, await authToken(key)).createSpace(s.info);
  }
  if (existing) await removeUntouchedStarterWorkspace();
  const config: SyncConfig = { kind: opts.kind, url, space, key: b64(key), device: randomId(16), seq: 0, cursors: {} };
  await setSetting(KEY, config);
  useSync.setState({ config, lastError: "" });
  await syncNow();
  return { joined: !!existing };
}

/** A device joining an existing space starts from that space's data, not a second "My Workspace". */
async function removeUntouchedStarterWorkspace() {
  const wss = await db().workspaces.toArray();
  if (wss.length !== 1) return;
  const pages = await db().pages.toArray();
  const edited = pages.some((p) => p.updatedAt - p.createdAt > 2000) || pages.length > 1;
  if (edited || (await db().tasks.count()) || (await db().records.count()) || (await db().attachments.count())) return;
  const { deleteWorkspace } = await import("@/data/repo");
  await deleteWorkspace(wss[0]!.id);
}

export async function stopSync() {
  await setSetting(KEY, null);
  await db().syncState.clear();
  useSync.setState({ config: null, lastError: "", lastResult: "" });
}

let running: Promise<void> | null = null;
export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const config = useSync.getState().config ?? (await loadSyncConfig());
    if (!config) return;
    useSync.setState({ busy: true });
    try {
      const key = unb64(config.key);
      const r = await syncOnce(transportFor(config, await authToken(key)), key, config);
      const next = { ...config, ...r.state };
      await setSetting(KEY, next);
      const at = Date.now();
      await setSetting("syncLast", at);
      useSync.setState({ config: next, lastSync: at, lastError: "", lastResult: `${r.pulled} received, ${r.pushed} sent` });
      // If the open workspace was replaced or deleted on another device, switch to one that exists.
      const app = useApp.getState();
      if (r.pulled && app.workspaceId && !(await db().workspaces.get(app.workspaceId))) {
        const first = await db().workspaces.orderBy("createdAt").first();
        if (first) { app.setWorkspace(first.id); await setSetting("lastWorkspace", first.id); }
      }
    } catch (e) {
      useSync.setState({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      useSync.setState({ busy: false });
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Syncs at start (when set up), every minute, and when the device comes back online. */
export async function startSync() {
  if (timer) return;
  const tick = () => { if (useSync.getState().config && navigator.onLine) void syncNow(); };
  timer = setInterval(tick, 60_000);
  addEventListener("online", tick);
  if (await loadSyncConfig()) tick();
}
