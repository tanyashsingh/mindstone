import { useLiveQuery } from "dexie-react-hooks";
import { X, ListTree, Link2, Info, MessageSquare, History, Sparkles, Shapes, Puzzle } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import { searchIndex } from "@/data/search";
import { ensureSearchIndex } from "@/bootstrap";
import { useApp } from "@/store/app";
import { headings } from "@/lib/doc";
import { cx, relTime, wordCount } from "@/lib/util";
import { AiChat } from "@/views/AiView";
import { EmptyState } from "./ui";
import { CommentsPanel } from "./CommentsPanel";
import { PluginPanels } from "./PluginPanels";

type TabId = ReturnType<typeof useApp.getState>["rightTab"];
const TABS: { id: TabId; icon: React.ReactNode; label: string }[] = [
  { id: "outline", icon: <ListTree size={15} />, label: "Outline" },
  { id: "backlinks", icon: <Link2 size={15} />, label: "Backlinks" },
  { id: "related", icon: <Shapes size={15} />, label: "Related" },
  { id: "properties", icon: <Info size={15} />, label: "Properties" },
  { id: "comments", icon: <MessageSquare size={15} />, label: "Comments" },
  { id: "activity", icon: <History size={15} />, label: "Activity" },
  { id: "ai", icon: <Sparkles size={15} />, label: "AI" },
  { id: "plugins", icon: <Puzzle size={15} />, label: "Plugins" },
];

export function RightPanel() {
  const { tabs, active, rightTab, set, open } = useApp();
  const route = tabs[active]?.route;
  const pageId = route?.kind === "page" ? route.id : undefined;
  const page = useLiveQuery(() => (pageId ? db().pages.get(pageId) : undefined), [pageId]);

  const backlinks = useLiveQuery(async () => {
    if (!pageId) return [];
    const links = await db().links.where("toPageId").equals(pageId).toArray();
    const pages = await db().pages.bulkGet([...new Set(links.map((l) => l.fromPageId))]);
    return pages.filter((p) => p && !p.deletedAt).map((p) => ({ page: p!, kinds: links.filter((l) => l.fromPageId === p!.id).map((l) => l.kind) }));
  }, [pageId]);
  const outgoing = useLiveQuery(async () => {
    if (!pageId) return [];
    const links = await db().links.where("fromPageId").equals(pageId).toArray();
    return (await db().pages.bulkGet(links.map((l) => l.toPageId))).filter((p) => p && !p.deletedAt).map((p) => p!);
  }, [pageId]);
  const related = useLiveQuery(async () => {
    if (!page) return [];
    await ensureSearchIndex(page.workspaceId);
    const terms = page.text.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
    const freq = new Map<string, number>();
    for (const t of terms) freq.set(t, (freq.get(t) ?? 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
    const q = [...page.tags, ...top, ...page.title.split(/\s+/)].join(" ");
    const hits = q.trim() ? searchIndex.search(q, { kinds: ["page"], limit: 12 }).filter((h) => h.refId !== page.id).slice(0, 8) : [];
    return hits;
  }, [page?.id, page?.updatedAt]);
  const activity = useLiveQuery(async () => (pageId ? (await db().activity.where("entityId").equals(pageId).toArray()).sort((a, b) => b.at - a.at).slice(0, 20) : []), [pageId]);
  const revisions = useLiveQuery(() => (pageId ? db().revisions.where("pageId").equals(pageId).count() : 0), [pageId]);

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-sunken" aria-label="Context panel">
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
        {TABS.map((t) => <button key={t.id} className={cx("icon-btn", rightTab === t.id && "bg-active text-fg")} title={t.label} aria-label={t.label} aria-pressed={rightTab === t.id} onClick={() => set("rightTab", t.id)}>{t.icon}</button>)}
        <span className="flex-1" />
        <button className="icon-btn" aria-label="Close panel" onClick={() => set("rightOpen", false)}><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[13px]">
        {rightTab === "plugins" ? <><div className="label mb-2">Plugins</div><PluginPanels /></> : !page ? <EmptyState title="Open a page" body="Outline, backlinks, properties and comments appear here for the current page." /> : <>
          <div className="label mb-2">{TABS.find((t) => t.id === rightTab)?.label}</div>
          {rightTab === "outline" && (headings(page.content).length === 0 ? <div className="text-faint">No headings yet.</div> : headings(page.content).map((h, i) => (
            <button key={h.id || i} className="block w-full truncate rounded px-1 py-0.5 text-left text-muted hover:bg-hover hover:text-fg" style={{ paddingLeft: (h.level - 1) * 12 + 4 }}
              onClick={() => document.querySelector(`[data-id="${CSS.escape(h.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{h.text || "Untitled"}</button>
          )))}
          {rightTab === "backlinks" && (
            <>
              {backlinks?.length === 0 && <div className="mb-3 text-faint">No pages link here yet. Link to this page from another one with [[{page.title || "Untitled"}]].</div>}
              {backlinks?.map(({ page: p, kinds }) => <button key={p.id} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-hover" onClick={() => open({ kind: "page", id: p.id })}><span>{p.icon || "📄"}</span><span className="flex-1 truncate">{p.title || "Untitled"}</span><span className="text-[11px] text-faint">{kinds.join(", ")}</span></button>)}
              {outgoing && outgoing.length > 0 && <><div className="label mb-1 mt-4">Links from this page</div>{outgoing.map((p) => <button key={p.id} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-hover" onClick={() => open({ kind: "page", id: p.id })}><span>{p.icon || "📄"}</span><span className="truncate">{p.title || "Untitled"}</span></button>)}</>}
            </>
          )}
          {rightTab === "related" && (related?.length === 0 ? <div className="text-faint">Nothing similar found yet.</div> : related?.map((h) => (
            <button key={h.id} className="block w-full rounded px-1 py-1.5 text-left hover:bg-hover" onClick={() => open({ kind: "page", id: h.refId })}><div className="truncate">{h.title}</div><div className="line-clamp-2 text-[11.5px] text-faint">{h.snippet}</div></button>
          )))}
          {rightTab === "properties" && (
            <dl className="space-y-2">
              {[["Created", new Date(page.createdAt).toLocaleString()], ["Last edited", `${new Date(page.updatedAt).toLocaleString()} (${relTime(page.updatedAt)})`], ["Words", wordCount(page.text).toLocaleString()], ["Versions saved", String(revisions ?? 0)], ["Type", page.kind], ["Locked", page.locked ? "Yes" : "No"], ["ID", page.id]].map(([k, v]) => (
                <div key={k}><dt className="text-[11.5px] text-faint">{k}</dt><dd className="break-all">{v}</dd></div>
              ))}
              <div><dt className="text-[11.5px] text-faint">Tags (also picked up from #tags in text)</dt>
                <dd><input className="input mt-1" key={page.tags.join(",")} defaultValue={page.tags.join(", ")} onBlur={(e) => repo.updatePageMeta(page.id, { tags: e.target.value.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean) })} /></dd></div>
            </dl>
          )}
          {rightTab === "comments" && <CommentsPanel page={page} />}
          {rightTab === "activity" && activity?.map((a) => <div key={a.id} className="py-0.5 text-muted">{a.action} · {relTime(a.at)}</div>)}
          {rightTab === "ai" && <div className="-mx-3 -mb-3 h-[calc(100vh-140px)]"><AiChat compact pageId={page.id} /></div>}
        </>}
      </div>
    </aside>
  );
}
