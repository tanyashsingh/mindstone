import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor as TEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Placeholder, CharacterCount, Focus } from "@tiptap/extensions";
import {
  Bold, Italic, Underline as UIcon, Strikethrough, Code, Highlighter, Link as LinkIcon, Sparkles, Heading1, Heading2, List, ListChecks, Quote, ChevronDown, Search, X, Replace,
} from "lucide-react";
import { schemaExtensions } from "./schema";
import { SlashCommand, PageLinkSuggest, FindReplace, findKey, type SlashItem, type PageItem, type SuggestState } from "./extensions";
import { BlockCommands } from "./blockCommands";
import { slashItems } from "./slashItems";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { JSONContent, Page } from "@/data/types";
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { cx, debounce, wordCount } from "@/lib/util";
import { promptDialog } from "@/components/ui";
import { AiRewriteDialog } from "@/views/AiRewrite";


function SuggestMenu<T>({ state, render, label }: { state: SuggestState<T> | null; render: (item: T, active: boolean) => React.ReactNode; label: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" }); }, [state?.selected]);
  if (!state || !state.rect) return null;
  const top = Math.min(state.rect.bottom + 6, innerHeight - 330);
  return (
    <div ref={listRef} role="listbox" aria-label={label} className="menu fixed z-50 max-h-[320px] w-[300px] overflow-y-auto anim-in" style={{ left: Math.min(state.rect.left, innerWidth - 310), top }}>
      {state.items.length === 0 && <div className="px-2 py-1.5 text-faint">No results</div>}
      {state.items.map((it, i) => (
        <button key={i} data-active={i === state.selected} role="option" aria-selected={i === state.selected}
          className={cx("menu-item h-auto py-1.5", i === state.selected && "bg-hover")} onMouseDown={(e) => { e.preventDefault(); state.command(it); }}>
          {render(it, i === state.selected)}
        </button>
      ))}
    </div>
  );
}

function FindBar({ editor, onClose, replace }: { editor: TEditor; onClose: () => void; replace: boolean }) {
  const [q, setQ] = useState("");
  const [r, setR] = useState("");
  const [, force] = useState(0);
  const st = findKey.getState(editor.state);
  const set = (meta: { query?: string; active?: number }) => { editor.view.dispatch(editor.state.tr.setMeta(findKey, meta)); force((x) => x + 1); };
  useEffect(() => () => { editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: "" })); }, [editor]);
  const go = (d: 1 | -1) => {
    const s = findKey.getState(editor.state);
    if (!s?.matches.length) return;
    const active = (s.active + d + s.matches.length) % s.matches.length;
    set({ active });
    const m = s.matches[active]!;
    editor.commands.setTextSelection(m);
    editor.view.domAtPos(m.from).node.parentElement?.scrollIntoView({ block: "center" });
  };
  const replaceOne = () => {
    const s = findKey.getState(editor.state);
    const m = s?.matches[s.active];
    if (m) editor.chain().insertContentAt(m, r).run();
    force((x) => x + 1);
  };
  const replaceAll = () => {
    const s = findKey.getState(editor.state);
    if (!s) return;
    const tr = editor.state.tr;
    for (const m of [...s.matches].reverse()) r ? tr.insertText(r, m.from, m.to) : tr.delete(m.from, m.to);
    editor.view.dispatch(tr);
    force((x) => x + 1);
  };
  return (
    <div className="panel sticky top-2 z-20 ml-auto flex w-fit flex-col gap-1.5 p-1.5 shadow-[var(--shadow)]">
      <div className="flex items-center gap-1">
        <Search size={14} className="ml-1 text-faint" />
        <input autoFocus className="input h-7 w-48" placeholder="Find in page" value={q} onChange={(e) => { setQ(e.target.value); set({ query: e.target.value, active: 0 }); }}
          onKeyDown={(e) => { if (e.key === "Enter") go(e.shiftKey ? -1 : 1); if (e.key === "Escape") onClose(); }} />
        <span className="w-14 text-center text-[12px] text-faint">{st?.matches.length ? `${st.active + 1}/${st.matches.length}` : "0/0"}</span>
        <button className="icon-btn" aria-label="Previous" onClick={() => go(-1)}>↑</button>
        <button className="icon-btn" aria-label="Next" onClick={() => go(1)}>↓</button>
        <button className="icon-btn" aria-label="Close find" onClick={onClose}><X size={14} /></button>
      </div>
      {replace && (
        <div className="flex items-center gap-1">
          <Replace size={14} className="ml-1 text-faint" />
          <input className="input h-7 w-48" placeholder="Replace with" value={r} onChange={(e) => setR(e.target.value)} />
          <button className="btn h-7" onClick={replaceOne}>Replace</button>
          <button className="btn h-7" onClick={replaceAll}>All</button>
        </div>
      )}
    </div>
  );
}

export function Editor({ page, editable }: { page: Page; editable: boolean }) {
  const settings = useSettings((x) => x.s);
  const [slash, setSlash] = useState<SuggestState<SlashItem> | null>(null);
  const [links, setLinks] = useState<SuggestState<PageItem> | null>(null);
  const [find, setFind] = useState<null | "find" | "replace">(null);
  const [aiOpen, setAiOpen] = useState(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  const listeners = useRef({ slash: setSlash, links: setLinks });

  const save = useMemo(
    () => debounce(async (id: string, json: JSONContent) => {
      try {
        useApp.getState().set("saveState", "saving");
        await repo.savePageContent(id, json);
        localStorage.removeItem(`rea.draft.${id}`);
        useApp.getState().set("saveState", "saved");
      } catch (e) {
        console.error(e);
        useApp.getState().set("saveState", "error");
      }
    }, settings.autosaveMs),
    [settings.autosaveMs],
  );

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      ...schemaExtensions(),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Write, or press / for blocks, [[ to link a page"), includeChildren: false }),
      CharacterCount,
      Focus.configure({ className: "has-focus", mode: "shallowest" }),
      BlockCommands,
      FindReplace,
      SlashCommand(() => slashItems(pageRef.current), () => listeners.current.slash as never),
      PageLinkSuggest(
        async (q) => {
          const all = await repo.livePages(pageRef.current.workspaceId);
          const n = q.toLowerCase();
          return all.filter((p) => p.id !== pageRef.current.id && (!n || p.title.toLowerCase().includes(n))).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 8).map((p) => ({ id: p.id, title: p.title || "Untitled", icon: p.icon }));
        },
        async (title) => {
          const p = await repo.createPage(pageRef.current.workspaceId, pageRef.current.id, { title });
          return { id: p.id, title, icon: "" };
        },
        () => listeners.current.links as never,
      ),
    ],
    content: page.content ?? undefined,
    editorProps: {
      attributes: { class: "rea-editor", spellcheck: String(settings.spellcheck), "aria-label": "Page content" },
      handleClickOn: (_view, _pos, node, _np, event) => {
        if (node.type.name === "pageMention" && node.attrs.pageId) {
          useApp.getState().open({ kind: "page", id: node.attrs.pageId }, { newTab: event.ctrlKey });
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length || !view.editable) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertFiles([...files], pos);
        return true;
      },
      handlePaste: (view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length || !view.editable) return false;
        event.preventDefault();
        void insertFiles([...files]);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as JSONContent;
      localStorage.setItem(`rea.draft.${pageRef.current.id}`, JSON.stringify({ at: Date.now(), json }));
      useApp.getState().set("saveState", "unsaved");
      useApp.getState().set("stats", { words: wordCount(editor.getText()), chars: editor.storage.characterCount.characters() });
      save(pageRef.current.id, json);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      useApp.getState().set("selectedText", from === to ? "" : editor.state.doc.textBetween(from, to, "\n"));
    },
  }, [page.id]);

  async function insertFiles(files: File[], pos?: number) {
    for (const f of files) {
      try {
        const a = await repo.addAttachment(pageRef.current.workspaceId, pageRef.current.id, f);
        const content = { type: "attachment", attrs: { attachmentId: a.id, name: a.name, mime: a.mime } };
        if (pos !== undefined) editor?.chain().focus().insertContentAt(pos, content).run();
        else editor?.chain().focus().insertContent(content).run();
      } catch (e) {
        useApp.getState().toast(e instanceof Error ? e.message : String(e), "error");
      }
    }
  }

  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  // Stats on load, flush pending save on unmount / page change / Ctrl+S
  useEffect(() => {
    if (!editor) return;
    useApp.getState().set("stats", { words: wordCount(editor.getText()), chars: editor.storage.characterCount.characters() });
    const flush = () => save.flush();
    window.addEventListener("rea:save-now", flush);
    window.addEventListener("beforeunload", flush);
    return () => { save.flush(); window.removeEventListener("rea:save-now", flush); window.removeEventListener("beforeunload", flush); useApp.getState().set("stats", null); };
  }, [editor, save]);

  // Crash recovery: an unsaved local draft newer than the stored page
  useEffect(() => {
    if (!editor) return;
    const raw = localStorage.getItem(`rea.draft.${page.id}`);
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as { at: number; json: JSONContent };
      const same = JSON.stringify(d.json) === JSON.stringify(editor.getJSON()) || JSON.stringify(d.json) === JSON.stringify(page.content);
      if (!same && d.at > page.updatedAt + 1000) {
        useApp.getState().toast("Recovered unsaved changes from your last session", "info", { label: "Restore", run: () => { editor.commands.setContent(d.json); void repo.savePageContent(page.id, d.json); } });
      } else localStorage.removeItem(`rea.draft.${page.id}`);
    } catch { localStorage.removeItem(`rea.draft.${page.id}`); }
  }, [editor, page.id, page.updatedAt]);

  // Content changed elsewhere (revision restore, AI apply, import): reload if not focused
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = JSON.stringify(editor.getJSON());
    const stored = JSON.stringify(page.content);
    if (page.content && current !== stored && useApp.getState().saveState === "saved") editor.commands.setContent(page.content, { emitUpdate: false });
  }, [editor, page.content]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editor?.isFocused && !find) return;
      if (e.ctrlKey && e.key.toLowerCase() === "f" && !e.shiftKey) { e.preventDefault(); setFind("find"); }
      if (e.ctrlKey && e.key.toLowerCase() === "h") { e.preventDefault(); setFind("replace"); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [editor, find]);

  if (!editor) return <div className="skeleton h-40" />;

  const Btn = ({ on, active, label, children }: { on: () => void; active?: boolean; label: string; children: React.ReactNode }) => (
    <button className={cx("icon-btn size-7", active && "bg-active text-fg")} title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={on}>{children}</button>
  );

  return (
    <div className="relative">
      {find && <FindBar editor={editor} replace={find === "replace"} onClose={() => { setFind(null); editor.commands.focus(); }} />}
      <BubbleMenu editor={editor} options={{ placement: "top" }} shouldShow={({ editor: ed, from, to }) => ed.isEditable && from !== to && !ed.isActive("codeBlock") && !ed.isActive("attachment")}>
        <div className="menu flex items-center gap-0.5 p-1">
          <button className="btn h-7 text-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => setAiOpen(true)}><Sparkles size={14} /> Ask AI</button>
          <span className="mx-0.5 h-5 w-px bg-line" />
          <Btn label="Heading 1" on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })}><Heading1 size={15} /></Btn>
          <Btn label="Heading 2" on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}><Heading2 size={15} /></Btn>
          <Btn label="Bulleted list" on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}><List size={15} /></Btn>
          <Btn label="Checklist" on={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")}><ListChecks size={15} /></Btn>
          <Btn label="Quote" on={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}><Quote size={15} /></Btn>
          <span className="mx-0.5 h-5 w-px bg-line" />
          <Btn label="Bold (Ctrl+B)" on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}><Bold size={15} /></Btn>
          <Btn label="Italic (Ctrl+I)" on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}><Italic size={15} /></Btn>
          <Btn label="Underline (Ctrl+U)" on={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")}><UIcon size={15} /></Btn>
          <Btn label="Strikethrough" on={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}><Strikethrough size={15} /></Btn>
          <Btn label="Inline code" on={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")}><Code size={15} /></Btn>
          <Btn label="Highlight" on={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")}><Highlighter size={15} /></Btn>
          <Btn label="Link" active={editor.isActive("link")} on={async () => {
            const prev = editor.getAttributes("link").href as string | undefined;
            const url = await promptDialog("Link URL", prev ?? "https://");
            if (url === null) return;
            if (!url) editor.chain().focus().unsetLink().run();
            else if (/^(https?:|mailto:)/i.test(url)) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
            else useApp.getState().toast("Only http, https and mailto links are allowed", "error");
          }}><LinkIcon size={15} /></Btn>
          <TurnInto editor={editor} />
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
      <SuggestMenu label="Insert block" state={slash} render={(it) => (
        <span className="flex w-full items-center justify-between gap-3"><span>{it.title}</span><span className="truncate text-[11.5px] text-faint">{it.hint}</span></span>
      )} />
      <SuggestMenu label="Link to page" state={links} render={(it) => (
        <span className="flex items-center gap-2"><span className="w-5 text-center">{it.create ? "+" : it.icon || "📄"}</span><span className="truncate">{it.create ? `Create “${it.title}”` : it.title}</span></span>
      )} />
      {aiOpen && <AiRewriteDialog editor={editor} onClose={() => setAiOpen(false)} />}
      <PageStatsSync editor={editor} pageId={page.id} />
    </div>
  );
}

function TurnInto({ editor }: { editor: TEditor }) {
  const [open, setOpen] = useState(false);
  const opts: [string, () => void][] = [
    ["Text", () => editor.chain().focus().setParagraph().run()],
    ["Heading 3", () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
    ["Numbered list", () => editor.chain().focus().toggleOrderedList().run()],
    ["Code block", () => editor.chain().focus().toggleCodeBlock().run()],
    ["Toggle list", () => editor.chain().focus().setDetails().run()],
  ];
  return (
    <span className="relative">
      <button className="btn h-7" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>Turn into <ChevronDown size={12} /></button>
      {open && (
        <div className="menu absolute right-0 top-8 z-50 w-40">
          {opts.map(([l, f]) => <button key={l} className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { f(); setOpen(false); }}>{l}</button>)}
        </div>
      )}
    </span>
  );
}

/** Keeps the editor's checkbox/task counts available for the outline panel via the DB (no extra state). */
function PageStatsSync({ editor, pageId }: { editor: TEditor; pageId: string }) {
  useEffect(() => { void db().pages.update(pageId, { lastOpenedAt: Date.now() }); }, [pageId]);
  void editor;
  return null;
}
