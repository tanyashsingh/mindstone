import { db } from "@/data/db";
import { createPage, createWorkspace, getSetting, setSetting } from "@/data/repo";
import { searchIndex, type IndexedTable } from "@/data/search";
import type { JSONContent } from "@/data/types";
import { debounce, uid } from "@/lib/util";

const p = (text: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "paragraph", attrs: { id: uid() }, content: text ? [{ type: "text", text, ...(marks ? { marks } : {}) }] : [] });
const h = (level: number, text: string): JSONContent => ({ type: "heading", attrs: { id: uid(), level }, content: [{ type: "text", text }] });
const li = (text: string): JSONContent => ({ type: "listItem", attrs: { id: uid() }, content: [p(text)] });

export function welcomeDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      p("Mindstone is a local-first workspace: everything you write stays on this device unless you choose otherwise."),
      { type: "callout", attrs: { id: uid(), variant: "tip" }, content: [p("Press Ctrl + K for the command palette, or type / on an empty line to insert a block.")] },
      h(2, "Getting around"),
      { type: "bulletList", attrs: { id: uid() }, content: [
        li("Pages nest without limit. Drag them in the sidebar to reorganise."),
        li("Link pages by typing [[ and choosing a page. Backlinks appear in the right panel (Ctrl + Shift + \\)."),
        li("Databases give you tables, boards, calendars, galleries and timelines over the same records."),
        li("Tasks, projects and the calendar live in the sidebar. Home shows what is due today."),
        li("Settings → Backup creates a complete workspace backup you can restore later."),
      ] },
      h(2, "Try it"),
      { type: "taskList", attrs: { id: uid() }, content: [
        { type: "taskItem", attrs: { id: uid(), checked: false }, content: [p("Create a page with Ctrl + N")] },
        { type: "taskItem", attrs: { id: uid(), checked: false }, content: [p("Add a database with /database")] },
        { type: "taskItem", attrs: { id: uid(), checked: false }, content: [p("Capture a task from Home")] },
      ] },
      p(""),
    ],
  };
}

let booting: Promise<string> | null = null;
/** Ensure a workspace exists and return the one to open. Concurrent calls (React runs effects twice in development) share one run. */
export function bootstrap(): Promise<string> {
  booting ??= doBootstrap().finally(() => { booting = null; });
  return booting;
}

async function doBootstrap(): Promise<string> {
  const d = db();
  let wsId = await getSetting<string | null>("lastWorkspace", null);
  if (!wsId || !(await d.workspaces.get(wsId))) {
    const first = await d.workspaces.orderBy("createdAt").first();
    if (first) wsId = first.id;
    else {
      const ws = await createWorkspace("My Workspace", "◆");
      await createPage(ws.id, null, { title: "Welcome to Mindstone", icon: "👋", content: welcomeDoc() });
      wsId = ws.id;
    }
    await setSetting("lastWorkspace", wsId);
  }
  watchSearchIndex(() => wsId!);
  return wsId;
}

let dirty = true; // a full build is needed (first use, or another workspace)
let currentWs = "";
let building: Promise<unknown> | null = null;
let pending = new Map<IndexedTable, Set<string>>(); // rows changed since the index was last brought up to date

/** Resolves once the index reflects every change made before the call (waits for work already running). */
export async function ensureSearchIndex(workspaceId: string) {
  while (building || dirty || currentWs !== workspaceId || pending.size) {
    if (building) { await building; continue; }
    if (dirty || currentWs !== workspaceId) {
      dirty = false;
      currentWs = workspaceId;
      pending = new Map(); // the full build reads everything
      building = searchIndex.build(workspaceId).finally(() => { building = null; });
    } else {
      const batch = pending;
      pending = new Map();
      building = searchIndex.applyChanges(workspaceId, batch).finally(() => { building = null; });
    }
    await building;
  }
}

let watching = false;
function watchSearchIndex(getWs: () => string) {
  if (watching) return;
  watching = true;
  const d = db();
  const refresh = debounce(() => { if (currentWs) void ensureSearchIndex(currentWs); }, 800);
  const tables: IndexedTable[] = ["pages", "records", "tasks", "projects", "events", "attachments", "syncedBlocks"];
  for (const name of tables) {
    const note = (key: unknown) => { if (key === undefined || key === null) { dirty = true; } else { if (!pending.has(name)) pending.set(name, new Set()); pending.get(name)!.add(String(key)); } refresh(); };
    const t = d[name] as unknown as { hook(ev: string, fn: (...a: unknown[]) => void): void };
    t.hook("creating", (key, obj) => note(key ?? (obj as { id?: string })?.id));
    t.hook("updating", (_mods, key) => note(key));
    t.hook("deleting", (key) => note(key));
  }
  // Build the index soon after start, while idle, so the first search is usually instant.
  const idle = (globalThis as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
  idle(() => { const ws = getWs(); if (ws) void ensureSearchIndex(ws); });
}
