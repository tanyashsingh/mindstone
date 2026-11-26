import { create } from "zustand";
import { getSetting, setSetting } from "@/data/repo";
import type { AiProviderId } from "@/data/types";
import type { ThemeMode } from "./app";

export interface AiProviderConfig { enabled: boolean; model: string; baseUrl: string; embedModel: string }
export interface Settings {
  theme: ThemeMode;
  accent: string;
  editorFont: "sans" | "serif" | "mono";
  editorSize: number;
  editorWidth: "narrow" | "normal" | "wide";
  spellcheck: boolean;
  reduceMotion: boolean;
  weekStartsOn: 0 | 1;
  autosaveMs: number;
  notifications: boolean;
  telemetry: boolean; // always off by default; Mindstone ships no telemetry endpoint
  ai: {
    active: AiProviderId | "none";
    allowCloud: boolean; // must be explicitly enabled before workspace content leaves the device
    confirmWorkspaceContext: boolean;
    providers: Record<AiProviderId, AiProviderConfig>;
    limits: { maxRequestsPerMinute: number; dailyTokenBudget: number }; // cloud providers only; 0 = unlimited
  };
  backup: { auto: boolean }; // desktop: daily local backups
  ocr: { auto: boolean }; // recognise text in images and scanned PDFs when they are added
  digest: { daily: boolean }; // show today's digest on the first start of each day
  updates: { auto: boolean }; // desktop: check GitHub Releases for new versions
  voice: { language: string; systemAudio: boolean; summaries: "active" | "local" }; // language "" = detect automatically; summaries "local" = always use Ollama
  shortcuts: Record<string, string>;
}

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  palette: "mod+k",
  quickOpen: "mod+p",
  newPage: "mod+n",
  save: "mod+s",
  search: "mod+shift+f",
  toggleTheme: "mod+shift+l",
  settings: "mod+,",
  toggleSidebar: "mod+\\",
  toggleRight: "mod+shift+\\",
  focusMode: "mod+shift+enter",
  newWindow: "mod+shift+n",
  dictate: "mod+shift+m",
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  accent: "", // "" = the theme's own accent: ink in light, brass in dark
  editorFont: "sans",
  editorSize: 16,
  editorWidth: "normal",
  spellcheck: true,
  reduceMotion: false,
  weekStartsOn: 1,
  autosaveMs: 600,
  notifications: true,
  telemetry: false,
  ai: {
    active: "none",
    allowCloud: false,
    confirmWorkspaceContext: true,
    providers: {
      anthropic: { enabled: false, model: "claude-opus-5-5", baseUrl: "https://api.anthropic.com", embedModel: "" },
      openai: { enabled: false, model: "gpt-5", baseUrl: "https://api.openai.com/v1", embedModel: "text-embedding-3-small" },
      gemini: { enabled: false, model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta", embedModel: "text-embedding-004" },
      ollama: { enabled: false, model: "llama3.2", baseUrl: "http://localhost:11434", embedModel: "nomic-embed-text" },
      openaiCompatible: { enabled: false, model: "", baseUrl: "http://localhost:1234/v1", embedModel: "" },
    },
    limits: { maxRequestsPerMinute: 20, dailyTokenBudget: 300_000 },
  },
  backup: { auto: true },
  ocr: { auto: true },
  digest: { daily: false },
  updates: { auto: true },
  voice: { language: "", systemAudio: false, summaries: "active" },
  shortcuts: DEFAULT_SHORTCUTS,
};

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(base)) return (over as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

interface SettingsState {
  s: Settings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: (s: Settings) => Settings): void;
  reset(): void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  s: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const stored = await getSetting<unknown>("settings", null);
    const s = merge(DEFAULT_SETTINGS, stored);
    if (s.accent === "#4f5bd5") s.accent = ""; // the pre-editorial default becomes "theme default"
    set({ s, loaded: true });
  },
  update: (fn) => {
    const s = fn(structuredClone(get().s));
    set({ s });
    void setSetting("settings", s);
  },
  reset: () => {
    set({ s: DEFAULT_SETTINGS });
    void setSetting("settings", DEFAULT_SETTINGS);
  },
}));

export function resolvedDark(theme: ThemeMode): boolean {
  if (theme === "dark" || theme === "oled") return true;
  if (theme === "light") return false;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}
