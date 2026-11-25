import MiniSearch from "minisearch";
import { db } from "./db";
import type { ID } from "./types";
import { recordTitle } from "@/lib/dbquery";

export type SearchKind = "page" | "database" | "record" | "task" | "project" | "event" | "attachment" | "tag";
export interface SearchDoc { id: string; kind: SearchKind; refId: ID; parentId?: ID; title: string; body: string; tags: string }
export interface SearchHit extends SearchDoc { score: number; snippet: string }

/** In-memory full-text index (fuzzy + prefix) rebuilt from IndexedDB; incrementally refreshed. */
export class SearchIndex {
  private ms = new MiniSearch<SearchDoc>({
    fields: ["title", "body", "tags"],
    storeFields: ["kind", "refId", "parentId", "title", "body", "tags"],
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.2 },
  });
  private ids = new Set<string>();

  async build(workspaceId: ID) {
    const d = db();
    const docs: SearchDoc[] = [];
    const pages = await d.pages.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray();
    for (const p of pages) docs.push({ id: `page:${p.id}`, kind: p.kind === "database" ? "database" : "page", refId: p.id, title: p.title || "Untitled", body: p.text, tags: p.tags.join(" ") });
    const dbs = await d.databases.where("workspaceId").equals(workspaceId).toArray();
    const livePageIds = new Set(pages.map((p) => p.id));
    for (const database of dbs) {
      if (!livePageIds.has(database.pageId)) continue;
      const recs = await d.records.where("databaseId").equals(database.id).toArray();
      for (const r of recs) {
        const body = database.properties.filter((p) => ["text", "url", "email", "phone", "number"].includes(p.type)).map((p) => String(r.values[p.id] ?? "")).join(" ");
        docs.push({ id: `record:${r.id}`, kind: "record", refId: r.id, parentId: database.pageId, title: recordTitle(database, r), body, tags: database.name });
      }
    }
    const tasks = await d.tasks.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray();
    for (const t of tasks) docs.push({ id: `task:${t.id}`, kind: "task", refId: t.id, title: t.title, body: t.description, tags: t.tags.join(" ") });
    const projects = await d.projects.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray();
    for (const p of projects) docs.push({ id: `project:${p.id}`, kind: "project", refId: p.id, title: p.name, body: p.description, tags: "" });
    const events = await d.events.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).toArray();
    for (const e of events) docs.push({ id: `event:${e.id}`, kind: "event", refId: e.id, title: e.title, body: e.notes, tags: e.calendar });
    const atts = await d.attachments.where("workspaceId").equals(workspaceId).toArray();
    for (const a of atts) docs.push({ id: `attachment:${a.id}`, kind: "attachment", refId: a.id, parentId: a.pageId ?? undefined, title: a.name, body: a.text ? a.text.slice(0, 200_000) : a.mime, tags: "" });
    const tags = new Set(pages.flatMap((p) => p.tags).concat(tasks.flatMap((t) => t.tags)));
    for (const t of tags) docs.push({ id: `tag:${t}`, kind: "tag", refId: t, title: `#${t}`, body: "", tags: t });
    this.ms.removeAll();
    this.ids.clear();
    this.ms.addAll(docs);
    for (const x of docs) this.ids.add(x.id);
    return docs.length;
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
