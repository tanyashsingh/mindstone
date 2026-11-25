# Testing

## Commands (PowerShell, from the repo root)

```powershell
npm test               # Vitest, all suites
npm run typecheck      # tsc --noEmit (strict)
npm run check          # both
npx vitest run tests/perf.test.ts --reporter=verbose   # prints timings
npm run test:e2e       # Playwright end-to-end, in the installed Chrome (starts Vite if needed)
npm run check:all      # typecheck + unit + end-to-end
```

## End-to-end suites (`e2e/`, Playwright)

Each test runs in a fresh Chrome profile, so it starts from an empty workspace.

| File | Workflows |
|---|---|
| `documents.spec.ts` | First run; create, nest, edit, undo/redo and reload a page; wiki links and backlinks panel; trash and restore; page history |
| `data.spec.ts` | Database records across table and board, sort, filter; tasks (quick-add parsing, detail, subtasks, completion, three views); projects; calendar views |
| `views.spec.ts` | All seven database view types; Number and Formula properties; right-panel tabs and comments; split view |
| `system.spec.ts` | Command palette search and commands; backup download and restore; Markdown import and export; themes; offline editing; AI-off messaging; templates, files (incl. blocked .exe), graph, inbox |
| `screens.spec.ts` | Optional screenshots for visual review (`$env:REA_SCREENS="<dir>"`); skipped otherwise |

## Suites

| File | Covers |
|---|---|
| `tests/formula.test.ts` | Formula parser and evaluator, refusal of code injection, depth and step limits |
| `tests/lib.test.ts` | Document text, links and tags, Markdown export, block ID reassignment, CSV (incl. formula-injection guard), recurrence, ICS round-trip, IDs, safe file names |
| `tests/data.test.ts` | Page nesting and cycle prevention, save + backlinks + tags + revisions, trash/restore/purge, lock, duplicate, database filter/sort/group across views, recurring tasks and dependency cycles, backup/restore round-trip and validation, search |
| `tests/ai.test.ts` | Provider failure handling (missing key, missing model, unreachable server, 401/429), OpenAI and Ollama streaming parsers, Claude embeddings refusal, RAG chunking and untrusted-source framing, ZIP writer |
| `tests/perf.test.ts` | 3,000 pages + 10,000 records: index build, query latency, filter + sort |

IndexedDB is provided by `fake-indexeddb` (see `tests/setup.ts`); each test uses a fresh database.

## Latest results (2026-11-25)

- Unit: 39 / 39 passing; type check clean.
- End-to-end: 18 / 18 passing, and 36 / 36 when each test is run twice (no flaky tests).
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
- `REA Setup 0.1.0.exe /S` installs per user to `%LOCALAPPDATA%\Programs\REA`; REA.exe starts, opens a window titled "REA" and creates its IndexedDB; the silent uninstall removes the app and shortcut and keeps user data by design.

## Not yet covered

Screen-reader testing, the packaged Electron build under Playwright, live AI provider calls (needs your key), and import of large real-world Notion/Obsidian exports.
