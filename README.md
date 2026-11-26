<p align="center"><img src="brand/mindstone-logo-512.png" alt="Mindstone logo: three stacked stones under a small light" width="160"></p>

# Mindstone

*Build your mind, stone by stone.* Formerly Cairn, and REA before that.

A local-first, privacy-first workspace for notes, documents, tasks, projects, databases, calendar and
personal knowledge, with optional AI. Everything runs on your machine; no account is required.

> This repository is separate from the `rea` reverse-engineering project (rea-agents), which was left untouched.

## Features at a glance

- **Block editor**: headings, lists, checklists, toggles, callouts, code with highlighting, tables, LaTeX math,
  Mermaid diagrams, images/video/audio/files, bookmarks, embedded pages, linked databases, table of contents.
  Slash commands, Markdown shortcuts, `[[wiki links]]` and `@mentions`, backlinks, find & replace, autosave, page history.
- **Databases**: 23 property types (relations, rollups, formulas…), table, board, list, gallery, calendar,
  timeline and chart views over the same records; nested filters, sorting, grouping, CSV/JSON import and export.
- **Tasks and projects**: subtasks, dependencies, recurrence, reminders, Eisenhower matrix, milestones, progress reports.
- **Calendar**: day/week/month/agenda, recurring events, drag to reschedule, ICS import and export.
- **Knowledge**: fuzzy full-text search (Ctrl+K), tags, related pages, interactive knowledge graph.
- **Mindstone Intelligence (optional)**: Claude, OpenAI, Gemini, Ollama or any OpenAI-compatible local server.
  Workspace-aware chat with citations, writing tools with preview, tasks from notes. Cloud AI is off until you enable it.
- **Voice**: dictate into any page (Ctrl+Shift+M), record voice notes and meetings (optionally with computer audio on Windows), and get timestamped transcripts, summaries and action items. Speech is transcribed on your computer with Whisper; audio never leaves it.
- **Portability**: versioned full backups, Markdown/HTML/PDF/CSV/JSON export, Markdown/Obsidian/Notion import.

See [FEATURES.md](FEATURES.md) and the honest status matrix in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Requirements (Windows)

- Node.js 22 or later (tested with 26.13) and npm 11
- Git
- No Rust, Visual Studio or WebView2 is needed: the desktop app is Electron.

## Development

```powershell
npm install
npm run voice:setup    # once: downloads and verifies the local speech model (Whisper base, 73 MB) into public/voice/
npm run dev            # browser build at http://localhost:5183
npm test               # unit and integration tests
npm run typecheck
```

Run the desktop shell against the dev server:

```powershell
npm run build:electron
$env:REA_DEV_URL = "http://localhost:5183"; npx electron .
```

## Download

The latest Windows installer is on the [Releases page](https://github.com/tanyashsingh/notion_rea/releases/latest).

## Production build and Windows installer

```powershell
npm run build          # type check, web bundle (dist/), Electron bundle (dist-electron/)
npm run dist:win       # NSIS installer at release\Mindstone Setup <version>.exe
```

The installer is per-user (no admin rights), lets you choose the folder, and is **unsigned**: Windows
SmartScreen will warn until a code-signing certificate is configured. Silent install: `"Mindstone Setup <version>.exe" /S`.

## Where your data lives

| Build | Location |
|---|---|
| Desktop | `%APPDATA%\Mindstone` (IndexedDB, settings, encrypted `secrets.json`). If a pre-rename `%APPDATA%\REA` folder exists and `Mindstone` does not, the app keeps using `REA`. |
| Browser | The browser profile's IndexedDB for `localhost:5183` |

Uninstalling keeps your data. Delete `%APPDATA%\Mindstone` to remove it. Use **Settings → Backup & restore** to
move a workspace between machines.

## Releasing

CI (GitHub Actions) tests every push and builds the installer; pushing a `vX.Y.Z` tag publishes a release. See
[RELEASING.md](RELEASING.md), which also covers adding a code-signing certificate.

## Updating

The installed app checks GitHub Releases shortly after start and every 12 hours, downloads new versions in the
background and offers **Restart to update**. Turn it off in **Settings → About**. You can also install a newer
`Mindstone-Setup-x.y.z.exe` over the existing one; data is preserved and the database migrates on first launch.

## Sync and phone

Sync your devices through a folder (OneDrive, Dropbox, USB) or your own small server, end-to-end encrypted with a sync
passphrase. The server can also serve Mindstone to phones as an installable app that works offline. See [SYNC.md](SYNC.md).

## Calendars and web clipper

- **Calendar → Subscribe**: add Google Calendar, Outlook or any calendar by its private iCalendar (ICS) address. No
  sign-in; read-only; refreshes every 30 minutes.
- **Web clipper**: a Chrome/Edge extension in [clipper/](clipper/README.md) saves pages, selections or articles into
  the desktop app (Settings → Integrations).

## Plugins

Add commands, slash items and panels with small JavaScript plugins that run in a sealed sandbox with only the
permissions you grant. See [PLUGINS.md](PLUGINS.md) and the example in [plugins/word-count](plugins/word-count).

## Reliability

- **Automatic backups** (desktop): once a day each workspace is saved to the `backups` folder inside the data folder; the
  newest 14 per workspace are kept. **Settings → Backup & restore** shows the latest and opens the folder.
- **Error log**: crashes and errors go to `logs/mindstone.log` in the data folder (rotated at 1 MB, API keys redacted).
  Nothing is sent anywhere. **Settings → About → Open log folder**.
- **Cloud AI spending guard**: a cap on cloud requests per minute (default 20) and a daily token budget (default
  300,000), both adjustable in **Settings → AI**. Local models are never limited.

## Environment variables

None are required. See [.env.example](.env.example). AI keys are entered in **Settings → AI providers**
and stored with Windows DPAPI, never in files in this repository.

## Security notes

Sandboxed renderer with context isolation, strict Content Security Policy, IPC sender verification,
sanitised rich text and AI output, link protocol allow-list, blocked executable attachments, CSV
formula-injection guard, an `eval`-free formula engine, optional passphrase protection (AES-256-GCM encryption
at rest with a recovery key; Settings → Security), and hardened Electron fuses (no `ELECTRON_RUN_AS_NODE`,
no `--inspect`, app code loaded only from an integrity-checked asar). See [SECURITY.md](SECURITY.md) to report a problem. No telemetry. With passphrase protection off, data is protected by your Windows account only.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) · [TESTING.md](TESTING.md) ·
[PROJECT_PLAN.md](PROJECT_PLAN.md) · [CHANGELOG.md](CHANGELOG.md) · [CLAUDE.md](CLAUDE.md)

## Brand

The logo is a real 3D render: `brand/logo-scene.ts` (three.js) is rendered in headless Chrome by
`node scripts/render-logo.mjs`, which writes `brand/mindstone-logo-{1024,512}.png`, `build/icon.png`, `public/favicon.png`
and `src/assets/mindstone-mark*.png`. Re-run it after editing the scene.

## Extending Mindstone

- New block: add a TipTap node in `src/editor/extensions.ts` (plus a node view in `nodeViews.tsx`), register
  it in `src/editor/schema.ts`, add a slash item in `slashItems.ts`, and handle it in `docToMarkdown`.
- New property type: extend `PropertyType` in `src/data/types.ts`, then `cellValue`/`displayValue` in
  `src/lib/dbquery.ts` and the editor in `src/views/database/cells.tsx`.
- New AI provider: add a branch to `streamChat`/`embed`/`listModels` in `src/ai/providers.ts` and defaults in `store/settings.ts`.
- Schema change: follow the migration rules in DATABASE_SCHEMA.md.
