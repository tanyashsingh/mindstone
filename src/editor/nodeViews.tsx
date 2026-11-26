import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useLiveQuery } from "dexie-react-hooks";
import katex from "katex";
import DOMPurify from "dompurify";
import { Info, Lightbulb, AlertTriangle, AlertOctagon, FileText, Download, ExternalLink, Link2, Table2, AudioLines, Loader2 } from "lucide-react";
import { transcribeAttachment } from "@/voice/VoiceNoteView";
import { db } from "@/data/db";
import { useApp } from "@/store/app";
import { cx, downloadBlob, fmtBytes } from "@/lib/util";
import { headings } from "@/lib/doc";
import type { JSONContent } from "@/data/types";

const VARIANTS = {
  note: { icon: <Info size={17} />, cls: "bg-sunken border-line" },
  tip: { icon: <Lightbulb size={17} />, cls: "bg-accent-soft border-accent/25" },
  warning: { icon: <AlertTriangle size={17} className="text-warning" />, cls: "bg-warning/10 border-warning/30" },
  danger: { icon: <AlertOctagon size={17} className="text-danger" />, cls: "bg-danger/10 border-danger/30" },
} as const;

export function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const v = VARIANTS[(node.attrs.variant as keyof typeof VARIANTS) ?? "note"] ?? VARIANTS.note;
  const order = Object.keys(VARIANTS) as (keyof typeof VARIANTS)[];
  return (
    <NodeViewWrapper className={cx("my-2 flex gap-3 rounded-lg border px-4 py-3", v.cls)}>
      <button contentEditable={false} className="mt-[3px] h-fit shrink-0 rounded hover:bg-hover" title="Change callout style" disabled={!editor.isEditable}
        onClick={() => updateAttributes({ variant: order[(order.indexOf(node.attrs.variant) + 1) % order.length] })}>{v.icon}</button>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  );
}

function useEditToggle(editable: boolean) {
  const [editing, setEditing] = useState(false);
  return { editing: editing && editable, setEditing };
}

export function MathView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const { editing, setEditing } = useEditToggle(editor.isEditable);
  const html = useMemo(() => {
    try { return { ok: true, html: katex.renderToString(String(node.attrs.latex ?? ""), { displayMode: true, throwOnError: true, trust: false, strict: "ignore" }) }; }
    catch (e) { return { ok: false, html: e instanceof Error ? e.message : "Invalid LaTeX" }; }
  }, [node.attrs.latex]);
  return (
    <NodeViewWrapper className={cx("my-2 rounded-md", selected && "ring-2 ring-accent")}>
      <div contentEditable={false} onDoubleClick={() => setEditing(true)} className="cursor-default overflow-x-auto rounded-md px-2 py-1 hover:bg-hover">
        {html.ok ? <div dangerouslySetInnerHTML={{ __html: html.html }} /> : <div className="text-[13px] text-danger">{html.html}</div>}
      </div>
      {editing && (
        <textarea autoFocus className="textarea mt-1 font-mono" rows={3} defaultValue={node.attrs.latex}
          onBlur={(e) => { updateAttributes({ latex: e.target.value }); setEditing(false); }} onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()} />
      )}
      {!editing && editor.isEditable && <div contentEditable={false} className="text-[11px] text-faint opacity-0 hover:opacity-100">Double-click to edit LaTeX</div>}
    </NodeViewWrapper>
  );
}

let mermaidSeq = 0;
export function MermaidView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const { editing, setEditing } = useEditToggle(editor.isEditable);
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral" });
        const { svg } = await mermaid.render(`rea-mermaid-${++mermaidSeq}`, String(node.attrs.code ?? ""));
        if (alive) { setSvg(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })); setErr(""); }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message.split("\n")[0]! : "Invalid diagram");
      }
    })();
    return () => { alive = false; };
  }, [node.attrs.code]);
  return (
    <NodeViewWrapper className={cx("my-2 rounded-lg border border-line p-3", selected && "ring-2 ring-accent")}>
      <div contentEditable={false} onDoubleClick={() => setEditing(true)} className="flex justify-center overflow-x-auto [&_svg]:max-w-full">
        {err ? <div className="text-[13px] text-danger">Diagram error: {err}</div> : svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="skeleton h-24 w-full" />}
      </div>
      {editing ? (
        <textarea autoFocus className="textarea mt-2 font-mono" rows={6} defaultValue={node.attrs.code}
          onBlur={(e) => { updateAttributes({ code: e.target.value }); setEditing(false); }} />
      ) : editor.isEditable && <div contentEditable={false} className="mt-1 text-center text-[11px] text-faint">Mermaid diagram · double-click to edit</div>}
    </NodeViewWrapper>
  );
}

export function PageEmbedView({ node, selected }: ReactNodeViewProps) {
  const page = useLiveQuery(() => (node.attrs.pageId ? db().pages.get(node.attrs.pageId) : undefined), [node.attrs.pageId]);
  const open = useApp((s) => s.open);
  return (
    <NodeViewWrapper className={cx("my-1", selected && "rounded-md ring-2 ring-accent")} data-drag-handle>
      <button contentEditable={false} onClick={(e) => page && open({ kind: "page", id: page.id }, { newTab: e.ctrlKey })}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-hover">
        <span className="w-5 text-center">{page?.icon || (page?.kind === "database" ? <Table2 size={16} className="inline text-muted" /> : <FileText size={16} className="inline text-muted" />)}</span>
        <span className={cx("border-b border-line-strong font-medium", page?.deletedAt ? "text-faint line-through" : "")}>{page ? page.title || "Untitled" : "Missing page"}</span>
        {page?.deletedAt ? <span className="text-[12px] text-faint">in trash</span> : null}
      </button>
    </NodeViewWrapper>
  );
}

export function TocView({ editor }: ReactNodeViewProps) {
  const [items, setItems] = useState(() => headings(editor.getJSON() as JSONContent));
  useEffect(() => {
    const up = () => setItems(headings(editor.getJSON() as JSONContent));
    editor.on("update", up);
    return () => { editor.off("update", up); };
  }, [editor]);
  return (
    <NodeViewWrapper className="my-2 rounded-lg border border-line px-3 py-2" contentEditable={false}>
      <div className="label mb-1">Contents</div>
      {items.length === 0 && <div className="text-[13px] text-faint">Add headings to build the table of contents.</div>}
      {items.map((h, i) => (
        <button key={h.id || i} className="block w-full truncate rounded px-1 py-0.5 text-left text-[14px] text-muted hover:bg-hover hover:text-fg" style={{ paddingLeft: (h.level - 1) * 14 + 4 }}
          onClick={() => document.querySelector(`[data-id="${CSS.escape(h.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{h.text || "Untitled"}</button>
      ))}
    </NodeViewWrapper>
  );
}

export function AttachmentView({ node, selected, updateAttributes, editor }: ReactNodeViewProps) {
  const att = useLiveQuery(() => (node.attrs.attachmentId ? db().attachments.get(node.attrs.attachmentId) : undefined), [node.attrs.attachmentId]);
  const url = useMemo(() => (att ? URL.createObjectURL(att.blob) : ""), [att]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const wrap = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  if (att === undefined) return <NodeViewWrapper className="my-2"><div className="skeleton h-10" /></NodeViewWrapper>;
  if (!att) return <NodeViewWrapper className="my-2 rounded-md border border-dashed border-line p-3 text-[13px] text-faint">Attachment missing: {node.attrs.name}</NodeViewWrapper>;
  const kind = att.mime.split("/")[0];
  return (
    <NodeViewWrapper className={cx("my-2", selected && "rounded-md ring-2 ring-accent")} data-drag-handle>
      <div ref={wrap} contentEditable={false} className="relative inline-block max-w-full">
        {kind === "image" && (
          <>
            <img src={url} alt={att.name} style={{ width: node.attrs.width ?? undefined }} className="max-w-full rounded-md" />
            {editor.isEditable && (
              <span className="absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-sm border border-white/70 bg-black/40" title="Drag to resize"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX, startW = wrap.current?.getBoundingClientRect().width ?? 300;
                  const move = (ev: MouseEvent) => updateAttributes({ width: Math.max(80, Math.round(startW + ev.clientX - startX)) });
                  const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); };
                  addEventListener("mousemove", move);
                  addEventListener("mouseup", up);
                }} />
            )}
          </>
        )}
        {kind === "video" && <video src={url} controls className="max-w-full rounded-md" />}
        {kind === "audio" && <audio src={url} controls className="w-[min(480px,100%)]" />}
        {(kind === "audio" || kind === "video") && att.textStatus === "ok" && att.text && (
          <details className="mt-1 rounded-[10px] bg-sunken px-3 py-2 text-[13px] shadow-[var(--inset)]"><summary className="cursor-pointer text-muted">Transcript</summary><p className="mt-1 whitespace-pre-wrap">{att.text}</p></details>
        )}
      {kind !== "image" && (
          <div className="mt-1 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px]">
            <FileText size={16} className="text-muted" />
            <span className="flex-1 truncate">{att.name}</span>
            <span className="text-faint">{fmtBytes(att.size)}</span>
            {(kind === "audio" || kind === "video") && att.textStatus !== "ok" && (
              <button className="btn h-6" disabled={busy} title="Transcribe on this computer" onClick={async () => {
                setBusy(true);
                try { await transcribeAttachment(att.id); } catch (e) { useApp.getState().toast(e instanceof Error ? e.message : String(e), "error"); } finally { setBusy(false); }
              }}>{busy ? <Loader2 size={13} className="animate-spin" /> : <AudioLines size={13} />} {busy ? "Transcribing…" : "Transcribe"}</button>
            )}
            <button className="icon-btn size-6" title="Download" onClick={() => downloadBlob(att.blob, att.name)}><Download size={14} /></button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export function BookmarkView({ node, selected }: ReactNodeViewProps) {
  let host = "";
  try { host = new URL(node.attrs.url).hostname; } catch { /* invalid */ }
  const safe = /^https?:\/\//i.test(node.attrs.url);
  return (
    <NodeViewWrapper className={cx("my-2", selected && "rounded-lg ring-2 ring-accent")} contentEditable={false}>
      <a href={safe ? node.attrs.url : undefined} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 no-underline hover:bg-hover">
        <Link2 size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-fg">{node.attrs.title || host || node.attrs.url}</span>
          <span className="block truncate text-[12px] text-faint">{node.attrs.url}</span>
        </span>
        <ExternalLink size={14} className="text-faint" />
      </a>
    </NodeViewWrapper>
  );
}
