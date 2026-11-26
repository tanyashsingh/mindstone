import { generateJSON } from "@tiptap/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { db } from "./db";
import * as repo from "./repo";
import type { Database, ID, JSONContent, Page, Property } from "./types";
import { docToMarkdown } from "@/lib/doc";
import { parseCSV, toCSV } from "@/lib/csv";
import { displayValue, titleProp } from "@/lib/dbquery";
import { makeZip, type ZipEntry } from "@/lib/zip";
import { downloadBlob, safeFileName } from "@/lib/util";
import { schemaExtensions } from "@/editor/schema";

// ---- Import: Markdown / HTML / text → document JSON ---------------------------------

function preprocessMarkdown(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/, "") // YAML front matter (Obsidian) is dropped; disclosed in the import summary
    .replace(/\$\$\n?([\s\S]+?)\n?\$\$/g, (_m, tex: string) => `<div data-math="${escAttr(tex.trim())}"></div>`)
    .replace(/```mermaid\n([\s\S]*?)```/g, (_m, code: string) => `<div data-mermaid="${escAttr(code.trim())}"></div>`)
    .replace(/!\[\[([^\]]+)\]\]/g, "[[$1]]") // Obsidian embeds become links
    // GitHub/Obsidian callouts: > [!TIP] ... → callout block
    .replace(/^> \[!(\w+)\][^\n]*\n((?:>.*(?:\n|$))*)/gm, (_m, kind: string, body: string) => {
      const inner = marked.parse(body.replace(/^> ?/gm, ""), { async: false }) as string;
      const variant = { tip: "tip", warning: "warning", caution: "danger", important: "warning" }[kind.toLowerCase()] ?? "note";
      return `<div data-callout data-variant="${variant}">${inner}</div>\n`;
    });
}
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Rewrite marked's checkbox lists into TipTap's task-list markup. */
function taskListHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("ul").forEach((ul) => {
    const items = [...ul.children].filter((c) => c.tagName === "LI");
    if (!items.length || !items.every((li) => li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]"))) return;
    ul.setAttribute("data-type", "taskList");
    for (const li of items) {
      const box = li.querySelector("input[type=checkbox]") as HTMLInputElement;
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", String(box.checked || box.hasAttribute("checked")));
      box.remove();
    }
  });
  return doc.body.innerHTML;
}

export function htmlToDoc(html: string): JSONContent {
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["data-math", "data-mermaid", "data-type", "data-checked", "data-callout", "data-variant"], FORBID_TAGS: ["style", "script", "iframe", "form"] });
  return generateJSON(taskListHtml(clean), schemaExtensions()) as JSONContent;
}
export function markdownToDoc(md: string): JSONContent {
  return htmlToDoc(marked.parse(preprocessMarkdown(md), { async: false, gfm: true }) as string);
}
export function textToDoc(text: string): JSONContent {
  return { type: "doc", content: text.split(/\n{2,}/).map((para) => ({ type: "paragraph", content: para ? [{ type: "text", text: para }] : [] })) };
}

export interface ImportReport { pages: number; databases: number; skipped: string[]; notes: string[] }

/** Import files (or a whole folder such as an Obsidian vault / unzipped Notion export). Folder structure becomes page nesting. */
export async function importFiles(workspaceId: ID, files: File[], parentId: ID | null = null): Promise<ImportReport> {
  const report: ImportReport = { pages: 0, databases: 0, skipped: [], notes: [] };
  const folders = new Map<string, ID | null>([["", parentId]]);
  const ensureFolder = async (path: string): Promise<ID | null> => {
    if (folders.has(path)) return folders.get(path)!;
    const idx = path.lastIndexOf("/");
    const parent = await ensureFolder(idx < 0 ? "" : path.slice(0, idx));
    const name = path.slice(idx + 1);
    const p = await repo.createPage(workspaceId, parent, { title: name, icon: "📁" });
    folders.set(path, p.id);
    report.pages++;
    return p.id;
  };
  let frontMatter = false;
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (/(^|\/)\.(obsidian|git|trash)\//.test(rel)) continue;
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    // Notion appends a 32-hex id to names: strip it for titles.
    const base = f.name.replace(/\.[^.]+$/, "").replace(/\s[0-9a-f]{32}$/i, "");
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const parent = await ensureFolder(dir);
    try {
      if (ext === "md" || ext === "markdown") {
        const text = await f.text();
        if (text.startsWith("---\n")) frontMatter = true;
        await repo.createPage(workspaceId, parent, { title: base, content: markdownToDoc(text) });
        report.pages++;
      } else if (ext === "html" || ext === "htm") {
        const text = await f.text();
        const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() || base;
        await repo.createPage(workspaceId, parent, { title, content: htmlToDoc(text) });
        report.pages++;
      } else if (ext === "txt") {
        await repo.createPage(workspaceId, parent, { title: base, content: textToDoc(await f.text()) });
        report.pages++;
      } else if (ext === "csv") {
        await importCSV(workspaceId, parent, base, await f.text());
        report.databases++;
      } else if (ext === "json") {
        const ok = await importJSONRecords(workspaceId, parent, base, await f.text());
        if (ok) report.databases++; else report.skipped.push(`${rel} (not an array of records; use Settings → Backup to restore a Mindstone backup)`);
      } else if (repo.validateFile(f) === null) {
        await repo.addAttachment(workspaceId, parent, f);
        report.notes.push(`${rel} stored as an attachment`);
      } else report.skipped.push(`${rel} (blocked file type or too large)`);
    } catch (e) {
      report.skipped.push(`${rel} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (frontMatter) report.notes.push("YAML front matter was not imported as properties.");
  return report;
}

function inferType(values: string[]): Property["type"] {
  const vs = values.filter((v) => v !== "").slice(0, 200);
  if (!vs.length) return "text";
  if (vs.every((v) => /^(true|false|yes|no)$/i.test(v))) return "checkbox";
  if (vs.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return "number";
  if (vs.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) return "date";
  if (vs.every((v) => /^https?:\/\//.test(v))) return "url";
  if (vs.every((v) => /^[^@\s]+@[^@\s]+$/.test(v))) return "email";
  const distinct = new Set(vs);
  if (distinct.size <= Math.max(3, vs.length / 4) && distinct.size <= 20) return "select";
  return "text";
}

export async function importCSV(workspaceId: ID, parentId: ID | null, name: string, text: string) {
  const rows = parseCSV(text);
  const [header, ...data] = rows;
  if (!header) throw new Error("Empty CSV");
  return importRows(workspaceId, parentId, name, header, data);
}

async function importJSONRecords(workspaceId: ID, parentId: ID | null, name: string, text: string): Promise<boolean> {
  const arr = JSON.parse(text) as unknown;
  if (!Array.isArray(arr) || !arr.every((x) => x && typeof x === "object" && !Array.isArray(x))) return false;
  const header = [...new Set(arr.flatMap((o) => Object.keys(o as object)))];
  const data = arr.map((o) => header.map((h) => { const v = (o as Record<string, unknown>)[h]; return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); }));
  await importRows(workspaceId, parentId, name, header, data);
  return true;
}

async function importRows(workspaceId: ID, parentId: ID | null, name: string, header: string[], data: string[][]) {
  const props: Property[] = header.map((h, i) => {
    const type = i === 0 ? "title" : inferType(data.map((r) => r[i] ?? ""));
    const p = repo.newProperty(h || `Column ${i + 1}`, type);
    if (type === "select") p.options = [...new Set(data.map((r) => r[i] ?? "").filter(Boolean))].map((n, k) => ({ id: `o${k}`, name: n, color: repo.OPTION_COLORS[k % repo.OPTION_COLORS.length]! }));
    return p;
  });
  const { page, database } = await repo.createDatabase(workspaceId, parentId, name, props);
  let seq = 1;
  const now = Date.now();
  await db().records.bulkAdd(data.map((r, idx) => {
    const values: Record<string, unknown> = {};
    props.forEach((p, i) => {
      const raw = r[i] ?? "";
      if (raw === "") return;
      if (p.type === "number") values[p.id] = Number(raw);
      else if (p.type === "checkbox") values[p.id] = /^(true|yes)$/i.test(raw);
      else if (p.type === "select") values[p.id] = p.options!.find((o) => o.name === raw)?.id;
      else if (p.type === "date") values[p.id] = raw.slice(0, 10);
      else values[p.id] = raw;
    });
    return { id: `${database.id}-${idx}-${Math.random().toString(36).slice(2, 8)}`, databaseId: database.id, seq: seq++, values, sortKey: now + idx, createdAt: now, updatedAt: now, deletedAt: 0 };
  }));
  await repo.updateDatabase(database.id, { nextSeq: seq });
  return page;
}

// ---- Export ----------------------------------------------------------------------

export async function databaseToCSV(database: Database): Promise<string> {
  const recs = (await db().records.where("databaseId").equals(database.id).toArray()).filter((r) => !r.deletedAt).sort((a, b) => a.sortKey - b.sortKey);
  const props = database.properties;
  return toCSV([props.map((p) => p.name), ...recs.map((r) => props.map((p) => displayValue(database, r, p)))]);
}
export async function databaseToJSON(database: Database): Promise<string> {
  const recs = (await db().records.where("databaseId").equals(database.id).toArray()).filter((r) => !r.deletedAt);
  return JSON.stringify(recs.map((r) => Object.fromEntries(database.properties.map((p) => [p.name, displayValue(database, r, p)]))), null, 2);
}

async function titleResolver(workspaceId: ID) {
  const pages = await repo.livePages(workspaceId);
  const m = new Map(pages.map((p) => [p.id, p.title || "Untitled"]));
  return (id: string) => m.get(id) ?? "Missing page";
}

function htmlDocument(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escAttr(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">
<style>body{font:16px/1.65 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1f1f1e}pre{background:#f3f3f1;padding:12px;border-radius:8px;overflow:auto}code{font-family:Consolas,monospace}blockquote{border-left:3px solid #ccc;margin:0;padding-left:14px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}img{max-width:100%}</style>
</head><body><h1>${escAttr(title)}</h1>${body}</body></html>`;
}

export async function pageToMarkdown(page: Page): Promise<string> {
  if (page.kind === "database" && page.databaseId) {
    const d = await db().databases.get(page.databaseId);
    return d ? `# ${page.title}\n\n${(await databaseToCSV(d)).trim()}\n` : "";
  }
  return `# ${page.title || "Untitled"}\n\n${docToMarkdown(page.content, await titleResolver(page.workspaceId))}`;
}

export async function exportPage(pageId: ID, format: "md" | "html" | "pdf") {
  const page = await repo.getPage(pageId);
  if (!page) return;
  const md = await pageToMarkdown(page);
  const name = safeFileName(page.title || "Untitled");
  if (format === "md") return downloadBlob(new Blob([md], { type: "text/markdown" }), `${name}.md`);
  const body = DOMPurify.sanitize(marked.parse(md.replace(/^# .*\n/, ""), { async: false }) as string);
  const html = htmlDocument(page.title || "Untitled", body);
  if (format === "html") return downloadBlob(new Blob([html], { type: "text/html" }), `${name}.html`);
  // PDF: print an isolated iframe; the OS "Save as PDF" printer produces the file.
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-modals allow-same-origin");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  frame.src = url;
  frame.onload = () => { frame.contentWindow?.print(); setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 1000); };
}

/** Whole workspace as a ZIP of Markdown files (hierarchy preserved), CSVs for databases, and attachments. */
export async function exportWorkspaceMarkdown(workspaceId: ID) {
  const pages = await repo.livePages(workspaceId);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const resolve = await titleResolver(workspaceId);
  const enc = new TextEncoder();
  const used = new Set<string>();
  const pathOf = (p: Page): string => {
    const parts: string[] = [];
    let cur: Page | undefined = p;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); parts.unshift(safeFileName(cur.title || "Untitled")); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return parts.join("/");
  };
  const entries: ZipEntry[] = [];
  for (const p of pages) {
    let path = pathOf(p);
    while (used.has(path)) path += "_";
    used.add(path);
    if (p.kind === "database" && p.databaseId) {
      const d = await db().databases.get(p.databaseId);
      if (d) entries.push({ path: `${path}.csv`, data: enc.encode(await databaseToCSV(d)) });
    } else entries.push({ path: `${path}.md`, data: enc.encode(`# ${p.title || "Untitled"}\n\n${docToMarkdown(p.content, resolve)}`) });
  }
  for (const a of await db().attachments.where("workspaceId").equals(workspaceId).toArray()) {
    entries.push({ path: `_attachments/${a.id}-${safeFileName(a.name)}`, data: new Uint8Array(await a.blob.arrayBuffer()) });
  }
  const ws = await db().workspaces.get(workspaceId);
  downloadBlob(makeZip(entries), `${safeFileName(ws?.name ?? "workspace")}-markdown.zip`);
}

export { titleProp };
