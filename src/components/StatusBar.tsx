import { Cloud, CloudOff, Check, Loader2, AlertCircle, PanelLeft, Sparkles, HardDrive } from "lucide-react";
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { useSync } from "@/sync/service";
import { relTime } from "@/lib/util";
import { PROVIDER_LABELS } from "@/ai/providers";

export function StatusBar() {
  const { saveState, online, stats, sidebarOpen, set } = useApp();
  const ai = useSettings((x) => x.s.ai);
  const save = {
    saved: { icon: <Check size={12} />, text: "Saved locally" },
    saving: { icon: <Loader2 size={12} className="animate-spin" />, text: "Saving…" },
    unsaved: { icon: <span className="size-1.5 rounded-full bg-warning" />, text: "Unsaved changes" },
    error: { icon: <AlertCircle size={12} className="text-danger" />, text: "Save failed: changes kept in memory" },
  }[saveState];
  const provider = ai.active === "none" ? "AI off" : `${PROVIDER_LABELS[ai.active]} · ${ai.providers[ai.active].model}`;
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-sunken px-4 text-caption text-muted" role="status">
      {!sidebarOpen && <button className="icon-btn size-5" title="Show sidebar" onClick={() => set("sidebarOpen", true)}><PanelLeft size={13} /></button>}
      <span className="flex items-center gap-1">{save.icon}{save.text}</span>
      {stats && <span>{stats.words.toLocaleString()} words · {stats.chars.toLocaleString()} characters</span>}
      <span className="flex-1" />
      <span className="flex items-center gap-1" title="Data is stored on this device in IndexedDB"><HardDrive size={12} /> Local</span>
      <SyncStatus />
      <span className="flex items-center gap-1">{online ? <Cloud size={12} /> : <CloudOff size={12} className="text-warning" />}{online ? "Online" : "Offline: everything local still works"}</span>
      <button className="flex items-center gap-1 hover:text-fg" onClick={() => useApp.getState().open({ kind: "settings", sub: "ai" })}><Sparkles size={12} />{provider}</button>
    </footer>
  );
}

function SyncStatus() {
  const { config, busy, lastSync, lastError } = useSync();
  const open = () => { const a = useApp.getState(); a.open({ kind: "settings", sub: "sync" }); };
  if (!config) return <button className="flex items-center gap-1 hover:text-fg" title="Sync between your devices is not set up" onClick={open}>Sync: off</button>;
  return <button className={lastError ? "text-danger hover:underline" : "hover:text-fg"} title={lastError || "Synced through your encrypted sync space"} onClick={open} data-testid="sync-indicator">
    Sync: {busy ? "syncing…" : lastError ? "error" : lastSync ? relTime(lastSync) : "on"}
  </button>;
}
