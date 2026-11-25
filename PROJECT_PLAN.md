# Project plan

## Phase 0 audit (2026-11-25)
- The provided `rea` folder (`Downloads\rea-main\rea-main`) is **rea-agents 6.10.1**, an MIT-licensed reverse-engineering
  CLI/MCP server (~4,700 source files), downloaded as a zip with no git history. It contains no productivity app.
  The owner chose to build REA in a new sibling repository, `Downloads\rea-workspace`, leaving rea-agents untouched.
- Environment: Windows 11, Node 26.13.1, npm 11.20, Git 2.56, WebView2 158. No Rust/Cargo and no MSVC
  build tools, so Electron was chosen over Tauri and IndexedDB over native SQLite (see ARCHITECTURE.md).
- No git identity is configured on this machine, so commits await the owner's name and email.

## Roadmap and progress
| Phase | Scope | State |
|---|---|---|
| 0 | Audit, decisions, docs | Done |
| 1 | Shell, design system, navigation, persistence, settings | Done |
| 2 | Pages, block editor, autosave, slash commands, links, recovery | Done (drag handle deferred) |
| 3 | Database engine, property types, 7 views, filters, formulas, relations | Done (record templates pending) |
| 4 | Tasks, projects, calendar, dashboard, reminders, templates | Done; needs manual pass |
| 5 | Backlinks, tags, graph, search, palette | Done |
| 6 | AI providers, assistant, writing tools, RAG, local AI | Done; untested against live providers |
| 7 | Import/export, backup/restore, crash recovery | Done |
| 8 | Collaboration and sync | Blocked (no backend); architecture is sync-ready |
| 9 | QA: unit, integration, performance | Partial: 39 tests; E2E and accessibility pending |
| 10 | Windows packaging | Done: unsigned NSIS installer, install/launch/uninstall verified |

## Next iteration
1. Manual pass over Tasks, Projects, Calendar, Graph, Files, Templates and Settings; fix findings.
2. Playwright E2E for the workflows in TESTING.md.
3. Block drag handle, database record templates, PDF/DOCX ingestion for RAG.
4. Code-signing certificate (owner decision) and an update channel (owner approval required).
