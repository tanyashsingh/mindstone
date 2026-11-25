import { create } from "zustand";
import { uid } from "@/lib/util";

export type RouteKind =
  | "home" | "inbox" | "page" | "tasks" | "projects" | "project" | "calendar" | "graph" | "files" | "templates"
  | "ai" | "trash" | "settings" | "search" | "databases";
export interface Route { kind: RouteKind; id?: string; sub?: string }
export interface Tab { key: string; route: Route }

export type ThemeMode = "system" | "light" | "dark" | "oled";
export type SaveState = "saved" | "saving" | "unsaved" | "error";

export interface Toast { id: string; text: string; tone: "info" | "success" | "error"; action?: { label: string; run: () => void } }

const routeKey = (r: Route) => `${r.kind}:${r.id ?? ""}`;

interface AppState {
  workspaceId: string | null;
  tabs: Tab[];
  active: number;
  split: Route | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightOpen: boolean;
  rightTab: "outline" | "backlinks" | "properties" | "comments" | "activity" | "ai" | "related";
  paletteOpen: boolean;
  paletteMode: "all" | "pages";
  focusMode: boolean;
  saveState: SaveState;
  online: boolean;
  stats: { words: number; chars: number } | null;
  toasts: Toast[];
  selectedText: string; // last editor selection, for the AI assistant

  setWorkspace(id: string): void;
  open(route: Route, opts?: { newTab?: boolean; split?: boolean }): void;
  closeTab(i: number): void;
  setActive(i: number): void;
  closeSplit(): void;
  set<K extends keyof AppState>(k: K, v: AppState[K]): void;
  toast(text: string, tone?: Toast["tone"], action?: Toast["action"]): void;
  dismissToast(id: string): void;
}

export const useApp = create<AppState>((set, get) => ({
  workspaceId: null,
  tabs: [{ key: "home:", route: { kind: "home" } }],
  active: 0,
  split: null,
  sidebarOpen: true,
  sidebarWidth: 260,
  rightOpen: false,
  rightTab: "outline",
  paletteOpen: false,
  paletteMode: "all",
  focusMode: false,
  saveState: "saved",
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  stats: null,
  toasts: [],
  selectedText: "",

  setWorkspace: (id) => set({ workspaceId: id, tabs: [{ key: "home:", route: { kind: "home" } }], active: 0, split: null }),
  open: (route, opts) => {
    if (opts?.split) return set({ split: route });
    const { tabs, active } = get();
    const key = routeKey(route);
    const existing = tabs.findIndex((t) => t.key === key);
    if (existing >= 0) return set({ active: existing, tabs: tabs.map((t, i) => (i === existing ? { ...t, route } : t)) });
    if (opts?.newTab || tabs.length === 0) return set({ tabs: [...tabs, { key, route }], active: tabs.length });
    const next = [...tabs];
    next[active] = { key, route };
    set({ tabs: next });
  },
  closeTab: (i) => {
    const tabs = get().tabs.filter((_, j) => j !== i);
    if (tabs.length === 0) tabs.push({ key: "home:", route: { kind: "home" } });
    const active = Math.min(get().active > i ? get().active - 1 : get().active, tabs.length - 1);
    set({ tabs, active });
  },
  setActive: (i) => set({ active: i }),
  closeSplit: () => set({ split: null }),
  set: (k, v) => set({ [k]: v } as Partial<AppState>),
  toast: (text, tone = "info", action) => {
    const id = uid();
    set({ toasts: [...get().toasts, { id, text, tone, action }].slice(-4) });
    setTimeout(() => get().dismissToast(id), action ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const currentRoute = () => {
  const s = useApp.getState();
  return s.tabs[s.active]?.route ?? { kind: "home" as const };
};
