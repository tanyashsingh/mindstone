import { useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Home, Inbox, Search, CheckSquare, FolderKanban, Calendar, Network, Paperclip, LayoutTemplate, Sparkles, Trash2, Settings,
  ChevronRight, Plus, MoreHorizontal, Star, FileText, Table2, ChevronsLeft, Copy, PanelRight, ExternalLink, Pencil, Users, Database as DbIcon, Check,
} from "lucide-react";
import { db } from "@/data/db";
import type { Page } from "@/data/types";
import * as repo from "@/data/repo";
import { useApp, type Route, type RouteKind } from "@/store/app";
import { cx } from "@/lib/util";
import { MenuItem, MenuSep, Popover, confirmDialog, promptDialog, useAnchor } from "./ui";

function NavItem({ icon, label, kind, shortcut, badge }: { icon: ReactNode; label: string; kind: RouteKind; shortcut?: string; badge?: number }) {
  const { tabs, active, open } = useApp();
  const isActive = tabs[active]?.route.kind === kind;
  return (
    <button className={cx("flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg", isActive && "bg-active text-fg")}
      onClick={(e) => open({ kind }, { newTab: e.ctrlKey })} title={shortcut}>
      <span className="[&>svg]:size-4">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge ? <span className="text-[11px] text-faint">{badge}</span> : null}
    </button>
  );
}

function Section({ title, children, action, defaultOpen = true }: { title: string; children: ReactNode; action?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <div className="group flex h-6 items-center px-2">
        <button className="flex-1 text-left text-[11.5px] font-medium text-faint hover:text-muted" onClick={() => setOpen(!open)}>{title}</button>
        <span className="opacity-0 group-hover:opacity-100">{action}</span>
      </div>
      {open && children}
    </div>
  );
}

type DropPos = "before" | "inside" | "after";

function PageRow({ page, depth, childrenOf, expanded, toggle, onDrop }: {
  page: Page; depth: number; childrenOf: Map<string | null, Page[]>; expanded: Set<string>; toggle: (id: string) => void;
  onDrop: (dragId: string, target: Page, pos: DropPos) => void;
}) {
  const { tabs, active, open, workspaceId } = useApp();
  const menu = useAnchor();
  const [drop, setDrop] = useState<DropPos | null>(null);
  const kids = childrenOf.get(page.id) ?? [];
  const isOpen = expanded.has(page.id);
  const isActive = tabs[active]?.route.kind === "page" && tabs[active]?.route.id === page.id;
  const go = (r: Route, e?: React.MouseEvent) => open(r, { newTab: e?.ctrlKey || e?.button === 1 });

  const addChild = async () => {
    const p = await repo.createPage(workspaceId!, page.id);
    if (!isOpen) toggle(page.id);
    open({ kind: "page", id: p.id });
  };

  return (
    <>
      <div
        draggable
        onDragStart={(e) => { e.dataTransfer.setData("application/x-rea-page", page.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("application/x-rea-page")) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          setDrop(y < 0.25 ? "before" : y > 0.75 ? "after" : "inside");
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("application/x-rea-page"); setDrop(null); if (id && id !== page.id) onDrop(id, page, drop ?? "inside"); }}
        onContextMenu={menu.openAtPoint}
        onClick={(e) => go({ kind: "page", id: page.id }, e)}
        onAuxClick={(e) => e.button === 1 && go({ kind: "page", id: page.id }, e)}
        className={cx(
          "group relative flex h-7 items-center gap-1 rounded-md pr-1 text-[13px] text-muted hover:bg-hover hover:text-fg",
          isActive && "bg-active text-fg",
          drop === "inside" && "ring-1 ring-accent bg-accent-soft",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={kids.length ? isOpen : undefined}
        aria-selected={isActive}
      >
        {drop === "before" && <div className="absolute inset-x-1 top-0 h-0.5 rounded bg-accent" />}
        {drop === "after" && <div className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />}
        <button className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-active" aria-label={isOpen ? "Collapse" : "Expand"}
          onClick={(e) => { e.stopPropagation(); toggle(page.id); }}>
          <ChevronRight size={13} className={cx("transition-transform text-faint", isOpen && "rotate-90", !kids.length && "opacity-40")} />
        </button>
        <span className="w-5 shrink-0 text-center text-[14px]">{page.icon || (page.kind === "database" ? <Table2 size={14} className="inline text-faint" /> : <FileText size={14} className="inline text-faint" />)}</span>
        <span className="flex-1 truncate">{page.title || "Untitled"}</span>
        <button className="icon-btn size-5 opacity-0 group-hover:opacity-100" aria-label="Page actions" onClick={(e) => { e.stopPropagation(); menu.openAt(e); }}><MoreHorizontal size={14} /></button>
        <button className="icon-btn size-5 opacity-0 group-hover:opacity-100" aria-label="Add sub-page" onClick={(e) => { e.stopPropagation(); void addChild(); }}><Plus size={14} /></button>
      </div>
      <Popover anchor={menu.anchor} onClose={menu.close} className="w-56">
        <MenuItem icon={<Star />} onClick={() => { void repo.updatePageMeta(page.id, { favorite: page.favorite ? 0 : 1 }); menu.close(); }}>{page.favorite ? "Remove from favorites" : "Add to favorites"}</MenuItem>
        <MenuItem icon={<Pencil />} onClick={async () => { menu.close(); const t = await promptDialog("Rename page", page.title); if (t !== null) await repo.updatePageMeta(page.id, { title: t }); }}>Rename</MenuItem>
        <MenuItem icon={<Copy />} onClick={async () => { menu.close(); const c = await repo.duplicatePage(page.id); if (c) open({ kind: "page", id: c.id }); }}>Duplicate</MenuItem>
        <MenuItem icon={<Plus />} onClick={() => { menu.close(); void addChild(); }}>Add sub-page</MenuItem>
        <MenuSep />
        <MenuItem icon={<ExternalLink />} onClick={() => { menu.close(); open({ kind: "page", id: page.id }, { newTab: true }); }} shortcut="Ctrl+Click">Open in new tab</MenuItem>
        <MenuItem icon={<PanelRight />} onClick={() => { menu.close(); open({ kind: "page", id: page.id }, { split: true }); }}>Open in split view</MenuItem>
        <MenuItem icon={<Network />} onClick={() => { menu.close(); open({ kind: "graph", id: page.id }); }}>Show in graph</MenuItem>
        <MenuSep />
        <MenuItem icon={<Trash2 />} danger onClick={async () => {
          menu.close();
          await repo.trashPage(page.id);
          useApp.getState().toast(`Moved “${page.title || "Untitled"}” to trash`, "info", { label: "Undo", run: () => void repo.restorePage(page.id) });
        }}>Move to trash</MenuItem>
      </Popover>
      {isOpen && kids.map((k) => <PageRow key={k.id} page={k} depth={depth + 1} childrenOf={childrenOf} expanded={expanded} toggle={toggle} onDrop={onDrop} />)}

    </>
  );
}

function WorkspaceSwitcher() {
  const { workspaceId, setWorkspace, set } = useApp();
  const menu = useAnchor();
  const workspaces = useLiveQuery(() => db().workspaces.orderBy("createdAt").toArray(), []);
  const ws = workspaces?.find((w) => w.id === workspaceId);
  return (
    <>
      <div className="flex items-center gap-1 px-2 pt-2.5 pb-1">
        <button className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 hover:bg-hover" onClick={menu.openAt} aria-haspopup="menu">
          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-fg text-[11px] font-semibold text-bg">{(ws?.name ?? "R")[0]}</span>
          <span className="truncate text-[13.5px] font-medium">{ws?.name ?? "…"}</span>
        </button>
        <button className="icon-btn" title="Collapse sidebar (Ctrl+\)" onClick={() => set("sidebarOpen", false)}><ChevronsLeft size={16} /></button>
      </div>
      <Popover anchor={menu.anchor} onClose={menu.close} className="w-64">
        <div className="px-2 pb-1 pt-1.5 label">Workspaces</div>
        {workspaces?.map((w) => (
          <MenuItem key={w.id} onClick={() => { menu.close(); setWorkspace(w.id); }} icon={w.id === workspaceId ? <Check /> : <span className="inline-block size-4" />}>{w.name}</MenuItem>
        ))}
        <MenuSep />
        <MenuItem icon={<Plus />} onClick={async () => {
          menu.close();
          const name = await promptDialog("New workspace", "", "Each workspace has its own pages, tasks, databases and settings.");
          if (name) { const w = await repo.createWorkspace(name); setWorkspace(w.id); }
        }}>New workspace</MenuItem>
        <MenuItem icon={<Pencil />} onClick={async () => {
          menu.close();
          const name = await promptDialog("Rename workspace", ws?.name ?? "");
          if (name && ws) await db().workspaces.update(ws.id, { name, updatedAt: Date.now() });
        }}>Rename workspace</MenuItem>
        <MenuItem icon={<Trash2 />} danger disabled={(workspaces?.length ?? 0) < 2} onClick={async () => {
          menu.close();
          if (!ws) return;
          const ok = await confirmDialog(`Delete “${ws.name}” permanently?`, "All pages, databases, tasks, events and files in this workspace will be deleted from this device. This cannot be undone. Create a backup first if you may need it.", { danger: true, confirmLabel: "Delete workspace" });
          if (!ok) return;
          const other = workspaces!.find((w) => w.id !== ws.id)!;
          setWorkspace(other.id);
          await repo.deleteWorkspace(ws.id);
        }}>Delete workspace…</MenuItem>
      </Popover>
    </>
  );
}

export function Sidebar() {
  const { workspaceId, open, sidebarWidth, set, tabs, active } = useApp();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem("rea.expanded") ?? "[]") as string[]));
  const pages = useLiveQuery(() => (workspaceId ? repo.livePages(workspaceId) : Promise.resolve([] as Page[])), [workspaceId]);
  const inboxCount = useLiveQuery(() => workspaceId ? db().tasks.where("[workspaceId+deletedAt]").equals([workspaceId, 0]).filter((t) => t.status !== "done" && !t.projectId && !t.dueDate).count() : 0, [workspaceId]);

  const { childrenOf, favorites, recent } = useMemo(() => {
    const m = new Map<string | null, Page[]>();
    const ids = new Set((pages ?? []).map((p) => p.id));
    for (const p of pages ?? []) {
      const parent = p.parentId && ids.has(p.parentId) ? p.parentId : null;
      if (!m.has(parent)) m.set(parent, []);
      m.get(parent)!.push(p);
    }
    for (const list of m.values()) list.sort((a, b) => a.sortKey - b.sortKey);
    return {
      childrenOf: m,
      favorites: (pages ?? []).filter((p) => p.favorite).sort((a, b) => a.title.localeCompare(b.title)),
      recent: [...(pages ?? [])].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 5),
    };
  }, [pages]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
    localStorage.setItem("rea.expanded", JSON.stringify([...next]));
  };

  const onDrop = async (dragId: string, target: Page, pos: DropPos) => {
    let ok: boolean;
    if (pos === "inside") {
      ok = await repo.movePage(dragId, target.id, Date.now());
      if (ok && !expanded.has(target.id)) toggle(target.id);
    } else {
      const siblings = childrenOf.get(target.parentId) ?? [];
      const idx = siblings.findIndex((s) => s.id === target.id);
      const neighbour = siblings[pos === "before" ? idx - 1 : idx + 1];
      const key = neighbour ? (target.sortKey + neighbour.sortKey) / 2 : target.sortKey + (pos === "before" ? -1000 : 1000);
      ok = await repo.movePage(dragId, target.parentId, key);
    }
    if (!ok) useApp.getState().toast("A page can't be moved inside itself", "error");
  };

  const newPage = async () => {
    const p = await repo.createPage(workspaceId!, null);
    open({ kind: "page", id: p.id });
  };
  const newDatabase = async () => {
    const { page } = await repo.createDatabase(workspaceId!, null);
    open({ kind: "page", id: page.id });
  };

  const roots = childrenOf.get(null) ?? [];
  const curId = tabs[active]?.route.id;

  return (
    <nav className="relative flex shrink-0 flex-col border-r border-line bg-sunken" style={{ width: sidebarWidth }} aria-label="Sidebar">
      <WorkspaceSwitcher />
      <div className="px-2">
        <button className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg" onClick={() => { set("paletteMode", "all"); set("paletteOpen", true); }}>
          <Search size={16} /><span className="flex-1 text-left">Search</span><span className="kbd">Ctrl K</span>
        </button>
        <NavItem icon={<Home />} label="Home" kind="home" />
        <NavItem icon={<Inbox />} label="Inbox" kind="inbox" badge={inboxCount} />
        <NavItem icon={<Sparkles />} label="Mindstone Intelligence" kind="ai" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        onDragOver={(e) => e.dataTransfer.types.includes("application/x-rea-page") && e.preventDefault()}
        onDrop={async (e) => { if (e.target === e.currentTarget) { const id = e.dataTransfer.getData("application/x-rea-page"); if (id) await repo.movePage(id, null, Date.now()); } }}>
        <Section title="Workspace">
          <NavItem icon={<CheckSquare />} label="Tasks" kind="tasks" />
          <NavItem icon={<FolderKanban />} label="Projects" kind="projects" />
          <NavItem icon={<Calendar />} label="Calendar" kind="calendar" />
          <NavItem icon={<DbIcon />} label="Databases" kind="databases" />
          <NavItem icon={<Network />} label="Knowledge graph" kind="graph" />
          <NavItem icon={<Paperclip />} label="Files" kind="files" />
          <NavItem icon={<LayoutTemplate />} label="Templates" kind="templates" />
        </Section>
        {favorites.length > 0 && (
          <Section title="Favorites">
            {favorites.map((p) => (
              <button key={p.id} className={cx("flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg", curId === p.id && "bg-active text-fg")} onClick={(e) => open({ kind: "page", id: p.id }, { newTab: e.ctrlKey })}>
                <span className="w-4 text-center">{p.icon || <Star size={13} className="inline" />}</span><span className="truncate">{p.title || "Untitled"}</span>
              </button>
            ))}
          </Section>
        )}
        <Section title="Recent" defaultOpen={false}>
          {recent.map((p) => (
            <button key={p.id} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg" onClick={() => open({ kind: "page", id: p.id })}>
              <span className="w-4 text-center">{p.icon || <FileText size={13} className="inline" />}</span><span className="truncate">{p.title || "Untitled"}</span>
            </button>
          ))}
        </Section>
        <Section title="Private" action={<span className="flex"><button className="icon-btn size-5" title="New database" onClick={newDatabase}><Table2 size={13} /></button><button className="icon-btn size-5" title="New page (Ctrl+N)" onClick={newPage}><Plus size={14} /></button></span>}>
          {pages === undefined ? <div className="skeleton mx-2 h-5" /> : <div role="tree" aria-label="Pages">{roots.map((p) => <PageRow key={p.id} page={p} depth={0} childrenOf={childrenOf} expanded={expanded} toggle={toggle} onDrop={onDrop} />)}</div>}
          <button className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-faint hover:bg-hover hover:text-muted" onClick={newPage}><Plus size={14} /> New page</button>
        </Section>
        <Section title="Shared" defaultOpen={false}>
          <div className="flex items-start gap-2 px-2 py-1 text-[12px] text-faint"><Users size={14} className="mt-0.5 shrink-0" /> Sharing needs a sync server, which is not configured. This workspace is local only.</div>
        </Section>
      </div>
      <div className="mx-2 mb-2 border-t border-line px-0 pt-1.5">
        <NavItem icon={<Trash2 />} label="Trash" kind="trash" />
        <NavItem icon={<Settings />} label="Settings" kind="settings" shortcut="Ctrl+," />
      </div>
      <div
        className="absolute -right-0.5 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent/40"
        role="separator" aria-orientation="vertical" aria-label="Resize sidebar"
        onMouseDown={(e) => {
          const startX = e.clientX, startW = sidebarWidth;
          const move = (ev: MouseEvent) => set("sidebarWidth", Math.max(200, Math.min(480, startW + ev.clientX - startX)));
          const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); };
          addEventListener("mousemove", move);
          addEventListener("mouseup", up);
        }}
      />
    </nav>
  );
}
