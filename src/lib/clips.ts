/** Saves clips sent by the browser extension as pages under "Web clips" (created on first use). */
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import { htmlToDoc, textToDoc } from "@/data/portability";
import type { JSONContent } from "@/data/types";
import { useApp } from "@/store/app";

export async function saveClip(clip: WebClip): Promise<string | null> {
  const ws = useApp.getState().workspaceId;
  if (!ws) return null;
  const pages = await db().pages.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray();
  const parent = pages.find((p) => p.parentId === null && p.title === "Web clips") ?? (await repo.createPage(ws, null, { title: "Web clips", icon: "✂️" }));
  let host = "";
  try { host = new URL(clip.url).hostname; } catch { /* checked by the desktop app */ }
  const body = clip.html ? htmlToDoc(clip.html) : textToDoc(clip.text);
  const intro: JSONContent[] = [
    { type: "bookmark", attrs: { url: clip.url, title: clip.title } },
    { type: "paragraph", content: [{ type: "text", text: `${clip.kind === "selection" ? "Selection clipped" : clip.kind === "article" ? "Article clipped" : "Clipped"} from ${host} on ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`, marks: [{ type: "italic" }] }] },
  ];
  const content: JSONContent = { type: "doc", content: [...intro, ...(body.content ?? [])] };
  const page = await repo.createPage(ws, parent.id, { title: (clip.title || host || "Web clip").slice(0, 200), icon: "🔖", content, tags: ["clip"] });
  await repo.savePageContent(page.id, content); // derives searchable text and links
  useApp.getState().toast(`Clipped “${page.title}”`, "success", { label: "Open", run: () => useApp.getState().open({ kind: "page", id: page.id }) });
  return page.id;
}

let started = false;
export function startClipListener() {
  if (started || !window.rea?.clipper) return;
  started = true;
  window.rea.clipper.onClip((c) => void saveClip(c));
}
