import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MoreHorizontal, Star, Lock, Unlock, Copy, Trash2, History, Download, Image as ImageIcon, Smile, PanelRight, Maximize2, ChevronRight, FileText, Network, LayoutTemplate } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { Page } from "@/data/types";
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { Editor } from "@/editor/Editor";
import { IconPicker, MenuItem, MenuSep, Modal, Popover, EmptyState, Skeleton, useAnchor, confirmDialog } from "@/components/ui";
import { DatabaseView } from "./database/DatabaseView";
import { exportPage } from "@/data/portability";
import { cx, relTime, uid } from "@/lib/util";
import { docToText, reassignIds } from "@/lib/doc";

const COVERS = ["dawn", "sea", "forest", "sand", "graphite", "ink"];

function Breadcrumbs({ page }: { page: Page }) {
  const chain = useLiveQuery(async () => {
    const out: Page[] = [];
    let cur = page.parentId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur) && out.length < 12) {
      seen.add(cur);
      const p = await db().pages.get(cur);
      if (!p) break;
      out.unshift(p);
      cur = p.parentId;
    }
    return out;
  }, [page.parentId]);
  const open = useApp((s) => s.open);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 text-[13px] text-muted">
      {chain?.map((p) => (
        <span key={p.id} className="flex min-w-0 items-center gap-0.5">
          <button className="truncate rounded px-1 hover:bg-hover hover:text-fg" onClick={() => open({ kind: "page", id: p.id })}>{p.icon} {p.title || "Untitled"}</button>
          <ChevronRight size={13} className="shrink-0 text-faint" />
        </span>
      ))}
      <span className="truncate px-1 text-fg">{page.icon} {page.title || "Untitled"}</span>
    </nav>
  );
}

function HistoryModal({ page, onClose }: { page: Page; onClose: () => void }) {
  const revs = useLiveQuery(() => db().revisions.where("pageId").equals(page.id).reverse().sortBy("createdAt"), [page.id]);
  const [sel, setSel] = useState<string | null>(null);
  const rev = revs?.find((r) => r.id === sel);
  return (
    <Modal open onClose={onClose} title="Page history" width={760}
      footer={rev && <button className="btn-primary" onClick={async () => { await repo.restoreRevision(page.id, rev.id); useApp.getState().toast("Version restored. The previous content was saved to history.", "success"); onClose(); }}>Restore this version</button>}>
      {revs?.length === 0 ? <EmptyState title="No earlier versions yet" body="Cairn saves a version at most every 5 minutes while you edit." /> : (
        <div className="flex gap-3">
          <div className="w-52 shrink-0 space-y-0.5">
            {revs?.map((r) => <button key={r.id} className={cx("menu-item", sel === r.id && "bg-active")} onClick={() => setSel(r.id)}>{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</button>)}
          </div>
          <div className="min-h-60 flex-1 whitespace-pre-wrap rounded-md border border-line p-3 text-[13px] text-muted">
            {rev ? (await_text(rev.content)) : "Select a version to preview it."}
          </div>
        </div>
      )}
    </Modal>
  );
}
const await_text = (c: Page["content"]) => docToText(c) || "(empty)";

export default function PageView({ pageId, pane }: { pageId: string; pane: "main" | "split" }) {
  const page = useLiveQuery(() => db().pages.get(pageId), [pageId]);
  const app = useApp();
  const width = useSettings((s) => s.s.editorWidth);
  const menu = useAnchor();
  const iconPick = useAnchor();
  const [history, setHistory] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void repo.touchPage(pageId); }, [pageId]);
  useEffect(() => {
    // An untitled, empty page opens ready for its title (no time window, which is flaky on a busy machine).
    if (page && !page.title && !page.text.trim() && page.kind === "page" && titleRef.current) titleRef.current.focus();
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (page === undefined) return <div className="mx-auto max-w-3xl p-12"><Skeleton lines={8} /></div>;
  if (page === null || !page) return <EmptyState icon={<FileText />} title="This page doesn't exist" body="It may have been permanently deleted." />;
  if (page.deletedAt) return (
    <EmptyState icon={<Trash2 />} title="This page is in the trash" action={<button className="btn-primary" onClick={() => repo.restorePage(page.id)}>Restore page</button>} />
  );

  const maxW = width === "narrow" ? "max-w-[620px]" : width === "wide" ? "max-w-[1100px]" : "max-w-[780px]";
  const locked = !!page.locked;

  const saveAsTemplate = async () => {
    if (!page.content) return;
    await db().templates.add({ id: uid(), workspaceId: page.workspaceId, name: page.title || "Untitled template", description: "Saved from a page", icon: page.icon || "📄", content: reassignIds(page.content, uid), builtIn: false, createdAt: Date.now() });
    app.toast("Saved as template", "success");
  };

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-transparent bg-bg/90 px-3 backdrop-blur">
        <Breadcrumbs page={page} />
        <span className="flex-1" />
        <span className="hidden text-[12px] text-faint md:inline">Edited {relTime(page.updatedAt)}</span>
        {locked && <span className="chip c-gray"><Lock size={11} className="mr-1" /> Locked</span>}
        <button className="icon-btn" title={page.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => repo.updatePageMeta(page.id, { favorite: page.favorite ? 0 : 1 })}>
          <Star size={16} className={page.favorite ? "fill-current text-warning" : ""} />
        </button>
        {pane === "main" && <button className="icon-btn" title="Toggle right panel (Ctrl+Shift+\\)" onClick={() => app.set("rightOpen", !app.rightOpen)}><PanelRight size={16} /></button>}
        <button className="icon-btn" aria-label="Page actions" onClick={menu.openAt}><MoreHorizontal size={16} /></button>
        <Popover anchor={menu.anchor} onClose={menu.close} className="w-60" align="end">
          <MenuItem icon={locked ? <Unlock /> : <Lock />} onClick={() => { void repo.updatePageMeta(page.id, { locked: locked ? 0 : 1 }); menu.close(); }}>{locked ? "Unlock page" : "Lock page"}</MenuItem>
          <MenuItem icon={<Maximize2 />} shortcut="Ctrl+Shift+Enter" onClick={() => { app.set("focusMode", !app.focusMode); menu.close(); }}>Focus mode</MenuItem>
          <MenuItem icon={<PanelRight />} onClick={() => { app.open({ kind: "page", id: page.id }, { split: true }); menu.close(); }}>Open in split view</MenuItem>
          <MenuItem icon={<Network />} onClick={() => { app.open({ kind: "graph", id: page.id }); menu.close(); }}>Local graph</MenuItem>
          <MenuItem icon={<History />} onClick={() => { setHistory(true); menu.close(); }}>Page history</MenuItem>
          <MenuSep />
          <MenuItem icon={<Copy />} onClick={async () => { menu.close(); const c = await repo.duplicatePage(page.id); if (c) app.open({ kind: "page", id: c.id }); }}>Duplicate</MenuItem>
          {page.kind === "page" && <MenuItem icon={<LayoutTemplate />} onClick={() => { menu.close(); void saveAsTemplate(); }}>Save as template</MenuItem>}
          <MenuItem icon={<Download />} onClick={() => { menu.close(); void exportPage(page.id, "md"); }}>Export as Markdown</MenuItem>
          <MenuItem icon={<Download />} onClick={() => { menu.close(); void exportPage(page.id, "html"); }}>Export as HTML</MenuItem>
          <MenuItem icon={<Download />} onClick={() => { menu.close(); void exportPage(page.id, "pdf"); }}>Export as PDF (print)</MenuItem>
          <MenuSep />
          <MenuItem icon={<Trash2 />} danger onClick={async () => {
            menu.close();
            if (!(await confirmDialog("Move this page to the trash?", "Sub-pages move with it. You can restore it from Trash."))) return;
            await repo.trashPage(page.id);
            if (pane === "split") app.closeSplit();
            app.toast("Moved to trash", "info", { label: "Undo", run: () => void repo.restorePage(page.id) });
          }}>Move to trash</MenuItem>
        </Popover>
      </div>

      {page.cover && <div className={cx("group relative h-44 w-full", `cover-${page.cover}`)}>
        {!locked && <button className="btn absolute bottom-2 right-3 bg-elev/80 opacity-0 group-hover:opacity-100" onClick={() => repo.updatePageMeta(page.id, { cover: COVERS[(COVERS.indexOf(page.cover) + 1) % COVERS.length]! })}>Change cover</button>}
      </div>}

      <div className={cx("mx-auto px-12 pb-6", maxW, page.cover ? "pt-4" : "pt-14")}>
        {page.icon && <button className={cx("mb-2 text-[54px] leading-none", page.cover && "-mt-14 relative")} onClick={iconPick.openAt} disabled={locked}>{page.icon}</button>}
        {!locked && (
          <div className="mb-1 flex gap-1 text-[13px] text-faint opacity-60 hover:opacity-100">
            {!page.icon && <button className="btn h-6 text-faint" onClick={iconPick.openAt}><Smile size={14} /> Add icon</button>}
            {!page.cover && <button className="btn h-6 text-faint" onClick={() => repo.updatePageMeta(page.id, { cover: COVERS[Math.floor(Math.random() * COVERS.length)]! })}><ImageIcon size={14} /> Add cover</button>}
            {page.cover && <button className="btn h-6 text-faint" onClick={() => repo.updatePageMeta(page.id, { cover: "" })}>Remove cover</button>}
          </div>
        )}
        <IconPicker anchor={iconPick.anchor} onClose={iconPick.close} onPick={(icon) => repo.updatePageMeta(page.id, { icon })} />
        <textarea
          ref={titleRef}
          rows={1}
          readOnly={locked}
          aria-label="Page title"
          className="font-display mb-3 w-full resize-none overflow-hidden bg-transparent text-[42px] leading-[1.15] outline-none placeholder:text-faint/60 [field-sizing:content]"
          placeholder="Untitled"
          defaultValue={page.title}
          key={page.id}
          onChange={(e) => { void repo.updatePageMeta(page.id, { title: e.target.value.replace(/\n/g, " ") }); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (document.querySelector(".rea-editor") as HTMLElement | null)?.focus(); } }}
        />
        {page.tags.length > 0 && <div className="mb-3 flex flex-wrap gap-1">{page.tags.map((t) => <button key={t} className="chip c-gray" onClick={() => app.open({ kind: "search", sub: `#${t}` })}>#{t}</button>)}</div>}
      </div>
      <div className={cx("mx-auto px-12", page.kind === "database" ? "max-w-none" : maxW)}>
        {page.kind === "database" && page.databaseId ? <DatabaseView databaseId={page.databaseId} /> : <Editor key={page.id} page={page} editable={!locked} />}
      </div>
      {history && <HistoryModal page={page} onClose={() => setHistory(false)} />}
    </div>
  );
}
