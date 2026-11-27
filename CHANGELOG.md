# Changelog

## 0.5.1 (2026-11-27)

- Desktop: Mindstone now remembers which data folder it chose the first time it ran, so a later start can never open an empty folder instead of your workspace. If you upgraded from Cairn and 0.5.0 showed only starter content, your data is safe in the Cairn folder and 0.5.1 opens it again.

## 0.5.0 (2026-11-27)

- Editor: columns (2 to 4), synced blocks that update on every page they appear on, and buttons (add a checklist item, create a task, open a page, insert a template).
- Comments on selected text (threads, replies, resolve, Ctrl+Alt+M) and suggestion mode (tracked insertions and deletions to accept or reject).
- Databases: two-way relations, more rollups (percent checked, earliest and latest date), chart view (bars, line, pie, donut; count, sum, average), and a timeline you can drag and resize.
- OCR: text in images and scanned PDFs is recognised on this computer and becomes searchable.
- AI: daily and weekly digest, proposed changes to tasks, tags and database fields with review and undo, speaker labels for meeting recordings, and local-model summaries.
- Passphrase protection: AES-256 encryption at rest, lock screen, auto-lock, recovery key, encrypted backups.
- Sync between devices through a folder or a self-hosted server, end-to-end encrypted; an installable phone app that works offline.
- Calendar subscriptions (Google, Outlook or any ICS address) and a web clipper extension for Chrome and Edge.
- Importers for Notion .zip exports, Evernote .enex and Todoist CSV; images in Markdown folders are kept.
- Plugins: sandboxed commands, slash items and panels with permission checks.
- Accessibility: passes automated WCAG 2.1 AA checks; high-contrast themes; better keyboard support.
- Large workspaces: search, Home and Tasks stay fast with 50,000 pages and 100,000 tasks.
- Mac (DMG) and Linux (AppImage, .deb) builds.

## 0.4.0 (2026-11-26)

- Automatic updates: the desktop app checks GitHub Releases, downloads new versions in the background and offers "Restart to update". Turn it off in Settings → About.
- Automatic daily backups of every workspace to the data folder (newest 14 kept), with "Back up now" and "Open folder" in Settings → Backup & restore.
- A local error log for crashes and errors (API keys redacted, never sent anywhere); Settings → About → Open log folder.
- Cloud AI spending guard: a requests-per-minute cap and a daily token budget, adjustable in Settings → AI. Local models are not limited.
- Hardened Electron fuses, a security policy (SECURITY.md), CodeQL scanning and Dependabot.
- CI on every push and tag-driven releases on GitHub Actions; installer file name is now `Mindstone-Setup-x.y.z.exe`.

## 0.3.0 (2026-11-26)

- Renamed to **Mindstone** ("build your mind, stone by stone"). Data, backups and settings from Cairn and REA builds carry over.
- Voice: dictation (Ctrl+Shift+M), voice notes and meeting notes with local Whisper transcription, timestamps, summaries and action items; computer-audio capture for meetings on Windows; Transcribe for audio and video files. Audio never leaves the computer.
- Slash commands accept spaces ("/meeting notes"); Enter is no longer swallowed when nothing matches.
- New refined editorial interface: "ivory and ink" in light, "graphite and brass" in dark. Page titles and headings in the Newsreader serif (bundled, works offline), hairline borders with soft warm shadows, and one deep accent per theme. The accent follows the theme by default.
- Renamed from REA to **Cairn**, with a new 3D logo (three stacked stones and a light) used for the app icon, favicon, start-up screen and About.
- Cairn Intelligence can now propose tasks: ask for them in chat ("make a task for my flight tomorrow at 12 am") and a card lists each task with its date and time; nothing is created until you click. Tasks with a time get a reminder.
- The assistant knows today's date and time, so "tomorrow" and "2 pm" resolve correctly.
- Fixed: answers printed a literal "[n]" and showed unrelated sources. Sources now appear only when the answer cites or visibly uses them.
- Empty states for the knowledge graph and Home's recent pages; no stray border on an empty Databases list; Files shows "local storage".
- Data, backups and settings carry over: internal identifiers are unchanged, and the desktop app keeps using an existing `%APPDATA%\REA` folder.

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
