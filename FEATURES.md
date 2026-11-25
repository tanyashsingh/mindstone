# Features

A user-facing tour. For what is tested versus only implemented, see IMPLEMENTATION_STATUS.md.

## Workspace
Multiple workspaces · nested pages without depth limit · drag pages to nest or reorder · favourites and recent ·
tabs (Ctrl+Click, Ctrl+Tab, Ctrl+W) · split view · focus mode · collapsible, resizable sidebar · right panel with
outline, backlinks, related pages, properties, comments, activity and AI.

## Editor
Type `/` for blocks, `[[` or `@` to link a page, `#tag` to tag. Markdown shortcuts (`#`, `-`, `1.`, `[ ]`, `>`, ```` ``` ````, `---`).
Select text for the formatting toolbar and **Ask AI**. Ctrl+F find, Ctrl+H replace, Ctrl+D duplicate block,
Alt+Shift+↑/↓ move block, Ctrl+Shift+K delete block. Hover a block and drag its ⋮⋮ handle to move it. Drop or paste files to attach them. Page history restores any saved version.
Lock a page to prevent edits. Export as Markdown, HTML or PDF.

## Databases
Properties: title, text, number, currency, percent, select, multi-select, status, checkbox, date, date range,
email, phone, URL, files, person, relation, rollup, formula, rating, progress, created time, last edited, unique ID.
Views: table (resize, reorder and hide columns, bulk edit), board (drag between columns), list, gallery,
calendar (drag to reschedule), timeline, chart. Nested AND/OR filters, multi-level sort, search, CSV/JSON in and out.
Save any record as a template and create new records from it with the arrow beside **New**. Formula example: `if(prop("Due") < today(), "Overdue", "OK")`.

## Tasks, projects, calendar
Quick add understands `tomorrow`, `next week`, `2026-12-01`, `!high`, `#tag`. Tasks support subtasks,
dependencies, recurrence, reminders, estimates and time tracked by the focus timer. Projects have milestones,
a timeline, progress metrics and a documentation page. The calendar shows events and task deadlines and
imports and exports `.ics`.

## Home
Today and overdue tasks, deadlines, today's schedule, recent and pinned pages, active projects, quick capture,
daily journal, weekly review, focus timer, habits and goals.

## Knowledge
Ctrl+K searches pages, records, tasks, projects, events, files and tags (fuzzy), and runs commands after `>`.
Ctrl+Shift+F opens full search with filters and saved searches. The knowledge graph shows links, embeds,
sub-pages and tags, with local and global modes and orphan detection.

## Files
PDF, Word (.docx), text and HTML attachments have their text extracted on upload, so Ctrl+K finds words inside them and AI answers can cite them. Scanned PDFs without a text layer are not read (no OCR).

## Cairn Intelligence
Choose Claude, OpenAI, Gemini, Ollama or an OpenAI-compatible local server in Settings. Cloud use requires
an explicit opt-in. Chat about a page or your whole workspace with cited sources, rewrite or translate a
selection with a side-by-side preview, turn replies into tasks or pages, and build semantic-search embeddings.
Ask for tasks in plain language ("remind me to call Sam tomorrow at 3pm"): the assistant proposes them as a card with dates, times and priorities, and you create them with one click.

## Data ownership
Full backups (one JSON file, attachments included), Markdown ZIP export, imports from Markdown, HTML, text,
CSV, JSON, Obsidian vaults and unzipped Notion exports.
