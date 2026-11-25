# Implementation status

Source of truth for progress. Status meanings:
**Tested** means logic, persistence and automated tests exist. **Verified** means it was exercised by hand in the running app.
**Implemented** means the code is complete and type-checked but not yet exercised by hand. **Deferred** means it was deliberately postponed.
**Blocked** means it needs infrastructure or credentials that aren't available. **Not started** means no work yet.

Last updated: 2026-11-25.

## Foundation
| Feature | Status | Where |
|---|---|---|
| App shell: sidebar (collapse, resize, tree drag and drop), tabs, split view, right panel, status bar | Verified (shell, tree, tabs); Implemented (split, resize) | `src/App.tsx`, `src/components/*` |
| Design tokens; light, dark, OLED and system themes; accent colours; reduced motion | Verified (dark/system); Implemented (others) | `src/styles.css`, `src/store/settings.ts` |
| Local persistence (IndexedDB), transactional writes, soft delete | Tested | `src/data/db.ts`, `src/data/repo.ts` |
| Multiple workspaces (create, rename, switch, delete) | Implemented | `components/Sidebar.tsx` |
| Settings persisted, with reset | Implemented | `store/settings.ts`, `views/Settings.tsx` |
| Error boundaries, toasts, empty states, skeletons | Verified | `components/*` |

## Documents
| Feature | Status |
|---|---|
| Block editor: paragraph, H1–H6, bullet/numbered/check/toggle lists, quote, callout, divider, code (syntax highlight), table, math (KaTeX), Mermaid, image/video/audio/file, bookmark, page embed, linked database, TOC, date, reminder | Verified (headings, lists, checklist, callout, mention); Implemented (rest) |
| Slash commands, Markdown shortcuts, bubble toolbar, turn-into, links, find & replace (Ctrl+F/H) | Verified (slash, shortcuts); Implemented (toolbar, find) |
| Stable block IDs with duplicate repair | Tested (`reassignIds`), Implemented (plugin) |
| Autosave (debounced), save status, Ctrl+S flush, crash-recovery drafts | Verified |
| Page create, rename, duplicate, trash, restore, purge, lock, icon, cover, favourite, history and restore | Tested (repo); Verified (create, persist) |
| `[[wiki]]` links, `@` and `[[` mentions, backlinks, cycle-safe nesting | Tested + Verified |
| Block drag-and-drop | Partial: media and embeds are draggable; other blocks move with Alt+Shift+↑/↓, duplicate with Ctrl+D |
| Columns, synced block, button block | Deferred |

## Databases
| Feature | Status |
|---|---|
| 23 property types incl. relation, rollup, formula, unique ID | Tested (formula, query); Implemented (editors) |
| Views: table (virtualised, resize, reorder, hide), board, list, gallery, calendar, timeline, chart | Verified (table, board); Implemented (others) |
| Nested filter groups, multi-sort, grouping, search, bulk edit | Tested (engine); Implemented (UI) |
| Safe formula engine (no eval) | Tested |
| CSV/JSON import and export | Tested (CSV codec); Implemented (UI) |
| Record templates | Not started |
| Files property | Partial (counts only); Person property is free text (no accounts) |

## Productivity
| Feature | Status |
|---|---|
| Tasks: status, priority, dates, subtasks, dependencies (cycle-checked), recurrence, tags, estimates, reminders, quick-add parsing | Tested (recurrence, cycles); Implemented (UI) |
| Task list, board and Eisenhower views | Implemented |
| Projects: overview, milestones, timeline, progress report, docs page, activity, archive | Implemented |
| Calendar: day/week/month/agenda, recurring, all-day, drag reschedule, colours, reminders, ICS import/export | Tested (ICS, recurrence); Implemented (UI) |
| Dashboard: today, deadlines, events, recent, pinned, projects, quick capture, journal, weekly review | Verified |
| Pomodoro with time tracking, habits, goals | Implemented |
| 19 built-in templates plus custom templates | Implemented |
| Reminders (in-app + native notifications) | Implemented |

## Knowledge
| Feature | Status |
|---|---|
| Full-text fuzzy search, filters, highlighting, recent and saved searches, Ctrl+K palette with commands | Tested (index); Verified (palette) |
| Tags (inline `#tag` and manual), related pages, outline, comments (local) | Tested (tags); Implemented |
| Knowledge graph: global/local, depth, filters, orphans, edge types, zoom/pan | Implemented |
| Research collections | Partial: use nested pages, tags and saved searches; no dedicated object |

## AI
| Feature | Status |
|---|---|
| Provider layer: Claude (SDK, server-side refusal fallback), OpenAI, Gemini, Ollama, OpenAI-compatible | Tested (mocked HTTP); Ollama verified live (llama3.2, nomic-embed-text); cloud providers not run live (no keys) |
| Chat with history, page-aware and workspace-aware modes, citations, stop, token usage | Verified live (Ollama) |
| Writing tools with preview before replace, undoable | Verified live (Summarize, replace, Ctrl+Z) |
| Tasks from replies (confirmed), save reply as page | Implemented |
| RAG: chunking, embeddings, hybrid retrieval, untrusted-content framing | Tested (helpers); verified live: answer cites the right page |
| Cloud opt-in, per-request consent, local-only mode | Implemented |
| PDF/DOCX ingestion for RAG | Not started (pages and imported Markdown/HTML/text are indexed) |

## Portability and resilience
| Feature | Status |
|---|---|
| Versioned workspace backup and restore | Tested |
| Import Markdown, HTML, text, CSV, JSON, Obsidian vaults, unzipped Notion exports | Implemented (limitations listed in Settings → Import) |
| Export Markdown, HTML, PDF (print), CSV, JSON, workspace ZIP | Tested (ZIP); Implemented |

## Desktop and security
| Feature | Status |
|---|---|
| Electron shell, hardened, with tray, menu, single instance, new window | Verified (installed build launched) |
| API keys via DPAPI (safeStorage), main-process AI calls, IPC sender checks | Implemented |
| CSP, sanitised rendering (DOMPurify), link protocol allow-list, file-type validation, safe file names | Tested (file names, CSV injection); Implemented |
| NSIS installer, install, launch, uninstall | Verified |
| Code signing, auto-update | Deferred (needs certificate; auto-update needs your approval) |

## Collaboration
| Feature | Status |
|---|---|
| Accounts, roles, sharing, real-time editing, presence, cloud sync | Blocked: no backend or sync server configured. The UI says so explicitly. |
| Google Calendar / Outlook | Blocked: needs OAuth client credentials and your authorisation |

## Quality
| Item | Status |
|---|---|
| Unit and integration tests (Vitest): 39 passing | Done |
| Performance on a generated workspace (3,000 pages + 10,000 records) | Measured: index 170 ms, query 5 ms, filter+sort 6 ms |
| End-to-end browser tests (Playwright): 18 passing | Done |
| Accessibility audit (screen reader pass) | Not started; ARIA roles and labels added throughout |

## Smoke test (2026-11-25)
Every routed view (Home, Inbox, AI, Tasks, Projects, Calendar, Databases, Graph, Files, Templates, Trash, Settings) renders without error in the browser build. Applying the CRM template created its page with an embedded database. Quick-add parsed `tomorrow !high #ops` into due date, priority and tag. Fixed during the smoke test: an effect returned `scrollIntoView()`'s Promise as its cleanup (crashed the AI view), and error boundaries are now keyed per route.

## End-to-end pass (2026-11-25)
The Playwright suite exercised the main controls of every view. Bugs found and fixed:
- Closed popovers (one per sidebar page) listened for Escape in the capture phase and stopped it, so no dialog could be closed with Escape. They also listened for every click. Now only an open popover listens.
- The calendar time grid opened at midnight; it now opens at 07:00.

## Live AI pass (2026-11-25, Ollama 0.40.18, llama3.2 + nomic-embed-text)
`e2e/ai-live.spec.ts` (opt-in) passes 4/4: chat with saved history and token counts; Summarize preview, replace and undo; semantic index plus a workspace answer that cites the right page; a clear error when the server is unreachable. Bugs fixed:
- `indexWorkspace` always reported 0 pages indexed (`onProgress?.(++done)` skipped the increment), so the UI said "Nothing to index".
- A page could be cited twice, once from keyword and once from vector retrieval; the keyword excerpt is now dropped when vector hits exist.

## Known issues
- Vite warns that a few modules are both statically and dynamically imported (bundle-splitting only; no runtime effect).
- The PDF export uses the system print dialog ("Save as PDF").
- In the browser build, AI keys are kept in memory only and Ollama needs `OLLAMA_ORIGINS` to allow the page origin.

## Next steps
1. Add a block drag handle (TipTap drag-handle extension) and record templates.
2. PDF/DOCX text extraction for RAG.
