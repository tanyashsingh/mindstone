import type { Editor, Range } from "@tiptap/core";
import type { SlashItem } from "./extensions";
import type { Page } from "@/data/types";
import * as repo from "@/data/repo";
import { useApp } from "@/store/app";
import { chooseDialog, promptDialog } from "@/components/ui";
import { db } from "@/data/db";
import { today } from "@/lib/util";

function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

async function insertUpload(editor: Editor, range: Range, page: Page, accept: string) {
  editor.chain().focus().deleteRange(range).run();
  for (const f of await pickFiles(accept)) {
    try {
      const a = await repo.addAttachment(page.workspaceId, page.id, f);
      editor.chain().focus().insertContent({ type: "attachment", attrs: { attachmentId: a.id, name: a.name, mime: a.mime } }).run();
    } catch (e) {
      useApp.getState().toast(e instanceof Error ? e.message : String(e), "error");
    }
  }
}

export function slashItems(page: Page): SlashItem[] {
  const c = (e: Editor, r: Range) => e.chain().focus().deleteRange(r);
  const items: SlashItem[] = [
    { group: "Basic", title: "Text", hint: "Plain paragraph", keywords: "paragraph p", run: (e, r) => c(e, r).setParagraph().run() },
    ...[1, 2, 3, 4, 5, 6].map((l) => ({ group: "Basic", title: `Heading ${l}`, hint: "#".repeat(l) + " ", keywords: `h${l} title`, run: (e: Editor, r: Range) => c(e, r).setHeading({ level: l as 1 }).run() })),
    { group: "Basic", title: "Bulleted list", hint: "- ", keywords: "ul unordered bullet", run: (e, r) => c(e, r).toggleBulletList().run() },
    { group: "Basic", title: "Numbered list", hint: "1. ", keywords: "ol ordered number", run: (e, r) => c(e, r).toggleOrderedList().run() },
    { group: "Basic", title: "Checklist", hint: "[ ] ", keywords: "todo task check", run: (e, r) => c(e, r).toggleTaskList().run() },
    { group: "Basic", title: "Toggle list", hint: "Collapsible section", keywords: "toggle details collapse", run: (e, r) => c(e, r).setDetails().run() },
    { group: "Basic", title: "Quote", hint: "> ", keywords: "blockquote", run: (e, r) => c(e, r).toggleBlockquote().run() },
    { group: "Basic", title: "Callout", hint: "Highlighted note", keywords: "callout info note tip warning", run: (e, r) => c(e, r).insertContent({ type: "callout", attrs: { variant: "note" }, content: [{ type: "paragraph" }] }).run() },
    { group: "Basic", title: "Divider", hint: "---", keywords: "hr rule separator", run: (e, r) => c(e, r).setHorizontalRule().run() },
    { group: "Basic", title: "Code block", hint: "``` ", keywords: "code snippet pre", run: (e, r) => c(e, r).setCodeBlock().run() },
    { group: "Basic", title: "Table", hint: "3 × 3 grid", keywords: "table grid", run: (e, r) => c(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    ...[2, 3, 4].map((n) => ({ group: "Layout", title: `${n} columns`, hint: "Side by side", keywords: `columns column layout side grid ${n}`,
      run: (e: Editor, r: Range) => {
        c(e, r).insertContent({ type: "columns", content: Array.from({ length: n }, () => ({ type: "column", content: [{ type: "paragraph" }] })) }).run();
        const $f = e.state.selection.$from; // put the caret in the first column
        for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === "columns") { e.commands.setTextSelection($f.start(d) + 2); break; }
      } })),
    {
      group: "Layout", title: "Synced block", hint: "Same content on many pages", keywords: "synced sync shared reuse mirror transclusion",
      run: async (e, r) => {
        c(e, r).run();
        const s = await repo.createSyncedBlock(page.workspaceId, page.id);
        e.chain().focus().insertContent({ type: "syncedBlock", attrs: { syncId: s.id } }).run();
      },
    },
    {
      group: "Layout", title: "Insert synced block", hint: "Reuse an existing one", keywords: "synced sync shared reuse paste existing",
      run: async (e, r) => {
        c(e, r).run();
        const rows = await db().syncedBlocks.where("workspaceId").equals(page.workspaceId).reverse().sortBy("updatedAt");
        const titles = new Map((await db().pages.bulkGet(rows.map((x) => x.sourcePageId))).filter(Boolean).map((p) => [p!.id, p!.title || "Untitled"]));
        const id = await chooseDialog("Insert synced block", rows.map((x) => ({ value: x.id, label: x.text.trim().slice(0, 80) || "(empty)", hint: `From ${titles.get(x.sourcePageId) ?? "a deleted page"}` })));
        if (id) e.chain().focus().insertContent({ type: "syncedBlock", attrs: { syncId: id } }).run();
      },
    },
    { group: "Layout", title: "Button", hint: "Runs an action when clicked", keywords: "button action automation click", run: (e, r) => c(e, r).insertContent({ type: "buttonBlock", attrs: { label: "Add item", action: "checklist", value: "" } }).run() },
    { group: "Advanced", title: "Math equation", hint: "LaTeX", keywords: "math latex equation katex", run: (e, r) => c(e, r).insertContent({ type: "mathBlock" }).run() },
    { group: "Advanced", title: "Mermaid diagram", hint: "Flowchart, sequence…", keywords: "mermaid diagram chart flow", run: (e, r) => c(e, r).insertContent({ type: "mermaid" }).run() },
    { group: "Advanced", title: "Table of contents", hint: "From headings", keywords: "toc contents outline", run: (e, r) => c(e, r).insertContent({ type: "toc" }).run() },
    { group: "Voice", title: "Voice note", hint: "Record and transcribe", keywords: "voice audio record recording memo transcribe transcript", run: (e, r) => c(e, r).insertContent({ type: "voiceNote", attrs: { title: "Voice note" } }).run() },
    { group: "Voice", title: "Meeting notes", hint: "Record a meeting, then summarize", keywords: "meeting call record transcript summary minutes", run: (e, r) => c(e, r).insertContent({ type: "voiceNote", attrs: { title: "Meeting notes" } }).run() },
    { group: "Voice", title: "Dictate", hint: "Ctrl+Shift+M", keywords: "dictate dictation speak speech voice type", run: (e, r) => { c(e, r).run(); window.dispatchEvent(new CustomEvent("cairn:dictate")); } },
    { group: "Media", title: "Image", hint: "Upload", keywords: "image picture photo", run: (e, r) => void insertUpload(e, r, page, "image/*") },
    { group: "Media", title: "Video", hint: "Upload", keywords: "video movie", run: (e, r) => void insertUpload(e, r, page, "video/*") },
    { group: "Media", title: "Audio", hint: "Upload", keywords: "audio sound music", run: (e, r) => void insertUpload(e, r, page, "audio/*") },
    { group: "Media", title: "File", hint: "Attach any file", keywords: "file attachment pdf upload", run: (e, r) => void insertUpload(e, r, page, "*/*") },
    {
      group: "Media", title: "Bookmark", hint: "Link card", keywords: "bookmark url web link embed",
      run: async (e, r) => {
        c(e, r).run();
        const url = await promptDialog("Bookmark URL", "https://");
        if (url && /^https?:\/\//i.test(url)) e.chain().focus().insertContent({ type: "bookmark", attrs: { url } }).run();
      },
    },
    {
      group: "Pages", title: "Sub-page", hint: "Nested page", keywords: "page subpage child new",
      run: async (e, r) => {
        c(e, r).run();
        const p = await repo.createPage(page.workspaceId, page.id);
        e.chain().focus().insertContent({ type: "pageEmbed", attrs: { pageId: p.id } }).run();
        useApp.getState().open({ kind: "page", id: p.id });
      },
    },
    { group: "Pages", title: "Link to page", hint: "[[", keywords: "link mention wiki", run: (e, r) => c(e, r).insertContent("[[").run() },
    {
      group: "Pages", title: "Database", hint: "Inline linked database", keywords: "database table board kanban collection",
      run: async (e, r) => {
        c(e, r).run();
        const { page: dbPage } = await repo.createDatabase(page.workspaceId, page.id);
        e.chain().focus().insertContent({ type: "pageEmbed", attrs: { pageId: dbPage.id } }).run();
      },
    },
    { group: "Inline", title: "Date", hint: "Today's date", keywords: "date today now", run: (e, r) => c(e, r).insertContent(new Date().toLocaleDateString(undefined, { dateStyle: "long" }) + " ").run() },
    {
      group: "Inline", title: "Reminder", hint: "Creates a task with a reminder", keywords: "reminder remind alarm task",
      run: async (e, r) => {
        c(e, r).run();
        const when = await promptDialog("Remind me at", `${today()} 09:00`, "Format: YYYY-MM-DD HH:MM");
        if (!when) return;
        const at = new Date(when.replace(" ", "T")).getTime();
        if (Number.isNaN(at)) return useApp.getState().toast("Couldn't read that date", "error");
        const title = `Follow up: ${page.title || "Untitled"}`;
        await repo.createTask(page.workspaceId, { title, reminderAt: at, dueDate: when.slice(0, 10), description: `From page ${page.title}` });
        e.chain().focus().insertContent(`⏰ ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} `).run();
        useApp.getState().toast("Reminder task created", "success");
      },
    },
  ];
  return items;
}
