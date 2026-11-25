import { db, patch } from "./db";
import type {
  Activity, Attachment, CalendarEvent, Database, DatabaseView, DbRecord, ID, JSONContent, Page, Project, Property, PropertyType, Task, Workspace,
} from "./types";
import { docToText, emptyDoc, extractLinks, extractTags, reassignIds } from "@/lib/doc";
import { nextDate } from "@/lib/recurrence";
import { now, uid } from "@/lib/util";

export const OPTION_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

// ---- Activity -------------------------------------------------------------
export async function logActivity(workspaceId: ID, entity: Activity["entity"], entityId: ID, action: string, detail = "") {
  await db().activity.add({ id: uid(), workspaceId, at: now(), entity, entityId, action, detail: detail.slice(0, 200) });
}

// ---- Workspaces -----------------------------------------------------------
export async function createWorkspace(name: string, icon = "◆"): Promise<Workspace> {
  const ws: Workspace = { id: uid(), name: name.trim() || "Workspace", icon, createdAt: now(), updatedAt: now() };
  await db().workspaces.add(ws);
  await logActivity(ws.id, "workspace", ws.id, "created", ws.name);
  return ws;
}

export async function deleteWorkspace(id: ID) {
  const d = db();
  await d.transaction("rw", d.tables, async () => {
    const pages = await d.pages.where("workspaceId").equals(id).primaryKeys();
    await d.revisions.where("pageId").anyOf(pages).delete();
    await d.comments.where("pageId").anyOf(pages).delete();
    const dbs = await d.databases.where("workspaceId").equals(id).primaryKeys();
    await d.records.where("databaseId").anyOf(dbs).delete();
    const convs = await d.aiConversations.where("workspaceId").equals(id).primaryKeys();
    await d.aiMessages.where("conversationId").anyOf(convs).delete();
    for (const t of [d.pages, d.links, d.databases, d.tasks, d.projects, d.events, d.attachments, d.templates, d.habits, d.goals, d.activity, d.savedSearches, d.aiConversations, d.embeddings] as const) {
      await (t as unknown as { where: (k: string) => { equals: (v: string) => { delete: () => Promise<number> } } }).where("workspaceId").equals(id).delete();
    }
    await d.workspaces.delete(id);
  });
}

// ---- Pages ----------------------------------------------------------------
export function newPage(workspaceId: ID, parentId: ID | null, partial: Partial<Page> = {}): Page {
  const t = now();
  return {
    id: uid(), workspaceId, parentId, kind: "page", title: "", icon: "", cover: "", content: emptyDoc(), text: "",
    databaseId: null, tags: [], favorite: 0, locked: 0, sortKey: t, createdAt: t, updatedAt: t, lastOpenedAt: t, deletedAt: 0,
    ...partial,
  };
}

export async function createPage(workspaceId: ID, parentId: ID | null, partial: Partial<Page> = {}): Promise<Page> {
  const p = newPage(workspaceId, parentId, partial);
  if (p.content) {
    p.text = docToText(p.content);
  }
  await db().pages.add(p);
  if (p.content) await updateLinks(p);
  await logActivity(workspaceId, "page", p.id, "created", p.title);
  return p;
}

export async function getPage(id: ID) {
  return db().pages.get(id);
}

export async function livePages(workspaceId: ID): Promise<Page[]> {
  return db().pages.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray();
}

/** True when `candidate` is `ancestor` or sits underneath it. */
export async function isDescendant(candidate: ID, ancestor: ID): Promise<boolean> {
  let cur: ID | null = candidate;
  const seen = new Set<ID>();
  while (cur) {
    if (cur === ancestor) return true;
    if (seen.has(cur)) return true; // corrupted cycle: treat as invalid
    seen.add(cur);
    cur = (await db().pages.get(cur))?.parentId ?? null;
  }
  return false;
}

export async function movePage(id: ID, newParentId: ID | null, sortKey?: number): Promise<boolean> {
  if (newParentId && (await isDescendant(newParentId, id))) return false; // would create a cycle
  await db().pages.update(id, { parentId: newParentId, ...(sortKey !== undefined ? { sortKey } : {}), updatedAt: now() });
  return true;
}

export async function updatePageMeta(id: ID, changes: Partial<Pick<Page, "title" | "icon" | "cover" | "favorite" | "locked" | "tags">>) {
  await db().pages.update(id, { ...changes, updatedAt: now() });
  if (changes.title !== undefined) {
    const p = await getPage(id);
    if (p?.databaseId) await patch(db().databases, p.databaseId, { name: changes.title, updatedAt: now() });
  }
}

const REVISION_INTERVAL = 5 * 60 * 1000;
const MAX_REVISIONS = 50;

/** Persist editor content. Snapshots a revision at most every 5 minutes. */
export async function savePageContent(id: ID, content: JSONContent): Promise<void> {
  const d = db();
  const page = await d.pages.get(id);
  if (!page) return;
  if (page.locked) throw new Error("Page is locked");
  const text = docToText(content);
  const inlineTags = extractTags(text);
  const tags = [...new Set([...page.tags.filter((t) => !page.text.includes(`#${t}`)), ...inlineTags])];
  await d.transaction("rw", [d.pages, d.revisions, d.links], async () => {
    const last = await d.revisions.where("pageId").equals(id).reverse().sortBy("createdAt");
    if (!last[0] || now() - last[0].createdAt > REVISION_INTERVAL) {
      await d.revisions.add({ id: uid(), pageId: id, title: page.title, content: page.content, createdAt: now() });
      if (last.length >= MAX_REVISIONS) await d.revisions.bulkDelete(last.slice(MAX_REVISIONS - 1).map((r) => r.id));
    }
    const updated = { ...page, content, text, tags, updatedAt: now() };
    await d.pages.put(updated);
    await updateLinks(updated);
  });
}

export async function updateLinks(page: Page) {
  const d = db();
  const found = extractLinks(page.content);
  const titled = found.filter((l) => l.title);
  let byTitle = new Map<string, ID>();
  if (titled.length) {
    const pages = await livePages(page.workspaceId);
    byTitle = new Map(pages.map((p) => [p.title.trim().toLowerCase(), p.id]));
  }
  const rows = new Map<string, { id: string; workspaceId: ID; fromPageId: ID; toPageId: ID; kind: "wiki" | "mention" | "embed" }>();
  for (const l of found) {
    const to = l.toPageId ?? byTitle.get((l.title ?? "").toLowerCase());
    if (!to || to === page.id) continue;
    const id = `${page.id}:${to}:${l.kind}`;
    rows.set(id, { id, workspaceId: page.workspaceId, fromPageId: page.id, toPageId: to, kind: l.kind });
  }
  await d.links.where("fromPageId").equals(page.id).delete();
  if (rows.size) await d.links.bulkPut([...rows.values()]);
}

export async function touchPage(id: ID) {
  await db().pages.update(id, { lastOpenedAt: now() });
}

async function descendants(id: ID): Promise<Page[]> {
  const out: Page[] = [];
  const queue = [id];
  while (queue.length) {
    const kids = await db().pages.where("parentId").equals(queue.shift()!).toArray();
    out.push(...kids);
    queue.push(...kids.map((k) => k.id));
  }
  return out;
}

export async function trashPage(id: ID) {
  const t = now();
  const d = db();
  const p = await d.pages.get(id);
  if (!p) return;
  const subtree = [p, ...(await descendants(id))].filter((x) => !x.deletedAt);
  await d.pages.bulkUpdate(subtree.map((x) => ({ key: x.id, changes: { deletedAt: t } })));
  await logActivity(p.workspaceId, "page", id, "trashed", p.title);
}

export async function restorePage(id: ID) {
  const d = db();
  const p = await d.pages.get(id);
  if (!p) return;
  const stamp = p.deletedAt;
  const subtree = [p, ...(await descendants(id))].filter((x) => x.deletedAt === stamp);
  // If the parent is still trashed or gone, restore to the root.
  const parent = p.parentId ? await d.pages.get(p.parentId) : null;
  await d.pages.bulkUpdate(subtree.map((x) => ({ key: x.id, changes: { deletedAt: 0 } })));
  if (p.parentId && (!parent || parent.deletedAt)) await d.pages.update(id, { parentId: null });
  await logActivity(p.workspaceId, "page", id, "restored", p.title);
}

export async function purgePage(id: ID) {
  const d = db();
  const subtree = [(await d.pages.get(id))!, ...(await descendants(id))].filter(Boolean);
  const ids = subtree.map((x) => x.id);
  await d.transaction("rw", [d.pages, d.revisions, d.links, d.comments, d.databases, d.records, d.attachments, d.embeddings], async () => {
    await d.revisions.where("pageId").anyOf(ids).delete();
    await d.links.where("fromPageId").anyOf(ids).delete();
    await d.links.where("toPageId").anyOf(ids).delete();
    await d.comments.where("pageId").anyOf(ids).delete();
    await d.embeddings.where("pageId").anyOf(ids).delete();
    await d.attachments.where("pageId").anyOf(ids).delete();
    const dbIds = subtree.map((x) => x.databaseId).filter(Boolean) as ID[];
    if (dbIds.length) {
      await d.records.where("databaseId").anyOf(dbIds).delete();
      await d.databases.bulkDelete(dbIds);
    }
    await d.pages.bulkDelete(ids);
  });
}

export async function duplicatePage(id: ID): Promise<Page | undefined> {
  const src = await getPage(id);
  if (!src) return;
  const content = src.content ? reassignIds(src.content, uid) : emptyDoc();
  const copy = await createPage(src.workspaceId, src.parentId, {
    title: `${src.title || "Untitled"} (copy)`, icon: src.icon, cover: src.cover, content, tags: [...src.tags], sortKey: src.sortKey + 1,
  });
  if (src.databaseId) {
    const sdb = await db().databases.get(src.databaseId);
    if (sdb) {
      const ndb: Database = { ...structuredClone(sdb), id: uid(), pageId: copy.id, name: copy.title, createdAt: now(), updatedAt: now() };
      await db().databases.add(ndb);
      const recs = await db().records.where("databaseId").equals(sdb.id).toArray();
      await db().records.bulkAdd(recs.map((r) => ({ ...structuredClone(r), id: uid(), databaseId: ndb.id })));
      await db().pages.update(copy.id, { kind: "database", databaseId: ndb.id });
    }
  }
  return copy;
}

export async function restoreRevision(pageId: ID, revisionId: ID) {
  const rev = await db().revisions.get(revisionId);
  if (!rev || rev.pageId !== pageId) return;
  await savePageContent(pageId, rev.content ?? emptyDoc());
  await db().pages.update(pageId, { title: rev.title });
}

// ---- Databases ------------------------------------------------------------
export function newProperty(name: string, type: PropertyType, extra: Partial<Property> = {}): Property {
  const p: Property = { id: uid(), name, type, ...extra };
  if ((type === "select" || type === "multiSelect") && !p.options) p.options = [];
  if (type === "status" && !p.options) {
    p.options = [
      { id: uid(), name: "Not started", color: "gray" },
      { id: uid(), name: "In progress", color: "blue" },
      { id: uid(), name: "Done", color: "green" },
    ];
  }
  return p;
}

export function newView(type: DatabaseView["type"], name: string, extra: Partial<DatabaseView> = {}): DatabaseView {
  return { id: uid(), name, type, filter: { kind: "group", mode: "and", children: [] }, sorts: [], hidden: [], order: [], ...extra };
}

export async function createDatabase(workspaceId: ID, parentId: ID | null, name = "Untitled database", properties?: Property[]): Promise<{ page: Page; database: Database }> {
  const props = properties ?? [newProperty("Name", "title"), newProperty("Status", "status"), newProperty("Tags", "multiSelect"), newProperty("Date", "date")];
  const status = props.find((p) => p.type === "status" || p.type === "select");
  const date = props.find((p) => p.type === "date");
  const page = newPage(workspaceId, parentId, { kind: "database", title: name, icon: "▦", content: null });
  const database: Database = {
    id: uid(), workspaceId, pageId: page.id, name, properties: props, nextSeq: 1, createdAt: now(), updatedAt: now(),
    views: [
      newView("table", "Table"),
      newView("board", "Board", status ? { groupBy: status.id } : {}),
      ...(date ? [newView("calendar", "Calendar", { dateProperty: date.id })] : []),
    ],
  };
  page.databaseId = database.id;
  await db().transaction("rw", db().pages, db().databases, async () => {
    await db().pages.add(page);
    await db().databases.add(database);
  });
  await logActivity(workspaceId, "database", database.id, "created", name);
  return { page, database };
}

export async function updateDatabase(id: ID, changes: Partial<Database>) {
  await patch(db().databases, id, { ...changes, updatedAt: now() });
}

export async function addRecord(databaseId: ID, values: Record<ID, unknown> = {}): Promise<DbRecord> {
  const d = db();
  return d.transaction("rw", d.databases, d.records, async () => {
    const database = await d.databases.get(databaseId);
    if (!database) throw new Error("Database not found");
    const rec: DbRecord = { id: uid(), databaseId, seq: database.nextSeq, values, sortKey: now(), createdAt: now(), updatedAt: now(), deletedAt: 0 };
    await d.records.add(rec);
    await patch(d.databases, databaseId, { nextSeq: database.nextSeq + 1 });
    return rec;
  });
}

/** Save a record's editable values as a named template. Computed properties are skipped. */
export async function saveRecordTemplate(databaseId: ID, name: string, values: Record<ID, unknown>): Promise<void> {
  const database = await db().databases.get(databaseId);
  if (!database) throw new Error("Database not found");
  const computed = new Set(database.properties.filter((p) => ["formula", "rollup", "createdTime", "editedTime", "uniqueId"].includes(p.type)).map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(values).filter(([k, v]) => !computed.has(k) && database.properties.some((p) => p.id === k) && v !== undefined));
  const tpl = { id: uid(), name: name.trim() || "Template", values: structuredClone(kept) };
  await patch(db().databases, databaseId, { templates: [...(database.templates ?? []), tpl], updatedAt: now() });
}

export async function deleteRecordTemplate(databaseId: ID, templateId: ID) {
  const database = await db().databases.get(databaseId);
  if (database) await patch(db().databases, databaseId, { templates: (database.templates ?? []).filter((t) => t.id !== templateId) });
}

/** New record pre-filled from a template; values whose property no longer exists are dropped. */
export async function addRecordFromTemplate(databaseId: ID, templateId: ID): Promise<DbRecord> {
  const database = await db().databases.get(databaseId);
  const tpl = database?.templates?.find((t) => t.id === templateId);
  if (!database || !tpl) throw new Error("Template not found");
  const ids = new Set(database.properties.map((p) => p.id));
  return addRecord(databaseId, structuredClone(Object.fromEntries(Object.entries(tpl.values).filter(([k]) => ids.has(k)))));
}

export async function updateRecord(id: ID, propertyId: ID, value: unknown) {
  const d = db();
  await d.transaction("rw", d.records, async () => {
    const r = await d.records.get(id);
    if (!r) return;
    await d.records.update(id, { values: { ...r.values, [propertyId]: value }, updatedAt: now() });
  });
}

export async function bulkUpdateRecords(ids: ID[], propertyId: ID, value: unknown) {
  const d = db();
  await d.transaction("rw", d.records, async () => {
    for (const id of ids) {
      const r = await d.records.get(id);
      if (r) await d.records.update(id, { values: { ...r.values, [propertyId]: value }, updatedAt: now() });
    }
  });
}

export async function deleteRecords(ids: ID[]) {
  await db().records.bulkDelete(ids);
}

// ---- Tasks ----------------------------------------------------------------
export function newTask(workspaceId: ID, partial: Partial<Task> = {}): Task {
  const t = now();
  return {
    id: uid(), workspaceId, projectId: null, parentTaskId: null, title: "", description: "", status: "todo", priority: "none",
    startDate: null, dueDate: null, reminderAt: null, tags: [], dependsOn: [], recurrence: null, estimateMin: 0, actualMin: 0,
    important: 0, sortKey: t, completedAt: 0, createdAt: t, updatedAt: t, deletedAt: 0, ...partial,
  };
}

export async function createTask(workspaceId: ID, partial: Partial<Task> = {}): Promise<Task> {
  const task = newTask(workspaceId, partial);
  await db().tasks.add(task);
  await logActivity(workspaceId, "task", task.id, "created", task.title);
  return task;
}

/** Tasks that this task depends on and are not done. */
export async function openBlockers(task: Task): Promise<Task[]> {
  if (!task.dependsOn.length) return [];
  const deps = await db().tasks.bulkGet(task.dependsOn);
  return deps.filter((t): t is Task => !!t && t.status !== "done" && !t.deletedAt);
}

/** Would adding `dependsOnId` to `taskId` create a dependency cycle? */
export async function wouldCreateCycle(taskId: ID, dependsOnId: ID): Promise<boolean> {
  const seen = new Set<ID>();
  const stack = [dependsOnId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = await db().tasks.get(cur);
    if (t) stack.push(...t.dependsOn);
  }
  return false;
}

/** Update a task; completing a recurring task schedules the next occurrence. */
export async function updateTask(id: ID, patch: Partial<Task>): Promise<Task | undefined> {
  const d = db();
  const t = await d.tasks.get(id);
  if (!t) return;
  const next: Task = { ...t, ...patch, updatedAt: now() };
  if (patch.status === "done" && t.status !== "done") {
    next.completedAt = now();
    if (t.recurrence && t.dueDate) {
      const due = nextDate(t.dueDate, t.recurrence);
      if (due) {
        const startShift = t.startDate ? nextDate(t.startDate, t.recurrence) : null;
        await d.tasks.add({ ...newTask(t.workspaceId, { ...t, id: uid(), status: "todo", completedAt: 0, actualMin: 0, dueDate: due, startDate: startShift, createdAt: now() }) });
      }
    }
    await logActivity(t.workspaceId, "task", id, "completed", t.title);
  }
  if (patch.status && patch.status !== "done") next.completedAt = 0;
  await d.tasks.put(next);
  return next;
}

export async function trashTask(id: ID) {
  const d = db();
  const kids = await d.tasks.where("parentTaskId").equals(id).primaryKeys();
  await d.tasks.bulkUpdate([id, ...kids].map((k) => ({ key: k, changes: { deletedAt: now() } })));
}

// ---- Projects -------------------------------------------------------------
export async function createProject(workspaceId: ID, partial: Partial<Project> = {}): Promise<Project> {
  const p: Project = {
    id: uid(), workspaceId, name: "New project", description: "", status: "planned", color: "blue", startDate: null, targetDate: null,
    milestones: [], docPageId: null, archived: 0, createdAt: now(), updatedAt: now(), deletedAt: 0, ...partial,
  };
  await db().projects.add(p);
  await logActivity(workspaceId, "project", p.id, "created", p.name);
  return p;
}
export async function updateProject(id: ID, patch: Partial<Project>) {
  await db().projects.update(id, { ...patch, updatedAt: now() });
}

// ---- Events ---------------------------------------------------------------
export async function createEvent(workspaceId: ID, partial: Partial<CalendarEvent>): Promise<CalendarEvent> {
  const start = partial.start ?? now();
  const ev: CalendarEvent = {
    id: uid(), workspaceId, title: "New event", notes: "", start, end: start + 3600e3, allDay: 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, calendar: "Personal", color: "blue", recurrence: null,
    reminderMin: null, createdAt: now(), updatedAt: now(), deletedAt: 0, ...partial,
  };
  if (ev.end < ev.start) ev.end = ev.start;
  await db().events.add(ev);
  return ev;
}
export async function updateEvent(id: ID, patch: Partial<CalendarEvent>) {
  await db().events.update(id, { ...patch, updatedAt: now() });
}

// ---- Attachments ----------------------------------------------------------
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jse|wsf|hta|lnk|dll|cpl|reg|jar)$/i;

export function validateFile(file: { name: string; size: number }): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) return `File is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`;
  if (BLOCKED_EXT.test(file.name)) return "Executable and script files are not allowed as attachments";
  return null;
}

export async function addAttachment(workspaceId: ID, pageId: ID | null, file: File): Promise<Attachment> {
  const err = validateFile(file);
  if (err) throw new Error(err);
  const a: Attachment = { id: uid(), workspaceId, pageId, name: file.name.slice(0, 200), mime: file.type || "application/octet-stream", size: file.size, blob: file, createdAt: now() };
  await db().attachments.add(a);
  void extractAttachmentText(a.id); // background: makes PDFs, Word and text files searchable
  return a;
}

/**
 * Extract text for attachments not processed yet: uploaded before this feature, or interrupted
 * (app closed mid-extraction). Runs at workspace open and before AI indexing.
 */
export async function extractPendingAttachments(workspaceId: ID): Promise<number> {
  const pending = (await db().attachments.where("workspaceId").equals(workspaceId).filter((a) => a.textStatus === undefined).primaryKeys()) as ID[];
  for (const id of pending) await extractAttachmentText(id);
  return pending.length;
}

/** Extract and store an attachment's text. Never throws; failures are recorded as textStatus "error". */
export async function extractAttachmentText(id: ID): Promise<void> {
  const a = await db().attachments.get(id);
  if (!a) return;
  const { extractText } = await import("@/lib/extract");
  try {
    const text = await extractText(a.name, a.mime, a.blob);
    const status = text === null ? "unsupported" : text.trim() ? "ok" : "empty";
    await patch(db().attachments, id, { text: text ?? undefined, textStatus: status });
  } catch (e) {
    console.warn("[Cairn] text extraction failed", a.name, e);
    await patch(db().attachments, id, { textStatus: "error" });
  }
}

// ---- Settings -------------------------------------------------------------
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db().settings.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setSetting(key: string, value: unknown) {
  await db().settings.put({ key, value });
}
