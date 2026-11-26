/** Node views for synced blocks and button blocks. */
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, NodeViewWrapper, useEditor, type ReactNodeViewProps } from "@tiptap/react";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, Link2Off, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { JSONContent } from "@/data/types";
import { useApp } from "@/store/app";
import { cx, debounce, toISODate, uid } from "@/lib/util";
import { schemaExtensions } from "./schema";
import { BUILT_IN_TEMPLATES } from "@/data/templates";
import { markdownToDoc } from "@/data/portability";

// ---- Synced block --------------------------------------------------------------------
export function SyncedBlockView({ node, editor, getPos, selected }: ReactNodeViewProps) {
  const id = node.attrs.syncId as string | null;
  const row = useLiveQuery(() => (id ? db().syncedBlocks.get(id) : undefined), [id], null);
  const me = useMemo(() => uid(), []);
  const loaded = useRef(false);
  const save = useMemo(() => debounce((content: JSONContent) => { if (id) void repo.saveSyncedBlock(id, content, me); }, 250), [id, me]);
  const inner = useEditor({
    extensions: schemaExtensions().filter((e) => e.name !== "syncedBlock"),
    editable: editor.isEditable,
    editorProps: { attributes: { class: "rea-editor synced-inner", "aria-label": "Synced block content" } },
    onUpdate: ({ editor: e }) => { if (loaded.current) save(e.getJSON() as JSONContent); },
  }, [id]);

  // Show the stored content; apply other copies' edits unless this copy is the one being typed in.
  useEffect(() => {
    if (!inner || !row) return;
    if (loaded.current && (row.editedBy === me || inner.isFocused)) return;
    inner.commands.setContent(row.content, { emitUpdate: false });
    loaded.current = true;
  }, [inner, row, me]);
  useEffect(() => { inner?.setEditable(editor.isEditable); }, [inner, editor.isEditable]);

  const replaceWith = (content: JSONContent[] | null) => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos === undefined) return;
    const range = { from: pos, to: pos + node.nodeSize };
    if (content?.length) editor.chain().focus().insertContentAt(range, content).run();
    else editor.chain().focus().deleteRange(range).run();
  };

  if (row === null) return <NodeViewWrapper className="my-2 h-10" />; // loading
  if (!row) {
    return (
      <NodeViewWrapper className="my-2 flex items-center justify-between rounded-md border border-dashed border-line px-3 py-2 text-[13px] text-muted" data-testid="synced-missing">
        This synced block was deleted.
        {editor.isEditable && <button className="btn h-7" onClick={() => replaceWith(null)}><Trash2 size={14} /> Remove</button>}
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className={cx("synced-block group/synced relative my-2 rounded-md border border-accent/30 px-3 py-1", selected && "ring-2 ring-accent")} data-sync-id={id}>
      <div contentEditable={false} className="absolute -top-2.5 right-2 flex items-center gap-1 rounded bg-surface px-1 text-[11px] text-accent opacity-70 group-hover/synced:opacity-100">
        <RefreshCw size={11} /> Synced
        {editor.isEditable && <>
          <button className="rounded p-0.5 hover:bg-hover" title="Copy this synced block (paste it on any page)" aria-label="Copy synced block"
            onClick={async () => {
              await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([`<div data-synced="${id}"></div>`], { type: "text/html" }), "text/plain": new Blob([row.text], { type: "text/plain" }) })]);
              useApp.getState().toast("Synced block copied. Paste it on any page.", "success");
            }}><Copy size={12} /></button>
          <button className="rounded p-0.5 hover:bg-hover" title="Unsync: keep a normal copy of the content here" aria-label="Unsync"
            onClick={() => replaceWith((row.content.content ?? []) as JSONContent[])}><Link2Off size={12} /></button>
        </>}
      </div>
      <EditorContent editor={inner} />
    </NodeViewWrapper>
  );
}

// ---- Button block --------------------------------------------------------------------
export type ButtonAction = "checklist" | "task" | "page" | "template";
const ACTION_LABEL: Record<ButtonAction, string> = { checklist: "Add a checklist item below", task: "Create a task", page: "Open a page", template: "Insert a template below" };

export function ButtonBlockView({ node, editor, getPos, updateAttributes, selected }: ReactNodeViewProps) {
  const { label, action, value, due } = node.attrs as { label: string; action: ButtonAction; value: string; due: "" | "today" | "tomorrow" };
  const [editing, setEditing] = useState(!value && editor.isEditable);
  const ws = useApp((s) => s.workspaceId);
  const pages = useLiveQuery(() => (ws && editing && action === "page" ? db().pages.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray() : []), [ws, editing, action], []);
  const templates = useLiveQuery(() => (editing && action === "template" ? db().templates.filter((t) => t.builtIn || t.workspaceId === ws).toArray() : []), [ws, editing, action], []);

  const after = () => { const p = typeof getPos === "function" ? getPos() : undefined; return p === undefined ? undefined : p + node.nodeSize; };
  const run = async () => {
    const toast = useApp.getState().toast;
    if (!value) { setEditing(true); return; }
    try {
      if (action === "checklist") {
        const at = after();
        if (at !== undefined) editor.chain().insertContentAt(at, { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] }] }).run();
      } else if (action === "task") {
        if (!ws) return;
        const d = new Date(); if (due === "tomorrow") d.setDate(d.getDate() + 1);
        await repo.createTask(ws, { title: value, dueDate: due ? toISODate(d) : null });
        toast(`Task created: ${value}`, "success");
      } else if (action === "page") {
        const p = await db().pages.get(value);
        if (!p || p.deletedAt) return toast("That page no longer exists", "error");
        useApp.getState().open({ kind: "page", id: p.id });
      } else if (action === "template") {
        const builtIn = BUILT_IN_TEMPLATES.find((t) => `builtin:${t.id}` === value);
        const content = builtIn ? markdownToDoc(builtIn.markdown) : (await db().templates.get(value))?.content;
        const at = after();
        if (!content) return toast("That template no longer exists", "error");
        if (at !== undefined) editor.chain().insertContentAt(at, (content.content ?? []) as JSONContent[]).run();
      }
    } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <NodeViewWrapper className={cx("my-2", selected && "rounded-md ring-2 ring-accent")} data-button-block="">
      <div contentEditable={false} className="flex items-center gap-1">
        <button className="btn-primary h-8" onClick={() => void run()} title={ACTION_LABEL[action]}>{label || "Button"}</button>
        {editor.isEditable && <button className="btn h-8 px-2" aria-label="Edit button" title="Edit button" onClick={() => setEditing((v) => !v)}><Settings2 size={14} /></button>}
      </div>
      {editing && editor.isEditable && (
        <div contentEditable={false} className="panel mt-2 grid max-w-md gap-2 p-3 text-[13px]" data-testid="button-editor">
          <label className="grid gap-1">Label<input className="input" aria-label="Button label" defaultValue={label} onBlur={(e) => updateAttributes({ label: e.target.value })} /></label>
          <label className="grid gap-1">When clicked
            <select className="input" aria-label="Button action" value={action} onChange={(e) => updateAttributes({ action: e.target.value, value: "" })}>
              {(Object.keys(ACTION_LABEL) as ButtonAction[]).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
            </select>
          </label>
          {(action === "checklist" || action === "task") && (
            <label className="grid gap-1">{action === "task" ? "Task title" : "Item text"}<input className="input" aria-label="Button text" defaultValue={value} onBlur={(e) => updateAttributes({ value: e.target.value.trim() })} /></label>
          )}
          {action === "task" && (
            <label className="grid gap-1">Due<select className="input" aria-label="Task due" value={due} onChange={(e) => updateAttributes({ due: e.target.value })}><option value="">No date</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option></select></label>
          )}
          {action === "page" && (
            <label className="grid gap-1">Page<select className="input" aria-label="Button page" value={value} onChange={(e) => updateAttributes({ value: e.target.value })}><option value="">Choose…</option>{pages.map((p) => <option key={p.id} value={p.id}>{p.title || "Untitled"}</option>)}</select></label>
          )}
          {action === "template" && (
            <label className="grid gap-1">Template<select className="input" aria-label="Button template" value={value} onChange={(e) => updateAttributes({ value: e.target.value })}><option value="">Choose…</option>{BUILT_IN_TEMPLATES.map((t) => <option key={t.id} value={`builtin:${t.id}`}>{t.icon} {t.name}</option>)}{templates.filter((t) => !t.builtIn).map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}</select></label>
          )}
          <div className="flex justify-end"><button className="btn-outline h-7" onClick={() => setEditing(false)}>Done</button></div>
        </div>
      )}
    </NodeViewWrapper>
  );
}
