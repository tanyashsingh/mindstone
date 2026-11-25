import { lazy, Suspense, useEffect, useState } from "react";
import { X, Columns2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { bootstrap } from "./bootstrap";
import { useApp, type Route } from "./store/app";
import { resolvedDark, useSettings } from "./store/settings";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { RightPanel } from "./components/RightPanel";
import { DialogHost, Skeleton } from "./components/ui";
import { Toasts } from "./components/Toasts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { db } from "./data/db";
import { createPage, setSetting } from "./data/repo";
import { matchShortcut } from "./lib/shortcuts";
import { cx } from "./lib/util";
import { startReminders } from "./lib/reminders";

const PageView = lazy(() => import("./views/PageView"));
const Home = lazy(() => import("./views/Home"));
const Tasks = lazy(() => import("./views/Tasks"));
const Projects = lazy(() => import("./views/Projects"));
const CalendarView = lazy(() => import("./views/Calendar"));
const Graph = lazy(() => import("./views/Graph"));
const Files = lazy(() => import("./views/Files"));
const Templates = lazy(() => import("./views/Templates"));
const AiView = lazy(() => import("./views/AiView"));
const Trash = lazy(() => import("./views/Trash"));
const SettingsView = lazy(() => import("./views/Settings"));
const SearchView = lazy(() => import("./views/SearchView"));
const Inbox = lazy(() => import("./views/Inbox"));
const Databases = lazy(() => import("./views/Databases"));

export function RouteView({ route, pane }: { route: Route; pane: "main" | "split" }) {
  const el = (() => {
    switch (route.kind) {
      case "home": return <Home />;
      case "page": return route.id ? <PageView pageId={route.id} pane={pane} /> : null;
      case "tasks": return <Tasks />;
      case "projects": return <Projects />;
      case "project": return <Projects projectId={route.id} />;
      case "calendar": return <CalendarView />;
      case "graph": return <Graph focusId={route.id} />;
      case "files": return <Files />;
      case "templates": return <Templates />;
      case "ai": return <AiView />;
      case "trash": return <Trash />;
      case "settings": return <SettingsView section={route.sub} />;
      case "search": return <SearchView initial={route.sub} />;
      case "inbox": return <Inbox />;
      case "databases": return <Databases />;
    }
  })();
  return (
    <ErrorBoundary label="this view" key={`${route.kind}:${route.id ?? ""}`}>
      <Suspense fallback={<div className="mx-auto max-w-3xl p-12"><Skeleton lines={6} /></div>}>{el}</Suspense>
    </ErrorBoundary>
  );
}

function TabBar() {
  const { tabs, active, setActive, closeTab } = useApp();
  const titles = useLiveQuery(async () => {
    const ids = tabs.filter((t) => t.route.kind === "page").map((t) => t.route.id!);
    const pages = await db().pages.bulkGet(ids);
    return Object.fromEntries(pages.filter(Boolean).map((p) => [p!.id, `${p!.icon ? p!.icon + " " : ""}${p!.title || "Untitled"}`]));
  }, [tabs]);
  const label = (r: Route) => r.kind === "page" ? titles?.[r.id!] ?? "…" : r.kind === "project" ? "Project" : r.kind[0]!.toUpperCase() + r.kind.slice(1);
  if (tabs.length < 2) return null;
  return (
    <div role="tablist" className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-line bg-sunken px-1.5">
      {tabs.map((t, i) => (
        <div key={t.key + i} role="tab" aria-selected={i === active}
          onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } else setActive(i); }}
          className={cx("group flex h-8 max-w-[200px] min-w-[110px] items-center gap-1 rounded-t-md px-2.5 text-[12.5px]", i === active ? "bg-bg text-fg border border-b-0 border-line" : "text-muted hover:bg-hover")}>
          <span className="flex-1 truncate">{label(t.route)}</span>
          <button className="opacity-0 group-hover:opacity-100 rounded hover:bg-active p-0.5" aria-label="Close tab" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeTab(i)}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const app = useApp();
  const { s, loaded, load, update } = useSettings();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await load();
        const ws = await bootstrap();
        useApp.getState().setWorkspace(ws);
        setReady(true);
        startReminders();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [load]);

  // Theme, accent, editor typography
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      root.classList.toggle("dark", resolvedDark(s.theme));
      root.classList.toggle("oled", s.theme === "oled");
      root.classList.toggle("reduce-motion", s.reduceMotion);
      root.style.setProperty("--accent", s.accent);
      root.style.setProperty("--editor-font", `var(--font-${s.editorFont})`);
      root.style.setProperty("--editor-size", `${s.editorSize}px`);
    };
    apply();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [s.theme, s.accent, s.reduceMotion, s.editorFont, s.editorSize]);

  useEffect(() => {
    const on = () => useApp.getState().set("online", true), off = () => useApp.getState().set("online", false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);

  useEffect(() => { if (app.workspaceId) void setSetting("lastWorkspace", app.workspaceId); }, [app.workspaceId]);

  // Global shortcuts
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const sc = useSettings.getState().s.shortcuts;
      const st = useApp.getState();
      const hit = (name: string) => matchShortcut(e, sc[name] ?? "");
      if (hit("palette")) { e.preventDefault(); st.set("paletteMode", "all"); st.set("paletteOpen", !st.paletteOpen); }
      else if (hit("quickOpen")) { e.preventDefault(); st.set("paletteMode", "pages"); st.set("paletteOpen", true); }
      else if (hit("search")) { e.preventDefault(); st.open({ kind: "search" }); }
      else if (hit("newPage") && st.workspaceId) { e.preventDefault(); const p = await createPage(st.workspaceId, null); st.open({ kind: "page", id: p.id }); }
      else if (hit("settings")) { e.preventDefault(); st.open({ kind: "settings" }); }
      else if (hit("toggleTheme")) { e.preventDefault(); update((x) => ({ ...x, theme: resolvedDark(x.theme) ? "light" : "dark" })); }
      else if (hit("toggleSidebar")) { e.preventDefault(); st.set("sidebarOpen", !st.sidebarOpen); }
      else if (hit("toggleRight")) { e.preventDefault(); st.set("rightOpen", !st.rightOpen); }
      else if (hit("focusMode")) { e.preventDefault(); st.set("focusMode", !st.focusMode); }
      else if (hit("save")) { e.preventDefault(); window.dispatchEvent(new CustomEvent("rea:save-now")); }
      else if (hit("newWindow")) { e.preventDefault(); if (window.rea) void window.rea.newWindow(); else window.open(location.href, "_blank", "noopener"); }
      else if (e.ctrlKey && e.key === "Tab") { e.preventDefault(); st.setActive((st.active + (e.shiftKey ? -1 : 1) + st.tabs.length) % st.tabs.length); }
      else if (e.ctrlKey && e.key.toLowerCase() === "w" && st.tabs.length > 1) { e.preventDefault(); st.closeTab(st.active); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [update]);

  if (error) return <div className="p-10 text-danger">REA could not open its local database: {error}</div>;
  if (!ready || !loaded) return <div className="flex h-full items-center justify-center text-muted">Opening workspace…</div>;
  const route = app.tabs[app.active]?.route ?? { kind: "home" };

  return (
    <div className={cx("flex h-full flex-col", app.focusMode && "focus-mode")}>
      <div className="flex min-h-0 flex-1">
        {app.sidebarOpen && !app.focusMode && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          {!app.focusMode && <TabBar />}
          <div className="flex min-h-0 flex-1">
            <section className="min-w-0 flex-1 overflow-auto" aria-label="Main view">
              <RouteView route={route} pane="main" />
            </section>
            {app.split && (
              <section className="relative min-w-0 flex-1 overflow-auto border-l border-line" aria-label="Split view">
                <button className="icon-btn absolute right-2 top-2 z-10" title="Close split view" onClick={app.closeSplit}><Columns2 size={15} /></button>
                <RouteView route={app.split} pane="split" />
              </section>
            )}
          </div>
        </main>
        {app.rightOpen && !app.focusMode && <RightPanel />}
      </div>
      {!app.focusMode && <StatusBar />}
      <CommandPalette />
      <DialogHost />
      <Toasts />
    </div>
  );
}
