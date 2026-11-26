import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Settings as Gear, KeyRound, Check, Loader2 } from "lucide-react";
import { db, DB_SCHEMA_VERSION } from "@/data/db";
import { createBackup, restoreBackup, validateBackup, BACKUP_VERSION } from "@/data/backup";
import { exportWorkspaceMarkdown, importFiles } from "@/data/portability";
import type { AiProviderId } from "@/data/types";
import { useApp } from "@/store/app";
import { DEFAULT_SHORTCUTS, useSettings, type Settings } from "@/store/settings";
import { PROVIDER_LABELS, NEEDS_KEY, LOCAL_PROVIDERS } from "@/ai/providers";
import { chat, deleteApiKey, hasApiKey, listModels, setApiKey, spendGuard } from "@/ai/client";
import { runAutoBackups } from "@/lib/autoBackup";
import { RESERVED, shortcutLabel } from "@/lib/shortcuts";
import { Toggle, confirmDialog } from "@/components/ui";
import { cx, downloadBlob, fmtBytes, safeFileName } from "@/lib/util";
import cairnMark from "@/assets/mindstone-mark.png";

const SECTIONS = [
  ["general", "General"], ["appearance", "Appearance"], ["editor", "Editor"], ["workspace", "Workspace"], ["notifications", "Notifications"], ["voice", "Voice"], ["shortcuts", "Keyboard shortcuts"],
  ["ai", "Artificial intelligence"], ["providers", "AI providers"], ["privacy", "Privacy"], ["security", "Security"], ["storage", "Storage"], ["backup", "Backup & restore"],
  ["import", "Import & export"], ["integrations", "Integrations"], ["sync", "Synchronization"], ["accessibility", "Accessibility"], ["about", "About Mindstone"],
] as const;

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-3">
      <div className="flex-1"><div className="text-[13.5px]">{label}</div>{desc && <div className="text-[12px] text-muted">{desc}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ProviderCard({ id }: { id: AiProviderId }) {
  const { s, update } = useSettings();
  const cfg = s.ai.providers[id];
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void hasApiKey(id).then(setHasKey); }, [id]);
  const set = (patch: Partial<typeof cfg>) => update((x) => ({ ...x, ai: { ...x.ai, providers: { ...x.ai.providers, [id]: { ...x.ai.providers[id], ...patch } } } }));
  return (
    <div className="panel mb-3 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex-1 font-medium">{PROVIDER_LABELS[id]}</span>
        {LOCAL_PROVIDERS.includes(id) ? <span className="chip c-green">Runs locally</span> : <span className="chip c-orange">Cloud</span>}
        <label className="flex items-center gap-2 text-[13px]"><input type="radio" name="active-ai" checked={s.ai.active === id} onChange={() => update((x) => ({ ...x, ai: { ...x.ai, active: id } }))} /> Use</label>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[13px]">
        <label>Model<input className="input mt-1" list={`models-${id}`} value={cfg.model} onChange={(e) => set({ model: e.target.value })} /><datalist id={`models-${id}`}>{models.map((m) => <option key={m} value={m} />)}</datalist></label>
        <label>Endpoint<input className="input mt-1" value={cfg.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></label>
        <label>Embedding model {id === "anthropic" && <span className="text-faint">(Claude has none)</span>}<input className="input mt-1" disabled={id === "anthropic"} value={cfg.embedModel} onChange={(e) => set({ embedModel: e.target.value })} /></label>
        {NEEDS_KEY[id] && (
          <label>API key {hasKey && <span className="text-success">· stored</span>}
            <div className="mt-1 flex gap-1">
              <input className="input" type="password" autoComplete="off" placeholder={hasKey ? "••••••••" : "Paste key"} value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn-outline" disabled={!key} onClick={async () => { await setApiKey(id, key.trim()); setKey(""); setHasKey(true); }}>Save</button>
              {hasKey && <button className="btn-danger" onClick={async () => { await deleteApiKey(id); setHasKey(false); }}>Remove</button>}
            </div>
          </label>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className="btn-outline" disabled={busy} onClick={async () => {
          setBusy(true); setStatus(null);
          try { const m = await listModels(id); setModels(m); setStatus({ ok: true, text: `Connected · ${m.length} models available` }); }
          catch (e) { setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
        }}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}Test connection</button>
        {s.ai.active === id && <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true); setStatus(null);
          try { const r = await chat("Reply with one short sentence.", [{ role: "user", content: "Say hello from Mindstone." }], () => {}); setStatus({ ok: true, text: `“${r.text.trim().slice(0, 80)}” · ${r.inputTokens + r.outputTokens} tokens` }); }
          catch (e) { setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
        }}>Send test message</button>}
        {status && <span className={cx("text-[12px]", status.ok ? "text-success" : "text-danger")}>{status.text}</span>}
      </div>
      {id === "ollama" && <p className="mt-2 text-[12px] text-faint">Install Ollama, run <code>ollama pull {cfg.model || "llama3.2"}</code> and <code>ollama pull nomic-embed-text</code>. In the browser build, also allow this origin with OLLAMA_ORIGINS.</p>}
    </div>
  );
}

function ShortcutEditor() {
  const { s, update } = useSettings();
  const [recording, setRecording] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      if (e.key === "Escape") return setRecording(null);
      const spec = [e.ctrlKey || e.metaKey ? "mod" : "", e.shiftKey ? "shift" : "", e.altKey ? "alt" : "", e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()].filter(Boolean).join("+");
      if (RESERVED.includes(spec)) { useApp.getState().toast(`${shortcutLabel(spec)} is reserved by the editor or system`, "error"); return setRecording(null); }
      const clash = Object.entries(s.shortcuts).find(([k, v]) => v === spec && k !== recording);
      if (clash) { useApp.getState().toast(`${shortcutLabel(spec)} is already used by “${clash[0]}”`, "error"); return setRecording(null); }
      update((x) => ({ ...x, shortcuts: { ...x.shortcuts, [recording]: spec } }));
      setRecording(null);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [recording, s.shortcuts, update]);
  return (
    <>
      {Object.entries(DEFAULT_SHORTCUTS).map(([name]) => (
        <Row key={name} label={name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}>
          <button className={cx("kbd h-7 px-2", recording === name && "ring-2 ring-accent")} onClick={() => setRecording(name)}>{recording === name ? "Press keys… (Esc to cancel)" : shortcutLabel(s.shortcuts[name] ?? "")}</button>
        </Row>
      ))}
      <Row label="Editor shortcuts" desc="Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · Ctrl+Z / Ctrl+Shift+Z undo/redo · Ctrl+F find · Ctrl+H replace · Ctrl+D duplicate block · Alt+Shift+↑/↓ move block · Ctrl+Shift+K delete block"><span /></Row>
      <button className="btn mt-3" onClick={() => update((x) => ({ ...x, shortcuts: DEFAULT_SHORTCUTS }))}>Reset shortcuts</button>
    </>
  );
}

export default function SettingsView({ section }: { section?: string }) {
  const [sec, setSec] = useState<string>(section ?? "general");
  useEffect(() => { if (section) setSec(section); }, [section]);
  const { s, update, reset } = useSettings();
  const ws = useApp((x) => x.workspaceId)!;
  const workspace = useLiveQuery(() => db().workspaces.get(ws), [ws]);
  const counts = useLiveQuery(async () => ({
    pages: await db().pages.where("workspaceId").equals(ws).count(), tasks: await db().tasks.where("workspaceId").equals(ws).count(),
    records: await db().records.count(), files: await db().attachments.where("workspaceId").equals(ws).count(),
  }), [ws]);
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [dataPath, setDataPath] = useState("");
  const [secure, setSecure] = useState<boolean | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then(setEst);
    void navigator.storage?.persisted?.().then(setPersisted);
    if (window.rea) { void window.rea.dataPath().then(setDataPath); void window.rea.secrets.available().then(setSecure); }
  }, []);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update((x) => ({ ...x, [k]: v }));
  const runImport = async (files: File[]) => {
    if (!files.length) return;
    const r = await importFiles(ws, files);
    useApp.getState().toast(`Imported ${r.pages} pages and ${r.databases} databases${r.skipped.length ? `; skipped ${r.skipped.length}` : ""}`, r.skipped.length ? "info" : "success");
    if (r.skipped.length || r.notes.length) await confirmDialog("Import summary", [...r.notes, ...r.skipped.map((x) => `Skipped: ${x}`)].join("\n"), { confirmLabel: "OK" });
  };

  return (
    <div className="flex h-full">
      <nav className="w-56 shrink-0 overflow-y-auto border-r border-line p-3" aria-label="Settings sections">
        <div className="mb-3 flex items-center gap-2 px-2 font-semibold"><Gear size={16} /> Settings</div>
        {SECTIONS.map(([id, label]) => <button key={id} className={cx("menu-item", sec === id && "bg-active")} onClick={() => setSec(id)}>{label}</button>)}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
        <div className="max-w-2xl">
          <h1 className="mb-4 text-[22px] font-bold">{SECTIONS.find(([id]) => id === sec)?.[1]}</h1>
          {sec === "general" && <>
            <Row label="Week starts on"><select className="input w-32" value={s.weekStartsOn} onChange={(e) => set("weekStartsOn", Number(e.target.value) as 0 | 1)}><option value={1}>Monday</option><option value={0}>Sunday</option></select></Row>
            <Row label="Reset all settings" desc="Restores defaults. Your pages and data are not touched."><button className="btn-outline" onClick={async () => { if (await confirmDialog("Reset all settings to defaults?")) reset(); }}>Reset</button></Row>
          </>}
          {sec === "appearance" && <>
            <Row label="Theme"><div className="flex gap-0.5 rounded-[10px] bg-sunken p-0.5 shadow-[var(--inset)]">{(["system", "light", "dark", "oled"] as const).map((t) => <button key={t} className={cx("btn h-6 capitalize", s.theme === t && "bg-active")} onClick={() => set("theme", t)}>{t === "oled" ? "OLED black" : t}</button>)}</div></Row>
            <Row label="Accent colour" desc="Theme default is ink in light mode and brass in dark mode."><div className="flex items-center gap-1.5">
              <button aria-label="Theme default" title="Theme default" className={cx("size-6 rounded-full", !s.accent && "ring-2 ring-offset-2 ring-fg")} style={{ background: "linear-gradient(135deg, #1f2a44 50%, #c9a96e 50%)" }} onClick={() => set("accent", "")} />
              {["#2c5d4f", "#7a3b2e", "#4b3f72", "#2f5d8a", "#8a6a2f"].map((c) => <button key={c} aria-label={c} className={cx("size-6 rounded-full", s.accent === c && "ring-2 ring-offset-2 ring-fg")} style={{ background: c }} onClick={() => set("accent", c)} />)}
              <input type="color" value={s.accent || "#1f2a44"} onChange={(e) => set("accent", e.target.value)} aria-label="Custom accent" /></div></Row>
            <Row label="Page width"><select className="input w-32" value={s.editorWidth} onChange={(e) => set("editorWidth", e.target.value as Settings["editorWidth"])}><option value="narrow">Narrow</option><option value="normal">Normal</option><option value="wide">Wide</option></select></Row>
          </>}
          {sec === "editor" && <>
            <Row label="Font"><select className="input w-32" value={s.editorFont} onChange={(e) => set("editorFont", e.target.value as Settings["editorFont"])}><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option></select></Row>
            <Row label="Font size"><input type="range" min={13} max={22} value={s.editorSize} onChange={(e) => set("editorSize", Number(e.target.value))} aria-label="Font size" /> <span className="ml-2 tabular-nums">{s.editorSize}px</span></Row>
            <Row label="Spell check"><Toggle checked={s.spellcheck} onChange={(v) => set("spellcheck", v)} label="Spell check" /></Row>
            <Row label="Autosave delay" desc="How long after you stop typing before changes are written to disk. An unsaved-draft copy is kept for crash recovery."><select className="input w-32" value={s.autosaveMs} onChange={(e) => set("autosaveMs", Number(e.target.value))}>{[300, 600, 1000, 2000].map((m) => <option key={m} value={m}>{m} ms</option>)}</select></Row>
          </>}
          {sec === "workspace" && <>
            <Row label="Workspace name"><input className="input w-56" key={workspace?.id} defaultValue={workspace?.name} onBlur={(e) => e.target.value && db().workspaces.update(ws, { name: e.target.value, updatedAt: Date.now() })} /></Row>
            <Row label="Contents" desc={counts ? `${counts.pages} pages · ${counts.tasks} tasks · ${counts.files} files` : ""}><span /></Row>
          </>}
          {sec === "notifications" && <Row label="Desktop notifications" desc="Task reminders, event reminders and focus-timer alerts. Shown in-app as well."><Toggle checked={s.notifications} onChange={(v) => set("notifications", v)} label="Notifications" /></Row>}
          {sec === "voice" && <>
            <Row label="Transcription language" desc="Detecting automatically works for most recordings; choose a language if words come out translated or garbled.">
              <select className="input w-48" value={s.voice.language} onChange={(e) => update((x) => ({ ...x, voice: { ...x.voice, language: e.target.value } }))}>
                {[["", "Detect automatically"], ["en", "English"], ["hi", "Hindi"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["ja", "Japanese"], ["zh", "Chinese"], ["ar", "Arabic"], ["bn", "Bengali"], ["ta", "Tamil"], ["te", "Telugu"], ["mr", "Marathi"], ["ur", "Urdu"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
            {window.rea && <Row label="Include computer audio by default" desc="For meeting notes: also record what your computer plays, such as the other people on a call. You can change it per recording."><Toggle checked={s.voice.systemAudio} onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, systemAudio: v } }))} label="Include computer audio" /></Row>}
            <Row label="Speech model" desc="Whisper base (OpenAI, Apache-2.0), running on this computer. Audio and transcripts never leave your device."><span className="text-[12px] text-faint">Built in</span></Row>
            <p className="mt-3 text-[12.5px] text-muted">Dictate with Ctrl+Shift+M or the microphone button on a page. Type /voice note or /meeting notes to record, then transcribe and summarize. Transcripts are searchable with Ctrl+K and used by Mindstone Intelligence.</p>
          </>}
          {sec === "shortcuts" && <ShortcutEditor />}
          {sec === "ai" && <>
            <Row label="Active provider" desc="Mindstone works fully without AI."><select className="input w-56" value={s.ai.active} onChange={(e) => update((x) => ({ ...x, ai: { ...x.ai, active: e.target.value as Settings["ai"]["active"] } }))}><option value="none">Off</option>{(Object.keys(PROVIDER_LABELS) as AiProviderId[]).map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}</select></Row>
            <Row label="Allow cloud AI providers" desc="Off by default. While off, nothing is sent to Claude, OpenAI or Gemini; local models still work."><Toggle checked={s.ai.allowCloud} onChange={(v) => update((x) => ({ ...x, ai: { ...x.ai, allowCloud: v } }))} label="Allow cloud AI" /></Row>
            <Row label="Ask before sending workspace content" desc="Confirm each time page excerpts are attached to a cloud request."><Toggle checked={s.ai.confirmWorkspaceContext} onChange={(v) => update((x) => ({ ...x, ai: { ...x.ai, confirmWorkspaceContext: v } }))} label="Confirm context" /></Row>
            <Row label="Cloud requests per minute" desc="Stops runaway loops from running up your bill. 0 means no limit. Local models are never limited."><input type="number" min={0} max={600} className="input w-24" aria-label="Cloud requests per minute" value={s.ai.limits.maxRequestsPerMinute} onChange={(e) => update((x) => ({ ...x, ai: { ...x.ai, limits: { ...x.ai.limits, maxRequestsPerMinute: Math.max(0, Math.round(Number(e.target.value) || 0)) } } }))} /></Row>
            <Row label="Daily cloud token budget" desc={`Cloud AI stops for the day once this many tokens are used. 0 means no limit. Used today: ${spendGuard.usage().tokens.toLocaleString()}.`}><input type="number" min={0} step={10000} className="input w-32" aria-label="Daily cloud token budget" value={s.ai.limits.dailyTokenBudget} onChange={(e) => update((x) => ({ ...x, ai: { ...x.ai, limits: { ...x.ai.limits, dailyTokenBudget: Math.max(0, Math.round(Number(e.target.value) || 0)) } } }))} /></Row>
            <p className="mt-3 text-[12.5px] text-muted">AI never edits your pages directly. Writing tools show a preview first, and inserted text can be undone with Ctrl+Z. Creating tasks from AI replies asks for confirmation. Imported documents are passed to models as quoted data, not instructions.</p>
          </>}
          {sec === "providers" && (Object.keys(PROVIDER_LABELS) as AiProviderId[]).map((p) => <ProviderCard key={p} id={p} />)}
          {sec === "privacy" && <>
            <Row label="Telemetry" desc="Mindstone contains no analytics or telemetry. This switch exists so the choice is explicit; it stays off."><Toggle checked={false} onChange={() => useApp.getState().toast("Mindstone does not collect telemetry", "info")} label="Telemetry" /></Row>
            <p className="text-[12.5px] text-muted">Your data lives in this device's local database. Network requests happen only for AI providers you enable. External calendar accounts are never accessed.</p>
          </>}
          {sec === "security" && <>
            <Row label="API key storage" desc={window.rea ? (secure ? "Keys are encrypted with Windows DPAPI (Electron safeStorage) and only the main process can read them." : "OS encryption is unavailable, so keys will not be saved.") : "Browser build: keys stay in memory for this tab and are forgotten on reload."}><KeyRound size={16} className="text-muted" /></Row>
            <Row label="Content security" desc="Rich text, Markdown, Mermaid and AI output are sanitised before rendering; links are limited to http, https and mailto; a strict Content Security Policy blocks remote scripts."><Check size={16} className="text-success" /></Row>
            <Row label="Encryption at rest" desc="Data is protected by your Windows account. Mindstone does not add its own encryption at rest or end-to-end encryption."><span /></Row>
          </>}
          {sec === "storage" && <>
            <Row label="Recognise text in images and scanned PDFs" desc="Runs on this computer when you add a picture or a PDF without a text layer, so search and AI can find their words. English. Uses no network."><Toggle checked={s.ocr.auto} onChange={(v) => update((x) => ({ ...x, ocr: { auto: v } }))} label="Automatic text recognition" /></Row>
            <Row label="Storage used" desc={est?.usage !== undefined ? `${fmtBytes(est.usage)} of ${fmtBytes(est.quota ?? 0)} available to Mindstone` : "Unavailable"}><span /></Row>
            <Row label="Persistent storage" desc="Prevents the browser from evicting data under storage pressure."><button className="btn-outline" disabled={!!persisted} onClick={async () => setPersisted((await navigator.storage?.persist?.()) ?? false)}>{persisted ? "Granted" : "Request"}</button></Row>
            {dataPath && <Row label="Data folder" desc={dataPath}><span /></Row>}
            <Row label="Database schema" desc={`Version ${DB_SCHEMA_VERSION}`}><span /></Row>
          </>}
          {sec === "backup" && <>
            {window.rea && <AutoBackupRows />}
            <Row label="Create backup" desc={`Complete workspace (pages, history, databases, tasks, events, files, AI chats) as one .rea.json file. Format version ${BACKUP_VERSION}.`}>
              <button className="btn-primary" onClick={async () => { const b = await createBackup(ws); downloadBlob(new Blob([JSON.stringify(b)], { type: "application/json" }), `${safeFileName(workspace?.name ?? "workspace")}-${new Date().toISOString().slice(0, 10)}.rea.json`); }}>Download backup</button>
            </Row>
            <Row label="Restore backup" desc="Restores a workspace from a backup file. If that workspace exists here, it is replaced after you confirm.">
              <button className="btn-outline" onClick={() => restoreInput.current?.click()}>Choose file…</button>
            </Row>
            <input ref={restoreInput} type="file" accept=".json,application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const raw = validateBackup(JSON.parse(await f.text()));
                const exists = !!(await db().workspaces.get(raw.workspace.id));
                if (exists && !(await confirmDialog(`Replace “${raw.workspace.name}”?`, `This backup is from ${new Date(raw.exportedAt).toLocaleString()}. The current copy of the workspace on this device will be deleted and replaced. This cannot be undone.`, { danger: true, confirmLabel: "Replace workspace" }))) return;
                const w = await restoreBackup(raw, { replace: exists });
                useApp.getState().setWorkspace(w.id);
                useApp.getState().toast(`Restored “${w.name}”`, "success");
              } catch (err) { useApp.getState().toast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`, "error"); }
            }} />
          </>}
          {sec === "import" && <>
            <Row label="Import files" desc="Markdown, HTML, plain text, CSV and JSON (array of records). Other files become attachments."><button className="btn-outline" onClick={() => importInput.current?.click()}>Choose files…</button></Row>
            <Row label="Import a folder" desc="An Obsidian vault or an unzipped Notion export. Folders become nested pages; [[wiki links]] keep working."><button className="btn-outline" onClick={() => folderInput.current?.click()}>Choose folder…</button></Row>
            <Row label="Export workspace as Markdown" desc="A .zip of Markdown pages (hierarchy preserved), CSV for each database, and attachments."><button className="btn-outline" onClick={() => exportWorkspaceMarkdown(ws)}>Export .zip</button></Row>
            <p className="mt-3 text-[12.5px] text-muted">Known limitations: Notion exports must be unzipped first; Notion database relations and formulas arrive as plain text; YAML front matter is not mapped to properties; Obsidian plugins' syntax (Dataview and others) stays as text. For a lossless copy, use Backup.</p>
            <input ref={importInput} type="file" multiple hidden accept=".md,.markdown,.txt,.html,.htm,.csv,.json,*/*" onChange={(e) => { void runImport([...(e.target.files ?? [])]); e.target.value = ""; }} />
            <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(e) => { void runImport([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </>}
          {sec === "integrations" && <>
            <Row label="Google Calendar" desc="Not connected. Connecting needs your explicit sign-in and an OAuth client configuration, which this build does not include."><button className="btn-outline" disabled>Not available</button></Row>
            <Row label="Microsoft Outlook" desc="Not connected, for the same reason. Use ICS import and export in Calendar meanwhile."><button className="btn-outline" disabled>Not available</button></Row>
          </>}
          {sec === "sync" && <p className="text-[13px] text-muted">Cloud sync and collaboration are off: no sync server is configured. Your workspace is stored only on this device. Every record carries a sortable ID and timestamps so a sync service can be added later without migrating data. Until then, use Backup to move workspaces between devices.</p>}
          {sec === "accessibility" && <>
            <Row label="Reduce motion" desc="Also follows your Windows animation setting automatically."><Toggle checked={s.reduceMotion} onChange={(v) => set("reduceMotion", v)} label="Reduce motion" /></Row>
            <Row label="Text size" desc="Editor font size; use Ctrl + / Ctrl − in the desktop app to zoom the whole interface."><input type="range" min={13} max={22} value={s.editorSize} onChange={(e) => set("editorSize", Number(e.target.value))} aria-label="Text size" /></Row>
          </>}
          {sec === "about" && <div className="space-y-2 text-[13px] text-muted">
            <img src={cairnMark} alt="Mindstone logo" width={96} height={96} className="mb-2" />
            <p><b className="text-fg">Mindstone</b> {__APP_VERSION__}. A local-first workspace for notes, tasks, databases and knowledge.</p>
            <p>Build your mind, stone by stone. Mindstone stacks your notes, tasks, recordings and knowledge into something that lasts: built by you, on your own computer.</p>
            <p>Runtime: {window.rea ? `Desktop (${window.rea.platform}, Electron ${window.rea.version})` : "Browser"} · Database schema v{DB_SCHEMA_VERSION} · Backup format v{BACKUP_VERSION}</p>
            <p>Built with React, TipTap (ProseMirror), Dexie (IndexedDB), MiniSearch, KaTeX and Mermaid.</p>
            {window.rea && <UpdateRows />}
          </div>}
        </div>
      </div>
    </div>
  );
}

function AutoBackupRows() {
  const { s, update } = useSettings();
  const [list, setList] = useState<{ name: string; size: number; at: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => void window.rea!.backup.list().then(setList);
  useEffect(refresh, []);
  return <>
    <Row label="Automatic daily backups" desc="Once a day, each workspace is saved to the backups folder inside Mindstone's data folder. The newest 14 per workspace are kept."><Toggle checked={s.backup.auto} onChange={(v) => update((x) => ({ ...x, backup: { auto: v } }))} label="Automatic backups" /></Row>
    <Row label="Local backups" desc={list === null ? "Loading…" : list.length ? `${list.length} saved · latest ${new Date(list[0]!.at).toLocaleString()} (${fmtBytes(list[0]!.size)})` : "None yet."}>
      <div className="flex gap-2">
        <button className="btn-outline" disabled={busy || !s.backup.auto} onClick={async () => { setBusy(true); try { const n = await runAutoBackups(true); useApp.getState().toast(`Saved ${n} backup${n === 1 ? "" : "s"}`, "success"); } finally { setBusy(false); refresh(); } }}>{busy ? <Loader2 size={14} className="animate-spin" /> : "Back up now"}</button>
        <button className="btn-outline" onClick={() => void window.rea!.backup.open()}>Open folder</button>
      </div>
    </Row>
  </>;
}

const UPDATE_TEXT: Record<ReaUpdateState["status"], string> = {
  idle: "Not checked yet.", checking: "Checking…", none: "You have the latest version.", downloading: "Downloading an update…",
  ready: "An update is ready.", error: "The last check failed.", disabled: "",
};

function UpdateRows() {
  const { s, update } = useSettings();
  const [st, setSt] = useState<ReaUpdateState>({ status: "idle" });
  useEffect(() => { void window.rea!.updates.state().then(setSt); return window.rea!.updates.onState(setSt); }, []);
  return <div className="pt-3 text-fg">
    <Row label="Check for updates automatically" desc="Looks for new versions on Mindstone's GitHub Releases page twice a day and downloads them in the background. Nothing else is sent."><Toggle checked={s.updates.auto} onChange={(v) => update((x) => ({ ...x, updates: { auto: v } }))} label="Automatic updates" /></Row>
    <Row label="Updates" desc={[UPDATE_TEXT[st.status], st.version && `Version ${st.version}.`, st.message && `${st.message}.`].filter(Boolean).join(" ")}>
      {st.status === "ready"
        ? <button className="btn-primary" onClick={() => void window.rea!.updates.install()}>Restart to update</button>
        : <button className="btn-outline" disabled={st.status === "checking" || st.status === "downloading"} onClick={async () => setSt(await window.rea!.updates.check())}>Check now</button>}
    </Row>
    <Row label="Error log" desc="Errors are written to a log file on this computer only. Share it when reporting a problem."><button className="btn-outline" onClick={() => void window.rea!.openLogs()}>Open log folder</button></Row>
  </div>;
}
