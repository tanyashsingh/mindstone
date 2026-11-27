import MiniSearch from "minisearch";
import { db } from "./db";
import type { Attachment, CalendarEvent, Database, DbRecord, ID, Page, Project, SyncedBlock, Task } from "./types";
import { recordTitle } from "@/lib/dbquery";

export type SearchKind = "page" | "database" | "record" | "task" | "project" | "event" | "attachment" | "tag";
export interface SearchDoc { id: string; kind: SearchKind; refId: ID; parentId?: ID; title: string; body: string; tags: string }
export interface SearchHit extends SearchDoc { score: number; snippet: string }
export type IndexedTable = "pages" | "records" | "tasks" | "projects" | "events" | "attachments" | "syncedBlocks";

// ---- One row → its search document ---------------------------------------------------------------
/** Prefix matching from 3 letters and typo tolerance from 5: short terms would otherwise match most of a large index. */
const SEARCH_OPTIONS = { boost: { title: 3, tags: 2 }, prefix: (t: string) => t.length >= 3, fuzzy: (t: string) => (t.length >= 5 ? 0.2 : false) };

const pageDoc = (p: Page): SearchDoc => ({ id: `page:${p.id}`, kind: p.kind === "database" ? "database" : "page", refId: p.id, title: p.title || "Untitled", body: p.text, tags: p.tags.join(" ") });
const RECORD_TEXT = ["text", "url", "email", "phone", "number"];
const recordDoc = (d: Database, r: DbRecord): SearchDoc => ({ id: `record:${r.id}`, kind: "record", refId: r.id, parentId: d.pageId, title: recordTitle(d, r), body: d.properties.filter((p) => RECORD_TEXT.includes(p.type)).map((p) => String(r.values[p.id] ?? "")).join(" "), tags: d.name });
const taskDoc = (t: Task): SearchDoc => ({ id: `task:${t.id}`, kind: "task", refId: t.id, title: t.title, body: t.description, tags: t.tags.join(" ") });
const projectDoc = (p: Project): SearchDoc => ({ id: `project:${p.id}`, kind: "project", refId: p.id, title: p.name, body: p.description, tags: "" });
const eventDoc = (e: CalendarEvent): SearchDoc => ({ id: `event:${e.id}`, kind: "event", refId: e.id, title: e.title, body: e.notes, tags: e.calendar });
const attachmentDoc = (a: Attachment): SearchDoc => ({ id: `attachment:${a.id}`, kind: "attachment", refId: a.id, parentId: a.pageId ?? undefined, title: a.name, body: a.text ? a.text.slice(0, 200_000) : a.mime, tags: "" });
const syncedDoc = (s: SyncedBlock, pageTitle: string): SearchDoc => ({ id: `synced:${s.id}`, kind: "page", refId: s.sourcePageId, title: `${pageTitle} · synced block`, body: s.text, tags: "" });
const tagDoc = (t: string): SearchDoc => ({ id: `tag:${t}`, kind: "tag", refId: t, title: `#${t}`, body: "", tags: t });
const PREFIX: Record<IndexedTable, string> = { pages: "page", records: "record", tasks: "task", projects: "project", events: "event", attachments: "attachment", syncedBlocks: "synced" };

/**
 * In-memory full-text index (fuzzy + prefix). Built once per workspace in small chunks (the app stays responsive
 * even with hundreds of thousands of items), then kept current row by row as things change.
 */
export class SearchIndex {
  private ms = new MiniSearch<SearchDoc>({
    fields: ["title", "body", "tags"],
    storeFields: ["kind", "refId", "parentId", "title", "body", "tags"],
    searchOptions: SEARCH_OPTIONS,
  });
  private ids = new Set<string>();

  async build(workspaceId: ID) {
    const d = db();
    const docs: SearchDoc[] = [];
    const pages = await d.pages.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray();
    for (const p of pages) docs.push(pageDoc(p));
    const livePageIds = new Set(pages.map((p) => p.id));
    for (const database of await d.databases.where("workspaceId").equals(workspaceId).toArray()) {
      if (!livePageIds.has(database.pageId)) continue;
      for (const r of await d.records.where("databaseId").equals(database.id).toArray()) if (!r.deletedAt) docs.push(recordDoc(database, r));
    }
    const tasks = await d.tasks.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray();
    for (const t of tasks) docs.push(taskDoc(t));
    for (const p of await d.projects.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray()) docs.push(projectDoc(p));
    for (const e of await d.events.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray()) docs.push(eventDoc(e));
    for (const a of await d.attachments.where("workspaceId").equals(workspaceId).toArray()) docs.push(attachmentDoc(a));
    const pageTitle = new Map(pages.map((p) => [p.id, p.title || "Untitled"]));
    for (const s of await d.syncedBlocks.where("workspaceId").equals(workspaceId).toArray()) if (pageTitle.has(s.sourcePageId) && s.text.trim()) docs.push(syncedDoc(s, pageTitle.get(s.sourcePageId)!));
    for (const t of new Set(pages.flatMap((p) => p.tags).concat(tasks.flatMap((t) => t.tags)))) docs.push(tagDoc(t));
    const fresh = new MiniSearch<SearchDoc>({ fields: ["title", "body", "tags"], storeFields: ["kind", "refId", "parentId", "title", "body", "tags"], searchOptions: SEARCH_OPTIONS });
    await fresh.addAllAsync(docs, { chunkSize: 500 }); // yields between chunks so typing and scrolling stay smooth
    this.ms = fresh;
    this.ids = new Set(docs.map((x) => x.id));
    return docs.length;
  }

  /** Brings the index up to date for rows that changed (created, edited, trashed or deleted). */
  async applyChanges(workspaceId: ID, changed: Map<IndexedTable, Set<string>>) {
    const d = db();
    const work: { table: IndexedTable; row: unknown }[] = [];
    for (const [table, keys] of changed) {
      const rows = await (d[table] as unknown as { bulkGet(k: string[]): Promise<unknown[]> }).bulkGet([...keys]);
      [...keys].forEach((k, i) => {
        const row = rows[i] as { workspaceId?: ID; deletedAt?: number } | undefined;
        const id = `${PREFIX[table]}:${k}`;
        if (!row || row.deletedAt || (row.workspaceId && row.workspaceId !== workspaceId)) { this.remove(id); return; }
        work.push({ table, row });
      });
    }
    const dbCache = new Map<ID, Database | undefined>();
    for (const { table, row } of work) {
      if (table === "pages") { const p = row as Page; this.upsert(pageDoc(p)); for (const t of p.tags) if (!this.ids.has(`tag:${t}`)) this.upsert(tagDoc(t)); }
      else if (table === "tasks") { const t = row as Task; this.upsert(taskDoc(t)); for (const g of t.tags) if (!this.ids.has(`tag:${g}`)) this.upsert(tagDoc(g)); }
      else if (table === "projects") this.upsert(projectDoc(row as Project));
      else if (table === "events") this.upsert(eventDoc(row as CalendarEvent));
      else if (table === "attachments") this.upsert(attachmentDoc(row as Attachment));
      else if (table === "records") {
        const r = row as DbRecord;
        if (!dbCache.has(r.databaseId)) dbCache.set(r.databaseId, await d.databases.get(r.databaseId));
        const database = dbCache.get(r.databaseId);
        if (database && database.workspaceId === workspaceId) this.upsert(recordDoc(database, r));
      } else if (table === "syncedBlocks") {
        const s = row as SyncedBlock;
        const page = await d.pages.get(s.sourcePageId);
        if (page && !page.deletedAt && s.text.trim()) this.upsert(syncedDoc(s, page.title || "Untitled")); else this.remove(`synced:${s.id}`);
      }
    }
  }

  upsert(doc: SearchDoc) {
    if (this.ids.has(doc.id)) this.ms.discard(doc.id);
    this.ms.add(doc);
    this.ids.add(doc.id);
  }

  remove(id: string) {
    if (this.ids.has(id)) { this.ms.discard(id); this.ids.delete(id); }
  }

  get size() { return this.ids.size; }

  search(q: string, opts: { kinds?: SearchKind[]; limit?: number } = {}): SearchHit[] {
    const query = q.trim();
    if (!query) return [];
    const res = this.ms.search(query, opts.kinds?.length ? { filter: (r) => opts.kinds!.includes(r.kind as SearchKind) } : undefined);
    return res.slice(0, opts.limit ?? 50).map((r) => {
      const doc = r as unknown as SearchDoc & { score: number; terms: string[] };
      return { ...doc, id: String(r.id), score: r.score, snippet: makeSnippet(doc.body ?? "", doc.terms ?? []) };
    });
  }
}

export function makeSnippet(body: string, terms: string[], radius = 70): string {
  if (!body) return "";
  const lower = body.toLowerCase();
  let at = -1;
  for (const t of terms) { at = lower.indexOf(t.toLowerCase()); if (at >= 0) break; }
  if (at < 0) return body.slice(0, radius * 2).replace(/\s+/g, " ");
  const s = Math.max(0, at - radius);
  return (s > 0 ? "…" : "") + body.slice(s, at + radius).replace(/\s+/g, " ") + (at + radius < body.length ? "…" : "");
}

export const searchIndex = new SearchIndex();
