# Mindstone 0.5 roadmap

The plan for the 19 additions agreed on 2026-11-26. Each step is built, then tested (unit tests for logic, Playwright
end-to-end tests for every user-visible function, desktop tests where Electron is involved), then the whole suite is
run and the step is committed and pushed so GitHub CI checks it too. A step is only marked done when its tests pass.

Rules that apply to every step:
- Local-first and private: nothing leaves the device unless the person turns it on; no telemetry.
- No fake controls. If something can't work in a build (for example the browser build has no file system), the
  control is hidden or explains why.
- Database changes are new Dexie versions with migrations, never edits to `version(1)`. Backups get a new format
  version only if their shape changes, and older backups still restore.
- Every new IPC channel goes through `handle()` with sender checks and input validation.

## Step 1. Editor blocks: columns, synced blocks, buttons
- **Columns**: a `columns` node holding 2 to 4 `column` nodes; created from `/columns`, `/2 columns`, `/3 columns`.
  Columns stack on narrow windows. Markdown and HTML export write the columns one after another.
- **Synced block**: `/synced block` turns a selection into a source block stored in a new `syncedBlocks` table
  (id, workspaceId, content, updatedAt). Copies insert a `syncedRef` node that renders the shared content and edits it
  in place; every copy updates live. "Unsync" turns one copy into normal blocks. Search indexes the content once.
- **Button**: `/button` with a label and actions: insert a template's blocks below, add a task (title, due), open a
  page, or append a checklist item. Actions run only when clicked.
- Tests: unit (schema round-trip, export), E2E (create each block, type into columns, edit a synced copy and see the
  other copy change, each button action).

## Step 2. Comments and suggestion mode
- **Comments on text**: select text, "Comment" (bubble menu or Ctrl+Alt+M) adds a `comment` mark linked to a thread.
  Threads have replies, resolve and reopen, delete, and show in the right panel and in the margin. Extends the
  existing `comments` table with `threadId`, `parentId`, `anchorText`, `resolvedAt` (migration).
- **Suggestion mode**: a page toggle. While on, typing creates `insertion` marks and deleting creates `deletion`
  marks instead of changing the text. Each suggestion can be accepted or rejected; "Accept all" and "Reject all".
- Tests: E2E (comment, reply, resolve, the mark survives reload; suggest, accept, reject, accept all).

## Step 3. Databases: relations, rollups, charts, timeline
These exist but were only partly verified. This step finishes and proves them.
- Two-way relations (optional mirror property in the target database, kept in step), relation picker with search.
- Rollups: count, sum, average, min, max, show original, percent checked, earliest and latest date.
- Chart view: bar, horizontal bar, line, pie and donut, grouped by a property, count or sum of a number property.
- Timeline view: bars from a date range (or start and end dates), drag to move, drag the edges to resize, zoom by
  day, week or month, today line.
- Tests: unit (rollup math, chart aggregation), E2E (link records both ways, rollup updates, each chart type renders
  real values, drag a timeline bar and the date changes).

## Step 4. OCR for scanned PDFs and images
- Tesseract.js in a worker with the English language data and core files staged locally by a setup script with
  SHA-256 checks (like the voice model), served offline. Images (PNG, JPEG, WebP) and PDF pages with no text layer
  are recognised; the text goes into the attachment's searchable text and into AI retrieval.
- A progress indicator and a "Recognise text" action on an attachment; optional automatic OCR on upload.
- Tests: unit (PDF "has text layer" detection), E2E (upload a generated image of text and find it with search).

## Step 5. AI: digest, actions, local summaries, speakers
- **Digest**: "Today" and "This week" digests built from real data: changed pages, tasks done and overdue, upcoming
  events, and decisions or action items found in meeting notes. Works without AI (structured list); with AI it adds a
  written summary. Can be saved as a page; optional daily digest on start.
- **Actions with preview**: the assistant can propose structured changes (move or reschedule tasks, set status,
  fill database fields, add or remove tags) as a `cairn-actions` block. A card lists each change with before and
  after; nothing happens until Apply; Apply can be undone.
- **Local meeting summaries**: summaries and action items for voice and meeting notes use the local model when one
  is set up (Ollama), with a clear choice in Settings → Voice, so meetings never need the cloud.
- **Speaker labels**: meeting recordings keep the microphone and computer audio as separate channels, so the
  transcript labels "You" and "Others" (per segment, by which channel carries the speech). Names can be edited.
- Tests: unit (digest queries, action validation and apply/undo, channel attribution), E2E with the live local model
  (opt-in, `REA_LIVE_AI=1`) and with a deterministic stub provider for CI.

## Step 6. Passphrase lock and encryption at rest
- Optional passphrase. The key is derived with PBKDF2-SHA-256 (600,000 iterations) and wraps a random 256-bit data
  key; changing the passphrase re-wraps the key without re-encrypting everything.
- A Dexie middleware encrypts the content fields of every table with AES-GCM (page content and text, titles, task
  text, record values, events, comments, AI chats, attachment bytes). Ids, dates and sort keys stay plain so queries
  keep working; the in-memory search index is built after unlock.
- Lock screen on start and after an idle timeout; "Lock now" in the palette. Turning encryption on migrates the
  existing data in place with a progress bar; turning it off decrypts it.
- Backups can be encrypted with the passphrase. A recovery key (shown once) can reset a forgotten passphrase; without
  either, the data can't be recovered, and the settings say so.
- Tests: unit (key derivation, wrap and unwrap, encrypt and decrypt round trip, wrong passphrase rejected, raw
  IndexedDB rows contain no plaintext), E2E (enable, lock, unlock, idle lock, disable).

## Step 7. Sync and the mobile app
- **Change log**: every write records a change (table, id, updatedAt, device) so devices can exchange changes.
  Conflicts: last writer wins per record, and the losing page version is kept in page history.
- **Folder sync** (desktop): choose a folder (OneDrive, Dropbox, a USB drive). Mindstone writes encrypted change files
  there and reads other devices' files. Status in the status bar; "Sync now".
- **Self-hosted server**: a small Node server (`server/`, one command or Docker) that stores encrypted changes; it
  never sees plaintext. Devices pair with a server URL and a sync passphrase.
- **Mobile app (PWA)**: the browser build installs to a phone's home screen, works offline (service worker), has a
  phone layout (bottom bar: Home, Capture, Tasks, Search) and syncs through the self-hosted server.
- Tests: unit (change log, merge, conflict rules, end-to-end encryption), E2E (two browser profiles sync through a
  test server; folder sync between two desktop data folders; PWA offline load at phone size).

## Step 8. Calendar feeds and web clipper
- **Calendar subscriptions**: add a calendar by its private ICS address (Google Calendar and Outlook both provide
  one, no account sign-in needed). Read-only, refreshed every 30 minutes, shown in its own colour next to tasks.
- **Web clipper**: a Chrome/Edge extension (Manifest V3) that saves the page, a selection, or a simplified article
  into Mindstone's Inbox. It talks to the desktop app over `127.0.0.1` with a pairing code; the app accepts only
  paired requests.
- Tests: unit (ICS feed parsing, recurrence, time zones), E2E (subscribe to a feed served by the test server; clip a
  page through the app's local endpoint; the extension's own logic tested with a generated test page).

## Step 9. More importers and plugins
- Importers: Notion export `.zip` directly, Evernote `.enex` (notes, tags, images), Todoist CSV (tasks, projects,
  priorities, due dates), Apple Notes exported as HTML or Markdown folders.
- **Plugins**: a plugin is a folder with `manifest.json` and a script that runs in a sandboxed iframe with no access
  to the page or the network, unless the person allows it. Through a message API it can add commands, slash items
  and a panel, and read or write pages it is allowed to see. Settings → Plugins installs, enables, disables and
  removes them. An example plugin ships in `plugins/word-count`.
- Tests: unit (each importer with sample files), E2E (install the example plugin, run its command, check the sandbox
  blocks network and DOM access).

## Step 10. Accessibility, high contrast and speed
- Automated axe-core checks on every main view (no serious or critical violations), keyboard-only walkthroughs, focus
  rings, labelled controls, and announcements for toasts and live updates.
- A high-contrast theme (light and dark) that follows Windows contrast settings.
- Performance with 50,000 pages, 100,000 tasks and a 20,000-row database: start, search, open, scroll and filter
  timed in tests with budgets that fail when exceeded; fix whatever is slow (lazy sidebar tree, indexed queries,
  incremental search index).

## Step 11. Mac and Linux builds, final regression
- CI matrix: Windows, macOS and Ubuntu each run the unit and end-to-end tests and build installers (DMG, AppImage
  and .deb). Release workflow uploads all of them and the updater files for each platform.
- Full regression of everything above, docs updated, and a release only after you say so.

## Not doable without you
- **Code signing** needs a certificate you buy (for example Azure Trusted Signing). The workflow hooks exist; see
  RELEASING.md. macOS builds will be unsigned too, so macOS will ask people to allow the app on first open.
