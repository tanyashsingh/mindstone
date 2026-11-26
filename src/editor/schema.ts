import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { common, createLowlight } from "lowlight";
import { BlockId, Callout, MathBlock, Mermaid, PageEmbed, Toc, Attachment, Bookmark, PageMention, VoiceNote } from "./extensions";

export const lowlight = createLowlight(common);

/** The document schema shared by the editor and the importers. */
export function schemaExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ allowBase64: false }),
    Highlight,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
    Details.configure({ persist: true, HTMLAttributes: { class: "details" } }),
    DetailsSummary,
    DetailsContent,
    BlockId,
    Callout, MathBlock, Mermaid, PageEmbed, Toc, Attachment, Bookmark, PageMention, VoiceNote,
  ];
}
