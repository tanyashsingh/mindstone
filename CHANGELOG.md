# Changelog

## 0.2.0 (2026-11-25)

- Playwright end-to-end suite (18 tests) running in the installed Chrome.
- Fixed: Escape could not close dialogs, because closed popovers swallowed it.
- Calendar day and week views open scrolled to 07:00.
- Opt-in live AI tests against a local Ollama server.
- Fixed: building the semantic index always reported "Nothing to index".
- Fixed: workspace answers could cite the same page twice.
- Block drag handle: drag ⋮⋮ to move a block, click it to select the block.
- Database record templates.
- PDF, Word, text and HTML attachments are searchable and used by AI, with 📎 file citations.
- Desktop end-to-end test in real Electron.
- Fixed: block shortcuts ignored a whole-block selection; new pages sometimes opened without the title focused.

## 0.1.0 (2026-11-25)

First release.

- Local-first data layer on IndexedDB (Dexie) with soft delete, revisions, backlinks and activity log.
- Block editor on TipTap 3 with 25+ block types, slash commands, page links, find & replace, autosave and crash recovery.
- Database engine with 23 property types, safe formula engine, relations and rollups, and 7 view types.
- Tasks, projects, calendar (ICS), dashboard, focus timer, habits, goals, 19 templates.
- Fuzzy search, command palette, knowledge graph.
- Provider-independent AI (Claude, OpenAI, Gemini, Ollama, OpenAI-compatible) with RAG and citations.
- Backup/restore, Markdown/HTML/PDF/CSV/JSON export, Markdown/Obsidian/Notion import.
- Hardened Electron shell with DPAPI key storage and an NSIS installer for Windows.
- 39 automated tests, including performance checks on a generated workspace.
