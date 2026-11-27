# Testing

## Commands (PowerShell, from the repo root)

```powershell
npm test               # Vitest, all suites
npm run typecheck      # tsc --noEmit (strict)
npm run check          # both
npx vitest run tests/perf.test.ts --reporter=verbose   # prints timings
npm run test:e2e       # Playwright end-to-end, in the installed Chrome (starts Vite if needed)
npm run check:all      # typecheck + unit + end-to-end
npm run test:desktop   # builds, then runs the desktop app in real Electron (e2e-electron/)
```

## End-to-end suites (`e2e/`, Playwright)

Each test runs in a fresh Chrome profile, so it starts from an empty workspace.

| File | Workflows |
|---|---|
| `documents.spec.ts` | First run; create, nest, edit, undo/redo and reload a page; wiki links and backlinks panel; trash and restore; page history |
| `data.spec.ts` | Database records across table and board, sort, filter; tasks (quick-add parsing, detail, subtasks, completion, three views); projects; calendar views |
| `views.spec.ts` | All seven database view types; Number and Formula properties; right-panel tabs and comments; split view |
| `system.spec.ts` | Command palette search and commands; backup download and restore; Markdown import and export; themes; offline editing; AI-off messaging; templates, files (incl. blocked .exe), graph, inbox |
| `ai-live.spec.ts` | Opt-in (`$env:REA_LIVE_AI="1"`, needs Ollama with `llama3.2` and `nomic-embed-text`): chat, writing tool preview/replace/undo, semantic index + cited workspace answer, unreachable-server error |
| `features.spec.ts` | Block drag handle (move, undo, select + duplicate); record templates; PDF and Word attachments become searchable |
| `e2e-electron/desktop.spec.ts` | Built desktop app: file:// boot, preload bridge, no Node in renderer, PDF/Word extraction; with `CAIRN_SPEECH_WAV`, a voice note recorded and transcribed in the desktop app |
| `voice.spec.ts` | Opt-in (`$env:CAIRN_SPEECH_WAV` = a speech WAV, plus `npm run voice:setup`): records a meeting note from a fake microphone playing real speech, checks the local transcript and search; dictation at the cursor |
| `screens.spec.ts` | Optional screenshots for visual review (`$env:REA_SCREENS="<dir>"`); skipped otherwise |

## Suites

| File | Covers |
|---|---|
| `tests/formula.test.ts` | Formula parser and evaluator, refusal of code injection, depth and step limits |
| `tests/lib.test.ts` | Document text, links and tags, Markdown export, block ID reassignment, CSV (incl. formula-injection guard), recurrence, ICS round-trip, IDs, safe file names |
| `tests/data.test.ts` | Page nesting and cycle prevention, save + backlinks + tags + revisions, trash/restore/purge, lock, duplicate, database filter/sort/group across views, recurring tasks and dependency cycles, backup/restore round-trip and validation, search |
| `tests/ai.test.ts` | Provider failure handling (missing key, missing model, unreachable server, 401/429), OpenAI and Ollama streaming parsers, Claude embeddings refusal, RAG chunking and untrusted-source framing, ZIP writer |
| `tests/extract.test.ts` | Word extraction (stored and deflated ZIP), entities, HTML stripping, unsupported types, attachments indexed for search, corrupt files recorded as unreadable |
| `tests/actions.test.ts` | Task proposal parsing and validation (dates, 12-hour times, priorities, caps), system prompt content, citation and grounded-source selection |
| `tests/perf.test.ts` | 3,000 pages + 10,000 records: index build, query latency, filter + sort |

IndexedDB is provided by `fake-indexeddb` (see `tests/setup.ts`); each test uses a fresh database.

## Large-workspace timings

`$env:REA_SCALE="1"; npx playwright test e2e/scale.spec.ts` fills a workspace with 50,000 pages, 100,000 tasks and a
20,000-record database and times start-up, search, opening pages, the sidebar, Tasks, Home and the database against
budgets. Latest (2026-11-27): start 3.3 s, first search 8.2 s, later searches 0.4 s, open page 0.8 s, Tasks 2.0 s, Home
0.7 s, database 2.0 s, database search 0.2 s.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request (windows-latest, Node 24): type check,
unit tests, `npm audit --audit-level=moderate`, the Playwright suite in Chrome, and an installer build.

## Latest results (2026-11-26)

- Unit: 59 / 59 passing (adds the cloud AI spending guard); type check clean.
- Packaged build: fuses read back as set; electron-updater packaged; a daily backup and the log file were written on first run.
- End-to-end: 21 / 21 passing (the opt-in live AI and screenshot tests are skipped by default).
- Live AI (Ollama 0.40.18, llama3.2): 7 / 7 passing, including an answer drawn from an uploaded PDF, a task proposal from a natural request, and no placeholder citations.
- Desktop (Electron): 2 / 2 passing, including a voice note transcribed locally.
- Voice (real speech generated with Windows SAPI): 2 / 2 passing; transcript matched the spoken sentence word for word.

To make a test WAV: `Add-Type -AssemblyName System.Speech`, then use `SpeechSynthesizer.SetOutputToWaveFile` at 16 kHz mono.
- Performance (Node + fake-indexeddb, slower than Chromium): index of 13,001 documents built in 170 ms,
  search query 5.2 ms, filter + sort of 10,000 records 6 ms.

## Manual verification performed

In the browser build (Vite dev server):
- App boots, creates the default workspace and Welcome page; dashboard shows real counts.
- Ctrl+N creates a page; the title and slash menu (Heading 2), `- ` and `[ ] ` Markdown shortcuts, `#tag` extraction and `[[` page mention work.
- After a full reload, content, tags, the mention backlink and revisions are intact (read back from IndexedDB).
- Ctrl+K palette, then `>new database`: record creation, inline name edit and the status picker work; the Board view shows the record in the right column.

- Smoke test of every view, applying the CRM template, and task quick-add parsing; plus knowledge graph rendering.

In the packaged Windows build:
- `REA Setup 0.1.0.exe /S` installs per user to `%LOCALAPPDATA%\Programs\Mindstone`; Mindstone.exe starts, opens a window titled "Mindstone" and creates its IndexedDB; the silent uninstall removes the app and shortcut and keeps user data by design.

## Not yet covered

Screen-reader testing, the packaged Electron build under Playwright, live calls to cloud AI providers (needs a key), and import of large real-world Notion/Obsidian exports.
