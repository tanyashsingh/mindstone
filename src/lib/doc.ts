import type { JSONContent } from "@/data/types";

/** Block-level node types; each carries a stable `id` attribute. */
export const BLOCK_TYPES = [
  "paragraph", "heading", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote",
  "codeBlock", "horizontalRule", "table", "image", "callout", "mathBlock", "mermaid", "pageEmbed", "toc",
  "attachment", "bookmark", "details", "columns", "column",
] as const;

export function emptyDoc(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/** Depth-first walk over a document. */
export function walk(node: JSONContent | null | undefined, fn: (n: JSONContent, parent: JSONContent | null) => void, parent: JSONContent | null = null) {
  if (!node) return;
  fn(node, parent);
  for (const c of node.content ?? []) walk(c, fn, node);
}

const BLOCK_SEP = new Set(["paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock", "tableCell", "tableHeader", "callout", "mathBlock", "mermaid", "detailsSummary"]);

/** Plain text of a document, one line per block. Mentions render as their label. */
export function docToText(doc: JSONContent | null | undefined): string {
  if (!doc) return "";
  const out: string[] = [];
  const rec = (n: JSONContent) => {
    if (n.type === "text") out.push(n.text ?? "");
    else if (n.type === "pageMention") out.push(String(n.attrs?.label ?? ""));
    else if (n.type === "hardBreak") out.push("\n");
    else if (n.type === "mathBlock" || n.type === "mathInline") out.push(String(n.attrs?.latex ?? ""));
    for (const c of n.content ?? []) rec(c);
    if (n.type && BLOCK_SEP.has(n.type)) out.push("\n");
  };
  rec(doc);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export interface ExtractedLink { toPageId?: string; title?: string; kind: "wiki" | "mention" | "embed" }

const WIKI = /\[\[([^\[\]\n]{1,200})\]\]/g;

/** Links in a document: page mentions/embeds by id, and raw `[[Title]]` text by title. */
export function extractLinks(doc: JSONContent | null | undefined): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  walk(doc, (n) => {
    if (n.type === "pageMention" && typeof n.attrs?.pageId === "string") links.push({ toPageId: n.attrs.pageId, kind: "mention" });
    if (n.type === "pageEmbed" && typeof n.attrs?.pageId === "string") links.push({ toPageId: n.attrs.pageId, kind: "embed" });
    if (n.type === "text" && n.text) {
      for (const m of n.text.matchAll(WIKI)) links.push({ title: m[1]!.trim(), kind: "wiki" });
    }
  });
  return links;
}

export interface HeadingItem { id: string; level: number; text: string }
export function headings(doc: JSONContent | null | undefined): HeadingItem[] {
  const out: HeadingItem[] = [];
  walk(doc, (n) => {
    if (n.type === "heading") out.push({ id: String(n.attrs?.id ?? ""), level: Number(n.attrs?.level ?? 1), text: docToText(n) });
  });
  return out;
}

/** Tags written inline as #tag in text. */
export function extractTags(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{2,40})/gu)) set.add(m[1]!.toLowerCase());
  return [...set];
}

/** Give every block a fresh id (used when duplicating pages or applying templates). */
export function reassignIds(doc: JSONContent, gen: () => string): JSONContent {
  const clone: JSONContent = structuredClone(doc);
  walk(clone, (n) => {
    if (n.attrs && "id" in n.attrs) n.attrs.id = gen();
  });
  return clone;
}

// ---- Markdown serialisation (lossless for the supported block set) ---------
function inline(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "pageMention") return `[[${n.attrs?.label ?? ""}]]`;
      if (n.type === "mathInline") return `$${n.attrs?.latex ?? ""}$`;
      if (n.type !== "text") return inline(n.content);
      let t = n.text ?? "";
      const marks = n.marks ?? [];
      const has = (m: string) => marks.some((x) => x.type === m);
      if (has("code")) t = "`" + t + "`";
      if (has("bold")) t = `**${t}**`;
      if (has("italic")) t = `*${t}*`;
      if (has("strike")) t = `~~${t}~~`;
      if (has("highlight")) t = `==${t}==`;
      const link = marks.find((x) => x.type === "link");
      if (link) t = `[${t}](${String(link.attrs?.href ?? "")})`;
      return t;
    })
    .join("");
}

export function docToMarkdown(doc: JSONContent | null | undefined, resolveTitle: (id: string) => string = () => "page"): string {
  if (!doc) return "";
  const lines: string[] = [];
  const block = (n: JSONContent, indent: string, listMarker?: string) => {
    switch (n.type) {
      case "paragraph":
        lines.push(indent + (listMarker ?? "") + inline(n.content));
        break;
      case "heading":
        lines.push("#".repeat(Number(n.attrs?.level ?? 1)) + " " + inline(n.content));
        break;
      case "bulletList":
        for (const li of n.content ?? []) listItem(li, indent, "- ");
        break;
      case "orderedList":
        (n.content ?? []).forEach((li, i) => listItem(li, indent, `${i + Number(n.attrs?.start ?? 1)}. `));
        break;
      case "taskList":
        for (const li of n.content ?? []) listItem(li, indent, li.attrs?.checked ? "- [x] " : "- [ ] ");
        break;
      case "blockquote":
        for (const c of n.content ?? []) {
          const sub: string[] = [];
          const saved = lines.length;
          block(c, "");
          sub.push(...lines.splice(saved));
          for (const s of sub) lines.push("> " + s);
        }
        break;
      case "callout": {
        const saved = lines.length;
        for (const c of n.content ?? []) block(c, "");
        const sub = lines.splice(saved);
        lines.push(`> [!${String(n.attrs?.variant ?? "note").toUpperCase()}]`);
        for (const s of sub) lines.push("> " + s);
        break;
      }
      case "codeBlock":
        lines.push("```" + String(n.attrs?.language ?? ""), inline(n.content), "```");
        break;
      case "mermaid":
        lines.push("```mermaid", String(n.attrs?.code ?? ""), "```");
        break;
      case "mathBlock":
        lines.push("$$", String(n.attrs?.latex ?? ""), "$$");
        break;
      case "horizontalRule":
        lines.push("---");
        break;
      case "image":
        lines.push(`![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`);
        break;
      case "pageEmbed":
        lines.push(`![[${resolveTitle(String(n.attrs?.pageId ?? ""))}]]`);
        break;
      case "bookmark":
        lines.push(`[${String(n.attrs?.title || n.attrs?.url || "")}](${String(n.attrs?.url ?? "")})`);
        break;
      case "attachment":
        lines.push(`[📎 ${String(n.attrs?.name ?? "file")}](attachment:${String(n.attrs?.attachmentId ?? "")})`);
        break;
      case "toc":
        lines.push("[TOC]");
        break;
      case "details": {
        const [summary, ...rest] = n.content ?? [];
        lines.push("<details>", `<summary>${inline(summary?.content?.[0]?.content ?? summary?.content)}</summary>`, "");
        for (const r of rest) for (const c of r.content ?? []) block(c, "");
        lines.push("</details>");
        break;
      }
      case "table": {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inline(p.content)).join(" ").replace(/\|/g, "\\|")));
        if (rows.length) {
          const w = Math.max(...rows.map((r) => r.length));
          const pad = (r: string[]) => [...r, ...Array(w - r.length).fill("")];
          lines.push("| " + pad(rows[0]!).join(" | ") + " |", "|" + " --- |".repeat(w));
          for (const r of rows.slice(1)) lines.push("| " + pad(r).join(" | ") + " |");
        }
        break;
      }
      default:
        for (const c of n.content ?? []) block(c, indent);
    }
    if (!indent && !listMarker) lines.push("");
  };
  const listItem = (li: JSONContent, indent: string, marker: string) => {
    const [first, ...rest] = li.content ?? [];
    if (first) block(first, indent, marker);
    for (const r of rest) {
      if (r.type === "bulletList" || r.type === "orderedList" || r.type === "taskList") block(r, indent + "  ");
      else block(r, indent + "  ");
    }
  };
  for (const c of doc.content ?? []) block(c, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
