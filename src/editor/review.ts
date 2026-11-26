/**
 * Review tools for the editor: comment marks anchored to text, and suggestion mode (tracked insertions and
 * deletions that can be accepted or rejected one by one or all at once).
 */
import { Extension, Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { JSONContent } from "@/data/types";
import { uid } from "@/lib/util";

/** Editors that are on screen, by page id, so panels can act on the live document. */
export const liveEditors = new Map<string, Editor>();

// ---- Comments -------------------------------------------------------------------------
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",
  addAttributes() { return { threadId: { default: null, parseHTML: (el) => el.getAttribute("data-comment"), renderHTML: (a) => ({ "data-comment": a.threadId }) } }; },
  parseHTML() { return [{ tag: "span[data-comment]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "comment-mark" }), 0]; },
});

export function removeCommentMarks(editor: Editor, threadId: string) {
  const type = editor.schema.marks.comment;
  if (!type) return;
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) if (m.type === type && m.attrs.threadId === threadId) tr.removeMark(pos, pos + node.nodeSize, m);
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

let pendingThread: string | null = null;
/** Opens a thread in the comments panel, including when the panel is not mounted yet. */
export function requestThreadFocus(threadId: string) {
  pendingThread = threadId;
  window.dispatchEvent(new CustomEvent("cairn:focus-thread", { detail: threadId }));
}
export function takePendingThread(): string | null { const t = pendingThread; pendingThread = null; return t; }

export function scrollToThread(threadId: string) {
  const el = document.querySelector(`span[data-comment="${CSS.escape(threadId)}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.classList.add("comment-flash");
  setTimeout(() => el?.classList.remove("comment-flash"), 1200);
}

// ---- Suggestions ------------------------------------------------------------------------
export const InsertionMark = Mark.create({
  name: "insertion",
  inclusive: true,
  excludes: "deletion",
  addAttributes() { return { id: { default: null }, author: { default: "You" }, at: { default: 0 } }; },
  parseHTML() { return [{ tag: "ins[data-suggestion]" }]; },
  renderHTML({ HTMLAttributes }) { return ["ins", mergeAttributes(HTMLAttributes, { "data-suggestion": HTMLAttributes.id, class: "sugg-ins", title: "Suggested addition" }), 0]; },
});

export const DeletionMark = Mark.create({
  name: "deletion",
  inclusive: false,
  excludes: "insertion",
  addAttributes() { return { id: { default: null }, author: { default: "You" }, at: { default: 0 } }; },
  parseHTML() { return [{ tag: "del[data-suggestion]" }]; },
  renderHTML({ HTMLAttributes }) { return ["del", mergeAttributes(HTMLAttributes, { "data-suggestion": HTMLAttributes.id, class: "sugg-del", title: "Suggested deletion" }), 0]; },
});

const isMark = (name: string) => (m: { type: { name: string } }) => m.type.name === name;

/** Marks [from, to) as deleted; text that is itself a pending insertion is removed outright. */
function suggestDelete(tr: Transaction, state: EditorState, from: number, to: number, author: string) {
  const segs: { a: number; b: number; ins: boolean }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
    if (a < b) segs.push({ a, b, ins: node.marks.some(isMark("insertion")) });
  });
  const $before = tr.doc.resolve(from);
  const near = ($before.nodeBefore?.marks ?? []).find(isMark("deletion")) ?? (tr.doc.resolve(to).nodeAfter?.marks ?? []).find(isMark("deletion"));
  const mark = near ?? state.schema.marks.deletion!.create({ id: uid(), author, at: Date.now() }); // continue an adjacent deletion
  for (const s of segs.reverse()) {
    if (s.ins) tr.delete(s.a, s.b);
    else tr.addMark(s.a, s.b, mark);
  }
}

function suggestInsert(view: EditorView, from: number, to: number, text: string, author: string): boolean {
  const { state } = view;
  const tr = state.tr;
  let at = to;
  if (from < to) { suggestDelete(tr, state, from, to, author); at = tr.mapping.map(to); }
  const $at = tr.doc.resolve(at);
  const prev = ($at.nodeBefore?.marks ?? []).find(isMark("insertion"));
  const base = (state.storedMarks ?? $at.marks()).filter((m) => m.type.name !== "deletion" && m.type.name !== "insertion");
  const mark = prev ?? state.schema.marks.insertion!.create({ id: uid(), author, at: Date.now() }); // keep typing into one suggestion
  tr.insert(at, state.schema.text(text, [...base, mark]));
  tr.setSelection(TextSelection.create(tr.doc, at + text.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const SuggestionMode = Extension.create<object, { enabled: boolean; author: string }>({
  name: "suggestionMode",
  addStorage() { return { enabled: false, author: "You" }; },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [new Plugin({
      key: new PluginKey("suggestionMode"),
      props: {
        handleTextInput(view, from, to, text) {
          if (!storage.enabled) return false;
          return suggestInsert(view, from, to, text, storage.author);
        },
        handlePaste(view, event) {
          if (!storage.enabled) return false;
          const text = event.clipboardData?.getData("text/plain");
          if (!text) return false;
          const { from, to } = view.state.selection;
          return suggestInsert(view, from, to, text.replace(/\r?\n+/g, " "), storage.author);
        },
        handleDOMEvents: {
          cut(view, event) {
            if (!storage.enabled) return false;
            const { from, to, empty } = view.state.selection;
            if (empty) return false;
            event.clipboardData?.setData("text/plain", view.state.doc.textBetween(from, to, "\n"));
            event.preventDefault();
            const tr = view.state.tr;
            suggestDelete(tr, view.state, from, to, storage.author);
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from))));
            return true;
          },
        },
        handleKeyDown(view, event) {
          if (!storage.enabled || (event.key !== "Backspace" && event.key !== "Delete") || event.altKey || event.metaKey) return false;
          const { state } = view;
          const sel = state.selection;
          if (!(sel instanceof TextSelection)) return false;
          const back = event.key === "Backspace";
          const tr = state.tr;
          if (sel.empty) {
            const $p = sel.$from;
            const node = back ? $p.nodeBefore : $p.nodeAfter;
            if (!node?.isText) return false; // block joins stay structural
            if (node.marks.some(isMark("insertion"))) return false; // deleting your own suggestion really deletes it
            const pos = sel.from;
            if (node.marks.some(isMark("deletion"))) { view.dispatch(tr.setSelection(TextSelection.create(state.doc, back ? pos - 1 : pos + 1))); return true; }
            const [a, b] = back ? [pos - 1, pos] : [pos, pos + 1];
            suggestDelete(tr, state, a, b, storage.author);
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, back ? tr.mapping.map(a) : tr.mapping.map(b))));
            return true;
          }
          suggestDelete(tr, state, sel.from, sel.to, storage.author);
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(back ? sel.from : sel.to))));
          return true;
        },
      },
    })];
  },
});

export interface SuggestionItem { id: string; kind: "insertion" | "deletion"; text: string; author: string; at: number }

/** Pending suggestions in document order (from stored JSON), with consecutive pieces of one suggestion joined. */
export function suggestionsIn(doc: JSONContent | null | undefined): SuggestionItem[] {
  const out: SuggestionItem[] = [];
  const byId = new Map<string, SuggestionItem>();
  const visit = (n: JSONContent) => {
    if (n.type === "text") {
      for (const m of n.marks ?? []) {
        if (m.type !== "insertion" && m.type !== "deletion") continue;
        const id = String(m.attrs?.id ?? "");
        const key = `${m.type}:${id}`;
        const it = byId.get(key);
        if (it) it.text += n.text ?? "";
        else { const x: SuggestionItem = { id, kind: m.type, text: n.text ?? "", author: String(m.attrs?.author ?? "You"), at: Number(m.attrs?.at ?? 0) }; byId.set(key, x); out.push(x); }
      }
    }
    for (const c of n.content ?? []) visit(c);
  };
  if (doc) visit(doc);
  return out;
}

/** Accepts or rejects one suggestion (by id) or, with id null, all of them. */
export function resolveSuggestions(editor: Editor, id: string | null, accept: boolean) {
  const { state } = editor;
  const ins = state.schema.marks.insertion!, del = state.schema.marks.deletion!;
  const segs: { a: number; b: number; kind: "insertion" | "deletion" }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if ((m.type === ins || m.type === del) && (id === null || m.attrs.id === id)) segs.push({ a: pos, b: pos + node.nodeSize, kind: m.type === ins ? "insertion" : "deletion" });
    }
  });
  if (!segs.length) return;
  const tr = state.tr;
  for (const s of segs.reverse()) {
    const removeText = (s.kind === "insertion") !== accept; // reject an insertion, or accept a deletion
    if (removeText) tr.delete(s.a, s.b);
    else tr.removeMark(s.a, s.b, s.kind === "insertion" ? ins : del);
  }
  editor.view.dispatch(tr);
}
