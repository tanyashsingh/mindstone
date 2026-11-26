import { Extension, Node, mergeAttributes, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { uid } from "@/lib/util";
import { CalloutView, MathView, MermaidView, PageEmbedView, TocView, AttachmentView, BookmarkView } from "./nodeViews";
import { VoiceNoteView } from "@/voice/VoiceNoteView";

const ID_TYPES = ["voiceNote", "paragraph", "heading", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule", "table", "image", "callout", "mathBlock", "mermaid", "pageEmbed", "toc", "attachment", "bookmark", "details"];

/** Gives every block a stable, unique `id` attribute; fixes duplicates created by copy/paste or splits. */
export const BlockId = Extension.create({
  name: "blockId",
  addGlobalAttributes() {
    return [{ types: ID_TYPES, attributes: { id: { default: null, parseHTML: (el) => el.getAttribute("data-id"), renderHTML: (a) => (a.id ? { "data-id": a.id } : {}), keepOnSplit: false } } }];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockId"),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          const seen = new Set<string>();
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!ID_TYPES.includes(node.type.name)) return;
            const id = node.attrs.id as string | null;
            if (!id || seen.has(id)) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: uid() });
              changed = true;
            } else seen.add(id);
          });
          return changed ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() { return { variant: { default: "note", parseHTML: (el) => el.getAttribute("data-variant") ?? "note", renderHTML: (a) => ({ "data-variant": a.variant }) } }; },
  parseHTML() { return [{ tag: "div[data-callout]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() { return { latex: { default: "E = mc^2" } }; },
  parseHTML() { return [{ tag: "div[data-math]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-math") }) }]; },
  renderHTML({ node }) { return ["div", { "data-math": node.attrs.latex }]; },
  addNodeView() { return ReactNodeViewRenderer(MathView); },
});

export const Mermaid = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  addAttributes() { return { code: { default: "graph TD\n  A[Idea] --> B[Plan]\n  B --> C[Ship]" } }; },
  parseHTML() { return [{ tag: "div[data-mermaid]", getAttrs: (el) => ({ code: (el as HTMLElement).getAttribute("data-mermaid") }) }]; },
  renderHTML({ node }) { return ["div", { "data-mermaid": node.attrs.code }]; },
  addNodeView() { return ReactNodeViewRenderer(MermaidView); },
});

export const PageEmbed = Node.create({
  name: "pageEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return { pageId: { default: null } }; },
  parseHTML() { return [{ tag: "div[data-page-embed]", getAttrs: (el) => ({ pageId: (el as HTMLElement).getAttribute("data-page-embed") }) }]; },
  renderHTML({ node }) { return ["div", { "data-page-embed": node.attrs.pageId }]; },
  addNodeView() { return ReactNodeViewRenderer(PageEmbedView); },
});

export const Toc = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  parseHTML() { return [{ tag: "div[data-toc]" }]; },
  renderHTML() { return ["div", { "data-toc": "" }]; },
  addNodeView() { return ReactNodeViewRenderer(TocView); },
});

export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return { attachmentId: { default: null }, name: { default: "" }, mime: { default: "" }, width: { default: null } }; },
  parseHTML() { return [{ tag: "div[data-attachment]", getAttrs: (el) => ({ attachmentId: (el as HTMLElement).getAttribute("data-attachment") }) }]; },
  renderHTML({ node }) { return ["div", { "data-attachment": node.attrs.attachmentId }]; },
  addNodeView() { return ReactNodeViewRenderer(AttachmentView); },
});

export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  addAttributes() { return { url: { default: "" }, title: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-bookmark]", getAttrs: (el) => ({ url: (el as HTMLElement).getAttribute("data-bookmark") }) }]; },
  renderHTML({ node }) { return ["div", { "data-bookmark": node.attrs.url }]; },
  addNodeView() { return ReactNodeViewRenderer(BookmarkView); },
});

/** Recorded voice note or meeting: the audio is an attachment, its transcript lives on that attachment. */
export const VoiceNote = Node.create({
  name: "voiceNote",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return { attachmentId: { default: null }, title: { default: "Voice note" }, duration: { default: 0 }, recordedAt: { default: null } }; },
  addStorage() { return { pageId: null as string | null }; },
  parseHTML() { return [{ tag: "div[data-voice-note]", getAttrs: (el) => ({ attachmentId: (el as HTMLElement).getAttribute("data-voice-note") || null }) }]; },
  renderHTML({ node }) { return ["div", { "data-voice-note": node.attrs.attachmentId ?? "" }]; },
  addNodeView() { return ReactNodeViewRenderer(VoiceNoteView); },
});

/** Inline link to another page. Rendered as a pill; clicking opens the page. */
export const PageMention = Node.create({
  name: "pageMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { pageId: { default: null }, label: { default: "" } }; },
  parseHTML() { return [{ tag: "a[data-page-id]", getAttrs: (el) => ({ pageId: (el as HTMLElement).getAttribute("data-page-id"), label: (el as HTMLElement).textContent }) }]; },
  renderHTML({ node }) { return ["a", { "data-page-id": node.attrs.pageId, class: "mention", href: `#page/${node.attrs.pageId}` }, node.attrs.label || "Untitled"]; },
  renderText({ node }) { return `[[${node.attrs.label}]]`; },
});

// ---- Suggestion menus (slash commands and [[ page links) ---------------------
export interface SuggestState<T> { items: T[]; command: (item: T) => void; rect: DOMRect | null; selected: number }
type Listener = (s: SuggestState<unknown> | null) => void;

/** Bridges a TipTap suggestion to a React-rendered popup via a tiny listener. */
export function suggestionRenderer<T>(listen: () => Listener | null): SuggestionOptions<T>["render"] {
  return () => {
    let state: SuggestState<T> | null = null;
    const emit = () => listen()?.(state as SuggestState<unknown> | null);
    return {
      onStart: (p) => { state = { items: p.items, command: p.command, rect: p.clientRect?.() ?? null, selected: 0 }; emit(); },
      onUpdate: (p) => { state = { items: p.items, command: p.command, rect: p.clientRect?.() ?? null, selected: 0 }; emit(); },
      onKeyDown: ({ event }) => {
        if (!state) return false;
        if (event.key === "ArrowDown") { state = { ...state, selected: (state.selected + 1) % Math.max(1, state.items.length) }; emit(); return true; }
        if (event.key === "ArrowUp") { state = { ...state, selected: (state.selected - 1 + state.items.length) % Math.max(1, state.items.length) }; emit(); return true; }
        if (event.key === "Enter" || event.key === "Tab") {
          const it = state.items[state.selected];
          if (!it) return false; // nothing matches: let Enter/Tab reach the editor
          state.command(it);
          return true;
        }
        if (event.key === "Escape") { state = null; emit(); return true; }
        return false;
      },
      onExit: () => { state = null; emit(); },
    };
  };
}

export interface SlashItem { title: string; hint: string; keywords: string; group: string; run: (editor: Editor, range: Range) => void }

export function SlashCommand(items: () => SlashItem[], listen: () => Listener | null) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: "/",
          allowSpaces: true, // multi-word commands like "/meeting notes"
          pluginKey: new PluginKey("slash"),
          startOfLine: false,
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            return $from.parent.type.name !== "codeBlock";
          },
          items: ({ query }) => {
            const q = query.toLowerCase();
            return items().filter((i) => !q || i.title.toLowerCase().includes(q) || i.keywords.includes(q)).slice(0, 40);
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: suggestionRenderer<SlashItem>(listen),
        }),
      ];
    },
  });
}

export interface PageItem { id: string; title: string; icon: string; create?: boolean }

export function PageLinkSuggest(search: (q: string) => Promise<PageItem[]>, onCreate: (title: string) => Promise<PageItem>, listen: () => Listener | null) {
  const insert = (editor: Editor, range: Range, p: PageItem) =>
    editor.chain().focus().deleteRange(range).insertContent([{ type: "pageMention", attrs: { pageId: p.id, label: p.title || "Untitled" } }, { type: "text", text: " " }]).run();
  return Extension.create({
    name: "pageLinkSuggest",
    addProseMirrorPlugins() {
      const make = (char: string, key: string) =>
        Suggestion<PageItem>({
          editor: this.editor,
          char,
          pluginKey: new PluginKey(key),
          allowSpaces: true,
          items: async ({ query }) => {
            const res = await search(query);
            return query.trim() && !res.some((r) => r.title.toLowerCase() === query.trim().toLowerCase())
              ? [...res, { id: "", title: query.trim(), icon: "+", create: true }]
              : res;
          },
          command: async ({ editor, range, props }) => insert(editor, range, props.create ? await onCreate(props.title) : props),
          render: suggestionRenderer<PageItem>(listen),
        });
      return [make("[[", "wikiLink"), make("@", "mention")];
    },
  });
}

// ---- Find & replace -----------------------------------------------------------
export const findKey = new PluginKey<{ query: string; active: number; matches: { from: number; to: number }[] }>("find");

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findKey,
        state: {
          init: () => ({ query: "", active: 0, matches: [] as { from: number; to: number }[] }),
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as { query?: string; active?: number } | undefined;
            const query = meta?.query ?? prev.query;
            if (!meta && !tr.docChanged) return prev;
            const matches: { from: number; to: number }[] = [];
            if (query) {
              const q = query.toLowerCase();
              tr.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                const t = node.text.toLowerCase();
                let i = t.indexOf(q);
                while (i >= 0 && matches.length < 2000) { matches.push({ from: pos + i, to: pos + i + q.length }); i = t.indexOf(q, i + q.length); }
              });
            }
            return { query, matches, active: Math.min(meta?.active ?? prev.active, Math.max(0, matches.length - 1)) };
          },
        },
        props: {
          decorations(state) {
            const s = findKey.getState(state);
            if (!s?.matches.length) return null;
            return DecorationSet.create(state.doc, s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.active ? "find-hit find-hit-active" : "find-hit" })));
          },
        },
      }),
    ];
  },
});
