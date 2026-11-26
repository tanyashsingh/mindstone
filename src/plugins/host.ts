/**
 * Plugin host. Each enabled plugin runs in its own sandboxed frame (public/plugin-sandbox.html, opaque origin, no
 * network). Calls from the plugin arrive as messages and are checked against the permissions granted at install.
 */
import { create } from "zustand";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import { ensureSearchIndex } from "@/bootstrap";
import { searchIndex } from "@/data/search";
import { markdownToDoc } from "@/data/portability";
import type { ID, JSONContent } from "@/data/types";
import { useApp } from "@/store/app";

export const PERMISSIONS = {
  "pages:read": "Read your pages",
  "pages:write": "Create pages and add to them",
  "tasks:read": "Read your tasks",
  "tasks:write": "Create tasks",
} as const;
export type Permission = keyof typeof PERMISSIONS;

export interface PluginManifest { id: string; name: string; version: string; description?: string; permissions?: Permission[]; main?: string }
export interface InstalledPlugin { id: string; manifest: PluginManifest; code: string; enabled: boolean; installedAt: number }
export interface Contribution { pluginId: string; pluginName: string; kind: "command" | "slash"; id: string; label: string }

export const usePlugins = create<{ contributions: Contribution[]; panels: Record<string, { markdown: string; buttons: { id: string; label: string }[] }>; errors: Record<string, string> }>(() => ({ contributions: [], panels: {}, errors: {} }));

/** Checks a plugin folder's manifest. */
export function validateManifest(raw: unknown): PluginManifest {
  const m = raw as Partial<PluginManifest>;
  if (!m || typeof m !== "object") throw new Error("manifest.json is not an object");
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(m.id)) throw new Error("manifest.json needs an id of lowercase letters, digits and dashes");
  if (typeof m.name !== "string" || !m.name.trim()) throw new Error("manifest.json needs a name");
  if (typeof m.version !== "string") throw new Error("manifest.json needs a version");
  const perms = m.permissions ?? [];
  if (!Array.isArray(perms) || perms.some((p) => !(p in PERMISSIONS))) throw new Error(`Unknown permission. Allowed: ${Object.keys(PERMISSIONS).join(", ")}`);
  return { id: m.id, name: m.name.trim().slice(0, 60), version: m.version.slice(0, 20), description: String(m.description ?? "").slice(0, 300), permissions: perms as Permission[], main: typeof m.main === "string" ? m.main : "main.js" };
}

/** Reads a plugin from its folder (files chosen with a folder picker) or from a .zip. */
export async function readPlugin(files: File[]): Promise<{ manifest: PluginManifest; code: string }> {
  let list = files;
  if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) list = await (await import("@/data/importers")).filesFromZip(files[0]!);
  const rel = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split("/").slice(-1)[0]!;
  const manifestFile = list.find((f) => rel(f) === "manifest.json");
  if (!manifestFile) throw new Error("No manifest.json found. Choose the plugin's folder.");
  const manifest = validateManifest(JSON.parse(await manifestFile.text()));
  const main = list.find((f) => rel(f) === manifest.main);
  if (!main) throw new Error(`The plugin's ${manifest.main} is missing`);
  const code = await main.text();
  if (code.length > 2_000_000) throw new Error("The plugin is too large (over 2 MB)");
  return { manifest, code };
}

export async function installPlugin(manifest: PluginManifest, code: string) {
  await db().plugins.put({ id: manifest.id, manifest, code, enabled: true, installedAt: Date.now() });
  await reloadPlugins();
}
export async function setPluginEnabled(id: string, enabled: boolean) { await db().plugins.update(id, { enabled }); await reloadPlugins(); }
export async function removePlugin(id: string) { await db().plugins.delete(id); await reloadPlugins(); }

// ---- Runtime -------------------------------------------------------------------------------------
interface Running { plugin: InstalledPlugin; frame: HTMLIFrameElement; calls: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>; seq: number }
const running = new Map<string, Running>();
let container: HTMLDivElement | null = null;

/** The desktop app serves the sandbox on its private scheme (sandboxed frames may not load local files). */
function sandboxUrl() { return location.protocol === "file:" ? "cairn-asset://plugins/plugin-sandbox.html" : new URL("plugin-sandbox.html", document.baseURI).href; }

const pageMarkdownSummary = async (id: ID) => {
  const p = await repo.getPage(id);
  return p && !p.deletedAt ? { id: p.id, title: p.title, text: p.text, tags: p.tags, updatedAt: p.updatedAt } : null;
};

async function api(r: Running, method: string, args: unknown[]): Promise<unknown> {
  const has = (p: Permission) => { if (!(r.plugin.manifest.permissions ?? []).includes(p)) throw new Error(`This plugin doesn't have permission to ${PERMISSIONS[p].toLowerCase()}`); };
  const ws = useApp.getState().workspaceId;
  if (!ws) throw new Error("No workspace open");
  switch (method) {
    case "toast": useApp.getState().toast(`${r.plugin.manifest.name}: ${String(args[0]).slice(0, 200)}`, "info"); return null;
    case "panel.render": {
      const [markdown, buttons] = args as [string, { id: string; label: string }[]];
      usePlugins.setState((s) => ({ panels: { ...s.panels, [r.plugin.id]: { markdown: String(markdown).slice(0, 50_000), buttons: (buttons ?? []).slice(0, 10) } } }));
      return null;
    }
    case "pages.current": {
      has("pages:read");
      const route = useApp.getState().tabs[useApp.getState().active]?.route;
      return route?.kind === "page" && route.id ? pageMarkdownSummary(route.id) : null;
    }
    case "pages.get": has("pages:read"); return pageMarkdownSummary(String(args[0]));
    case "pages.list": has("pages:read"); return (await repo.livePages(ws)).map((p) => ({ id: p.id, title: p.title, parentId: p.parentId, updatedAt: p.updatedAt }));
    case "pages.search": {
      has("pages:read");
      await ensureSearchIndex(ws);
      return searchIndex.search(String(args[0] ?? ""), { kinds: ["page"], limit: 20 }).map((h) => ({ id: h.refId, title: h.title, snippet: h.snippet }));
    }
    case "pages.create": {
      has("pages:write");
      const content = markdownToDoc(String(args[1] ?? ""));
      const p = await repo.createPage(ws, null, { title: String(args[0] ?? "Untitled").slice(0, 200) });
      await repo.savePageContent(p.id, content);
      return p.id;
    }
    case "pages.append": {
      has("pages:write");
      const p = await repo.getPage(String(args[0]));
      if (!p || p.deletedAt) throw new Error("Page not found");
      const add = markdownToDoc(String(args[1] ?? "")).content ?? [];
      await repo.savePageContent(p.id, { type: "doc", content: [...(p.content?.content ?? []), ...add] } as JSONContent);
      return null;
    }
    case "tasks.list": {
      has("tasks:read");
      return (await db().tasks.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray()).map((t) => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate, priority: t.priority, tags: t.tags }));
    }
    case "tasks.create": {
      has("tasks:write");
      const t = (args[0] ?? {}) as { title?: unknown; dueDate?: unknown };
      const due = typeof t.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : null;
      return (await repo.createTask(ws, { title: String(t.title ?? "Untitled task").slice(0, 300), dueDate: due, description: `Created by the ${r.plugin.manifest.name} plugin` })).id;
    }
    default: throw new Error(`Unknown method ${method}`);
  }
}

function start(plugin: InstalledPlugin) {
  if (!container) {
    container = document.createElement("div");
    container.hidden = true;
    container.setAttribute("aria-hidden", "true");
    document.body.appendChild(container);
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts"); // no allow-same-origin: an opaque origin
  frame.title = `Plugin ${plugin.manifest.name}`;
  frame.src = sandboxUrl();
  const r: Running = { plugin, frame, calls: new Map(), seq: 0 };
  running.set(plugin.id, r);
  container.appendChild(frame);
}

function onMessage(e: MessageEvent) {
  const r = [...running.values()].find((x) => x.frame.contentWindow === e.source);
  if (!r) return;
  const m = (e.data ?? {}) as { type?: string; kind?: "command" | "slash"; id?: string; label?: string; callId?: number; method?: string; args?: unknown[]; ok?: boolean; value?: unknown; error?: string; message?: string };
  const reply = (msg: unknown) => r.frame.contentWindow?.postMessage(msg, "*");
  if (m.type === "loaded") reply({ type: "init", id: r.plugin.id, code: r.plugin.code });
  else if (m.type === "register" && (m.kind === "command" || m.kind === "slash") && m.id) {
    usePlugins.setState((s) => ({ contributions: [...s.contributions.filter((c) => !(c.pluginId === r.plugin.id && c.kind === m.kind && c.id === m.id)), { pluginId: r.plugin.id, pluginName: r.plugin.manifest.name, kind: m.kind!, id: m.id!, label: String(m.label ?? m.id) }] }));
  } else if (m.type === "call" && typeof m.callId === "number") {
    void api(r, String(m.method), Array.isArray(m.args) ? m.args : []).then((value) => reply({ type: "result", callId: m.callId, ok: true, value }), (err: unknown) => reply({ type: "result", callId: m.callId, ok: false, error: err instanceof Error ? err.message : String(err) }));
  } else if (m.type === "return" && typeof m.callId === "number") {
    const p = r.calls.get(m.callId);
    r.calls.delete(m.callId);
    if (p) { if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error)); }
  } else if (m.type === "error") usePlugins.setState((s) => ({ errors: { ...s.errors, [r.plugin.id]: String(m.message) } }));
}

/** Runs a command, slash item or panel button in its plugin. Resolves to the handler's return value. */
export function invoke(pluginId: string, kind: "command" | "slash" | "panel", id: string, context: unknown = null): Promise<unknown> {
  const r = running.get(pluginId);
  if (!r) return Promise.reject(new Error("That plugin isn't running"));
  const callId = ++r.seq;
  return new Promise((resolve, reject) => {
    r.calls.set(callId, { resolve, reject });
    r.frame.contentWindow?.postMessage({ type: "invoke", kind, id, callId, context }, "*");
    setTimeout(() => { if (r.calls.delete(callId)) reject(new Error("The plugin didn't answer within 15 seconds")); }, 15_000);
  });
}

export function emit(name: string, data: unknown) {
  for (const r of running.values()) r.frame.contentWindow?.postMessage({ type: "event", name, data }, "*");
}

let listening = false;
export async function reloadPlugins() {
  if (!listening) { addEventListener("message", onMessage); listening = true; }
  for (const r of running.values()) r.frame.remove();
  running.clear();
  usePlugins.setState({ contributions: [], panels: {}, errors: {} });
  for (const p of await db().plugins.toArray()) if (p.enabled) start(p);
}

/** Tells plugins when the open page changes. */
export function startPlugins() {
  void reloadPlugins();
  let last = "";
  useApp.subscribe((s) => {
    const route = s.tabs[s.active]?.route;
    const key = route?.kind === "page" ? route.id ?? "" : "";
    if (key !== last) { last = key; emit("pageChanged", key ? { id: key } : null); }
  });
}
