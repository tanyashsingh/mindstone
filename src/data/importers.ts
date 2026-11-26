/**
 * Importers for other apps: Notion's export .zip (any .zip of Markdown/HTML/CSV), Evernote .enex, and Todoist CSV.
 * Apple Notes and Bear are imported as folders of Markdown or HTML (see Settings → Import), through importFiles.
 */
import * as repo from "./repo";
import type { ID, Priority, Recurrence } from "./types";
import { htmlToDoc, type ImportReport } from "./portability";
import { listZip, readZipEntry } from "@/lib/extract";
import { parseCSV } from "@/lib/csv";
import { toISODate } from "@/lib/util";

/** Files inside a .zip (nested .zip files, as in large Notion exports, are opened too), with their paths. */
export async function filesFromZip(zip: Blob, prefix = "", depth = 0): Promise<File[]> {
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const out: File[] = [];
  for (const e of listZip(bytes)) {
    if (e.name.endsWith("/") || /(^|\/)(__MACOSX|\.DS_Store)/.test(e.name)) continue;
    const data = await readZipEntry(bytes, e);
    const path = prefix + e.name;
    if (/\.zip$/i.test(path) && depth < 2) { out.push(...(await filesFromZip(new Blob([data as BlobPart]), path.replace(/\.zip$/i, "") + "/", depth + 1))); continue; }
    const f = new File([data as BlobPart], path.split("/").pop()!, { type: mimeFor(path) });
    Object.defineProperty(f, "webkitRelativePath", { value: path });
    out.push(f);
  }
  return out;
}

function mimeFor(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return ({ md: "text/markdown", html: "text/html", htm: "text/html", csv: "text/csv", txt: "text/plain", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" } as Record<string, string>)[ext] ?? "application/octet-stream";
}

// ---- Evernote (.enex) -------------------------------------------------------------------------
/** MD5 (RFC 1321): Evernote refers to images by the MD5 of their bytes. */
export function md5(bytes: Uint8Array): string {
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const tmp = D; D = C; C = B;
      const x = (A + F + K[i]! + dv.getUint32(off + g * 4, true)) >>> 0;
      const s = S[(i >> 4) * 4 + (i % 4)]!;
      B = (B + ((x << s) | (x >>> (32 - s)))) >>> 0;
      A = tmp;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}

const enexTime = (s: string | null | undefined) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s?.trim() ?? "");
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : Date.now();
};

/** One page per note (under a page named after the notebook file), with tags, dates, checkboxes and attachments. */
export async function importEvernote(workspaceId: ID, file: File, parentId: ID | null = null): Promise<ImportReport> {
  const report: ImportReport = { pages: 0, databases: 0, skipped: [], notes: [] };
  const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
  if (xml.querySelector("parsererror") || !xml.querySelector("en-export")) throw new Error(`${file.name} is not an Evernote export (.enex)`);
  const notebook = await repo.createPage(workspaceId, parentId, { title: file.name.replace(/\.enex$/i, ""), icon: "🐘" });
  report.pages++;
  for (const note of [...xml.querySelectorAll("en-export > note")]) {
    const title = note.querySelector(":scope > title")?.textContent?.trim() || "Untitled note";
    try {
      const page = await repo.createPage(workspaceId, notebook.id, { title, tags: [...note.querySelectorAll(":scope > tag")].map((t) => t.textContent!.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean) });
      // Resources first, so <en-media hash> can point at the stored files.
      const byHash = new Map<string, string>();
      for (const r of [...note.querySelectorAll(":scope > resource")]) {
        const b64 = (r.querySelector("data")?.textContent ?? "").replace(/\s+/g, "");
        if (!b64) continue;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const mime = r.querySelector("mime")?.textContent?.trim() || "application/octet-stream";
        const name = r.querySelector("resource-attributes > file-name")?.textContent?.trim() || `attachment.${mime.split("/")[1] ?? "bin"}`;
        try {
          const a = await repo.addAttachment(workspaceId, page.id, new File([bytes as BlobPart], name, { type: mime }));
          byHash.set(md5(bytes), a.id);
        } catch (e) { report.skipped.push(`${title}: ${name} (${e instanceof Error ? e.message : String(e)})`); }
      }
      let html = (note.querySelector(":scope > content")?.textContent ?? "").replace(/^[\s\S]*?<en-note[^>]*>/i, "").replace(/<\/en-note>[\s\S]*$/i, "");
      html = html
        .replace(/<en-media\b[^>]*\bhash="([0-9a-f]{32})"[^>]*\/?>(?:<\/en-media>)?/gi, (_m, h: string) => (byHash.has(h) ? `</p><div data-attachment="${byHash.get(h)}"></div><p>` : ""))
        .replace(/<div>\s*<en-todo\b[^>]*checked="true"[^>]*\/?>(?:<\/en-todo>)?([\s\S]*?)<\/div>/gi, '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>$1</p></li></ul>')
        .replace(/<div>\s*<en-todo\b[^>]*\/?>(?:<\/en-todo>)?([\s\S]*?)<\/div>/gi, '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>$1</p></li></ul>')
        .replace(/<en-todo\b[^>]*checked="true"[^>]*\/?>/gi, "☑ ").replace(/<en-todo\b[^>]*\/?>/gi, "☐ ")
        .replace(/<en-crypt[\s\S]*?<\/en-crypt>/gi, "<p><em>(Encrypted Evernote text was not imported.)</em></p>");
      const content = htmlToDoc(html);
      await repo.savePageContent(page.id, content);
      const created = enexTime(note.querySelector(":scope > created")?.textContent), updated = enexTime(note.querySelector(":scope > updated")?.textContent ?? note.querySelector(":scope > created")?.textContent);
      const { db } = await import("./db");
      await db().pages.update(page.id, { createdAt: created, updatedAt: Math.max(updated, created) });
      report.pages++;
    } catch (e) { report.skipped.push(`${title} (${e instanceof Error ? e.message : String(e)})`); }
  }
  if (html2textHint(xml)) report.notes.push("Some notes contained encrypted text, which Evernote doesn't export readably.");
  return report;
}
const html2textHint = (xml: Document) => !!xml.querySelector("content") && /en-crypt/i.test(xml.documentElement.textContent ?? "");

// ---- Todoist (CSV export) ------------------------------------------------------------------------
export const isTodoistCSV = (text: string) => /^﻿?"?TYPE"?,"?CONTENT"?,/i.test(text);

const TODOIST_PRIORITY: Record<string, Priority> = { "4": "urgent", "3": "high", "2": "medium", "1": "none" };

function todoistDate(s: string, now = new Date()): { due: string | null; recurrence: Recurrence } {
  const t = s.trim().toLowerCase();
  if (!t) return { due: null, recurrence: null };
  const every = /^every\s+(?:(\d+)\s+)?(day|days|week|weeks|month|months|year|years|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(t);
  if (every) {
    const word = every[2]!;
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const interval = Number(every[1] ?? 1) || 1;
    if (days.includes(word)) {
      const d = new Date(now); d.setDate(d.getDate() + ((days.indexOf(word) - d.getDay() + 7) % 7));
      return { due: toISODate(d), recurrence: { freq: "weekly", interval: 1, byDay: [word.slice(0, 2).toUpperCase()] } };
    }
    if (word === "weekday") return { due: toISODate(now), recurrence: { freq: "weekly", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"] } };
    const freq = (word.startsWith("day") ? "daily" : word.startsWith("week") ? "weekly" : word.startsWith("month") ? "monthly" : "yearly") as NonNullable<Recurrence>["freq"];
    return { due: toISODate(now), recurrence: { freq, interval } };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return { due: t.slice(0, 10), recurrence: null };
  if (t === "today") return { due: toISODate(now), recurrence: null };
  if (t === "tomorrow") { const d = new Date(now); d.setDate(d.getDate() + 1); return { due: toISODate(d), recurrence: null }; }
  const parsed = Date.parse(s);
  return { due: Number.isNaN(parsed) ? null : toISODate(new Date(parsed)), recurrence: null };
}

/** One project per file; sections become tags; @labels become tags; indented tasks become subtasks. */
export async function importTodoist(workspaceId: ID, name: string, text: string): Promise<ImportReport> {
  const report: ImportReport = { pages: 0, databases: 0, skipped: [], notes: [] };
  const rows = parseCSV(text.replace(/^﻿/, ""));
  const head = rows[0]!.map((h) => h.trim().toUpperCase());
  const col = (r: string[], k: string) => r[head.indexOf(k)] ?? "";
  const project = await repo.createProject(workspaceId, { name: name.replace(/\.csv$/i, "") || "Todoist", status: "active" });
  let section = "";
  const parents: ID[] = []; // by indent level
  let tasks = 0;
  for (const r of rows.slice(1)) {
    const type = col(r, "TYPE").trim().toLowerCase();
    if (type === "section") { section = col(r, "CONTENT").trim(); continue; }
    if (type === "note") {
      const last = parents[parents.length - 1];
      if (last) { const t = await (await import("./db")).db().tasks.get(last); if (t) await repo.updateTask(last, { description: [t.description, col(r, "CONTENT")].filter(Boolean).join("\n\n") }); }
      continue;
    }
    if (type !== "task") continue;
    const raw = col(r, "CONTENT");
    const labels = [...raw.matchAll(/(?:^|\s)@([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]!.toLowerCase());
    const title = raw.replace(/(?:^|\s)@[\p{L}\p{N}_-]+/gu, "").trim() || "Untitled task";
    const indent = Math.max(1, Number(col(r, "INDENT")) || 1);
    const { due, recurrence } = todoistDate(col(r, "DATE"));
    const t = await repo.createTask(workspaceId, {
      title, description: col(r, "DESCRIPTION"), projectId: project.id, parentTaskId: indent > 1 ? parents[indent - 2] ?? null : null,
      priority: TODOIST_PRIORITY[col(r, "PRIORITY").trim()] ?? "none", dueDate: due, recurrence,
      tags: [...new Set([...labels, ...(section ? [section.toLowerCase().replace(/\s+/g, "-")] : [])])],
    });
    parents.length = indent - 1;
    parents[indent - 1] = t.id;
    tasks++;
  }
  report.notes.push(`Imported ${tasks} tasks into the project “${project.name}”.`);
  return report;
}
