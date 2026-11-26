import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, FileText, CheckSquare, FolderKanban, CalendarDays, Table2, Paperclip, Hash, ArrowRight, Clock } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import { searchIndex, type SearchHit } from "@/data/search";
import { ensureSearchIndex } from "@/bootstrap";
import { useApp, type RouteKind } from "@/store/app";
import { resolvedDark, useSettings } from "@/store/settings";
import { shortcutLabel } from "@/lib/shortcuts";
import { cx } from "@/lib/util";
import { useDigest } from "./DigestDialog";
import { Highlight } from "@/views/SearchView";

export function openHit(h: SearchHit, newTab = false) {
  const { open } = useApp.getState();
  switch (h.kind) {
    case "page": case "database": return open({ kind: "page", id: h.refId }, { newTab });
    case "record": return h.parentId && open({ kind: "page", id: h.parentId }, { newTab });
    case "task": return open({ kind: "tasks" });
    case "project": return open({ kind: "project", id: h.refId }, { newTab });
    case "event": return open({ kind: "calendar" });
    case "attachment": return h.parentId ? open({ kind: "page", id: h.parentId }) : open({ kind: "files" });
    case "tag": return open({ kind: "search", sub: `#${h.refId}` });
  }
}

const KIND_ICON: Record<string, React.ReactNode> = {
  page: <FileText size={15} />, database: <Table2 size={15} />, record: <Table2 size={15} />, task: <CheckSquare size={15} />,
  project: <FolderKanban size={15} />, event: <CalendarDays size={15} />, attachment: <Paperclip size={15} />, tag: <Hash size={15} />,
};

interface Cmd { id: string; label: string; hint?: string; run: () => void | Promise<void> }

export function CommandPalette() {
  const { paletteOpen, paletteMode, set, workspaceId } = useApp();
  const shortcuts = useSettings((s) => s.s.shortcuts);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<string[]>(() => JSON.parse(localStorage.getItem("rea.recentSearches") ?? "[]") as string[]);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => { set("paletteOpen", false); setQ(""); setSel(0); };

  const commands: Cmd[] = useMemo(() => {
    const st = useApp.getState();
    const nav = (kind: RouteKind, label: string): Cmd => ({ id: `go-${kind}`, label: `Go to ${label}`, run: () => st.open({ kind }) });
    return [
      { id: "new-page", label: "New page", hint: shortcutLabel(shortcuts.newPage ?? ""), run: async () => { const p = await repo.createPage(workspaceId!, null); st.open({ kind: "page", id: p.id }); } },
      { id: "digest-today", label: "Today's digest", run: () => useDigest.getState().show("today") },
      { id: "digest-week", label: "Weekly digest", run: () => useDigest.getState().show("week") },
      { id: "new-db", label: "New database", run: async () => { const { page } = await repo.createDatabase(workspaceId!, null); st.open({ kind: "page", id: page.id }); } },
      { id: "new-task", label: "New task", run: async () => { await repo.createTask(workspaceId!, { title: q.replace(/^>\s*/, "") || "New task" }); st.open({ kind: "tasks" }); } },
      { id: "new-project", label: "New project", run: async () => { const p = await repo.createProject(workspaceId!, { status: "active" }); st.open({ kind: "project", id: p.id }); } },
      { id: "theme", label: "Toggle light / dark theme", hint: shortcutLabel(shortcuts.toggleTheme ?? ""), run: () => useSettings.getState().update((s) => ({ ...s, theme: resolvedDark(s.theme) ? "light" : "dark" })) },
      { id: "oled", label: "Use OLED black theme", run: () => useSettings.getState().update((s) => ({ ...s, theme: "oled" })) },
      { id: "focus", label: "Toggle focus mode", hint: shortcutLabel(shortcuts.focusMode ?? ""), run: () => st.set("focusMode", !st.focusMode) },
      { id: "sidebar", label: "Toggle sidebar", hint: shortcutLabel(shortcuts.toggleSidebar ?? ""), run: () => st.set("sidebarOpen", !st.sidebarOpen) },
      { id: "right", label: "Toggle right panel", hint: shortcutLabel(shortcuts.toggleRight ?? ""), run: () => st.set("rightOpen", !st.rightOpen) },
      { id: "backup", label: "Create workspace backup", run: () => st.open({ kind: "settings", sub: "backup" }) },
      { id: "import", label: "Import files…", run: () => st.open({ kind: "settings", sub: "import" }) },
      { id: "ai", label: "Ask Mindstone Intelligence", run: () => st.open({ kind: "ai" }) },
      nav("home", "Home"), nav("inbox", "Inbox"), nav("tasks", "Tasks"), nav("projects", "Projects"), nav("calendar", "Calendar"), nav("databases", "Databases"),
      nav("graph", "Knowledge graph"), nav("files", "Files"), nav("templates", "Templates"), nav("trash", "Trash"),
      { id: "settings", label: "Open settings", hint: shortcutLabel(shortcuts.settings ?? ""), run: () => st.open({ kind: "settings" }) },
      { id: "search", label: "Full search page", hint: shortcutLabel(shortcuts.search ?? ""), run: () => st.open({ kind: "search", sub: q }) },
    ];
  }, [workspaceId, shortcuts, q]);

  useEffect(() => {
    if (!paletteOpen || !workspaceId) return;
    let alive = true;
    void ensureSearchIndex(workspaceId).then(async () => {
      if (!alive) return;
      if (!q.trim()) {
        const pages = (await repo.livePages(workspaceId)).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 8);
        if (alive) setHits(pages.map((p) => ({ id: `page:${p.id}`, kind: p.kind === "database" ? "database" : "page", refId: p.id, title: `${p.icon ? p.icon + " " : ""}${p.title || "Untitled"}`, body: "", tags: "", score: 0, snippet: "" })));
      } else setHits(searchIndex.search(q.replace(/^>\s*/, ""), { limit: 30, kinds: paletteMode === "pages" ? ["page", "database"] : undefined }));
    });
    return () => { alive = false; };
  }, [q, paletteOpen, workspaceId, paletteMode]);

  const cmdMode = q.startsWith(">");
  const needle = q.replace(/^>\s*/, "").toLowerCase();
  const cmds = paletteMode === "pages" ? [] : commands.filter((c) => !needle || c.label.toLowerCase().includes(needle)).slice(0, cmdMode ? 30 : 5);
  const items: ({ t: "hit"; h: SearchHit } | { t: "cmd"; c: Cmd })[] = cmdMode ? cmds.map((c) => ({ t: "cmd" as const, c })) : [...hits.map((h) => ({ t: "hit" as const, h })), ...cmds.map((c) => ({ t: "cmd" as const, c }))];

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector("[data-sel=true]")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  if (!paletteOpen) return null;

  const run = async (i: number, newTab = false) => {
    const it = items[i];
    if (!it) return;
    if (q.trim() && !cmdMode) {
      const r = [q.trim(), ...recent.filter((x) => x !== q.trim())].slice(0, 6);
      setRecent(r);
      localStorage.setItem("rea.recentSearches", JSON.stringify(r));
    }
    close();
    if (it.t === "hit") openHit(it.h, newTab);
    else await it.c.run();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel anim-in w-[min(640px,94vw)] overflow-hidden shadow-[var(--shadow)]" role="dialog" aria-label="Command palette">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={17} className="text-faint" />
          <input autoFocus className="h-12 flex-1 bg-transparent text-[15px] outline-none" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={paletteMode === "pages" ? "Jump to a page…" : "Search pages, tasks, records… or type > for commands"}
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={`pi-${sel}`}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); void run(sel, e.ctrlKey); }
            }} />
        </div>
        {!q && recent.length > 0 && paletteMode === "all" && (
          <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">{recent.map((r) => <button key={r} className="btn h-6 text-[12px] text-muted" onClick={() => setQ(r)}><Clock size={12} />{r}</button>)}</div>
        )}
        <div ref={listRef} id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
          {!q && hits.length > 0 && <div className="label px-2 py-1">Recent pages</div>}
          {items.map((it, i) => (
            <button key={it.t === "hit" ? it.h.id : it.c.id} id={`pi-${i}`} role="option" aria-selected={i === sel} data-sel={i === sel}
              className={cx("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left", i === sel && "bg-hover")}
              onMouseMove={() => setSel(i)} onClick={(e) => void run(i, e.ctrlKey)}>
              {it.t === "hit" ? (
                <>
                  <span className="text-muted">{KIND_ICON[it.h.kind]}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px]"><Highlight text={it.h.title} q={needle} /></span>{it.h.snippet && <span className="block truncate text-[12px] text-faint"><Highlight text={it.h.snippet} q={needle} /></span>}</span>
                  <span className="text-[11px] capitalize text-faint">{it.h.kind}</span>
                </>
              ) : (
                <><ArrowRight size={15} className="text-muted" /><span className="flex-1 text-[13.5px]">{it.c.label}</span>{it.c.hint && <span className="kbd">{it.c.hint}</span>}</>
              )}
            </button>
          ))}
          {items.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">No matches</div>}
        </div>
        <div className="flex gap-3 border-t border-line px-3 py-1.5 text-[11px] text-faint"><span>↑↓ navigate</span><span>Enter open</span><span>Ctrl+Enter new tab</span><span>&gt; commands</span><span>Esc close</span></div>
      </div>
    </div>,
    document.body,
  );
}

export { db };
