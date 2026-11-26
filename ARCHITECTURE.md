# Mindstone architecture

## Decisions

| Area | Choice | Why |
|---|---|---|
| Repository | New repo `rea-workspace` | The existing `rea` repo is an unrelated reverse-engineering CLI (rea-agents, MIT). Building here keeps that project untouched (decision confirmed by the owner). |
| UI | React 19 + TypeScript (strict) + Vite 8 + Tailwind CSS 4 | Fast dev loop, small runtime, typed end to end. |
| Desktop | Electron 45 | Tauri needs Rust and MSVC build tools, which this machine lacks. Electron ships its own Chromium, so WebView2 is not required at runtime. |
| Local storage | IndexedDB via Dexie 4 | Works identically in the browser and in Electron (Chromium persists it under `%APPDATA%\Mindstone`). Transactional, indexed, no native compile. SQLite was considered; `better-sqlite3` needs a native toolchain and `node:sqlite` would split the data layer between processes. Revisit when sync arrives. |
| Editor | TipTap 3 (ProseMirror) | MIT, schema-based (lossless JSON), mature extension model. One editor framework only. |
| Search | MiniSearch (in-memory, fuzzy + prefix) | Sub-10 ms queries over 13k documents measured; no FTS5 dependency. |
| State | Zustand (UI state) + Dexie live queries (data) | Live queries make every view reactive to the same records, so table, board and calendar can't drift. |
| AI | Provider-independent layer (`src/ai/providers.ts`) | Claude through the official Anthropic SDK; OpenAI, Gemini, Ollama and OpenAI-compatible servers through their HTTP APIs. |

## Layers

```
src/
  data/        types, Dexie schema (db.ts), repository (repo.ts), search, backup, import/export, templates
  lib/         pure logic: formula engine, database query engine, doc helpers, ICS, CSV, ZIP, recurrence
  ai/          providers (environment-agnostic), renderer client, RAG
  editor/      TipTap schema, custom nodes, node views, slash and link suggestions, block commands
  store/       Zustand: app shell state, persisted settings
  components/  shell: sidebar, palette, right panel, status bar, primitives
  views/       routed screens (pages, databases, tasks, projects, calendar, graph, files, templates, AI, settings…)
electron/      main process (window, IPC, secrets, tray, menu) and sandboxed preload bridge
tests/         Vitest suites (fake-indexeddb)
```

Rules: `lib/` has no imports from React, Dexie or the DOM, so it stays unit-testable. Views read through
live queries and write through `data/repo.ts`, never ad hoc.

## Document model

A page stores its content as a ProseMirror JSON document. Every block node carries a stable `id`
attribute assigned by the `BlockId` extension, which also repairs duplicate IDs after paste or split. Blocks are
not stored in a separate table: one document per page keeps saves atomic and serialisation lossless,
while block IDs still allow addressing (outline, table of contents, future sync). Derived fields
(`text`, `tags`, `links`) are recomputed on every save inside the same transaction.

## Desktop process model

- Renderer: sandboxed, `contextIsolation: true`, `nodeIntegration: false`, strict CSP (no remote scripts).
- Preload exposes a narrow `window.rea` bridge (notifications, new window, secrets, AI calls).
- Main verifies every IPC sender's origin, validates provider IDs and endpoint URLs, and denies
  permission requests, navigation away from the app and `<webview>` attachment.
- API keys are encrypted with `safeStorage` (DPAPI on Windows) in `%APPDATA%\Mindstone\secrets.json` and are
  only decrypted in the main process. AI requests run in the main process, so keys never reach page JavaScript.

- `electron/ops.ts` holds operations: the local error log (`logs/mindstone.log`, rotated, keys redacted),
  crash logging (`uncaughtException`, `render-process-gone`, `child-process-gone`), automatic backups written
  atomically to `backups/` (newest 14 per workspace; the renderer builds the backup with `createBackup` and the
  main process only validates the file name and writes it), and the updater (electron-updater, GitHub Releases
  provider, off when the setting is off or the app is not packaged).
- Electron fuses (set at build time in `package.json` → `build.electronFuses`): RunAsNode, NODE_OPTIONS and
  inspector arguments disabled; asar integrity validation and asar-only loading on; cookie encryption on.
  `GrantFileProtocolExtraPrivileges` stays on because pages load from `file://`.
- Cloud AI requests pass a spending guard (`src/ai/guard.ts`): requests per minute and a daily token budget,
  counted per device in `localStorage`. Local providers bypass it.

## Offline and failure behaviour

Everything except AI calls is local. Network loss changes only the status-bar indicator. Saves are
debounced (default 600 ms); each keystroke also writes a crash-recovery draft to `localStorage`, offered back
on next open if it is newer than the stored page. Errors in a view are contained by error boundaries.

## Voice

Recording uses MediaRecorder (Opus/WebM); meetings can mix in Windows loopback audio via `getDisplayMedia`, whose
request is answered in the main process. Audio is decoded to 16 kHz mono and transcribed by Whisper base (q8) in a
Web Worker (Transformers.js + ONNX Runtime Web, WebGPU first, CPU fallback) with remote model loading disabled.
The desktop app serves the model and runtime on a private read-only `cairn-asset://voice/` scheme, because
Chromium's fetch cannot read `file://`. Transcripts are stored on the audio attachment (`text`, `segments`), so the
existing search and RAG pipelines index them.

## Sync readiness (not implemented)

IDs are ULID-style (time-sortable, collision-resistant), every row has `createdAt` and `updatedAt`, and
deletions are soft (`deletedAt`). A future sync service can stream changes from Dexie hooks into an
operation queue. Collaborative documents should use a CRDT (Yjs via `y-prosemirror`) rather than
last-write-wins. Nothing in the UI pretends sync exists.
