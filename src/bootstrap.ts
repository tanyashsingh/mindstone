import { db } from "@/data/db";
import { createPage, createWorkspace, getSetting, setSetting } from "@/data/repo";
import { searchIndex } from "@/data/search";
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

/** Ensure a workspace exists and return the one to open. */
export async function bootstrap(): Promise<string> {
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

let dirty = true;
let currentWs = "";
let building: Promise<unknown> | null = null;
/** Resolves once the index reflects every change made before the call (waits for a rebuild already running). */
export async function ensureSearchIndex(workspaceId: string) {
  while (building || dirty || currentWs !== workspaceId) {
    if (building) { await building; continue; }
    dirty = false;
    currentWs = workspaceId;
    building = searchIndex.build(workspaceId).finally(() => { building = null; });
    await building;
  }
}

let watching = false;
function watchSearchIndex(getWs: () => string) {
  if (watching) return;
  watching = true;
  const d = db();
  const rebuild = debounce(() => { if (currentWs) void ensureSearchIndex(currentWs); }, 1500);
  const mark = () => { dirty = true; rebuild(); };
  for (const t of [d.pages, d.records, d.tasks, d.projects, d.events, d.attachments, d.syncedBlocks]) {
    t.hook("creating", mark);
    t.hook("updating", mark);
    t.hook("deleting", mark);
  }
  void getWs;
}
