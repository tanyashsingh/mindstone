# Mindstone quality audit: findings (2026-11-27)

Audited version: 0.5.1 (commit `2803270`). Fixes are on top of it, in the working tree, for 0.5.2.

## What the app is

| Area | Finding |
|---|---|
| Shell | Electron 45 desktop app (Windows installer; Mac and Linux builds from CI) plus the same UI as a browser/PWA build |
| UI | React 19, TypeScript strict, Tailwind 4, Vite 8. Not Rust/Tauri: the Rust-specific checks in the brief do not apply |
| Editor | TipTap 3 (ProseMirror) with custom blocks: columns, synced blocks, buttons, math, diagrams, comments, suggestions |
| Data | IndexedDB through Dexie 4 (database `rea`, schema v2), optional AES-256-GCM encryption middleware, sync change log |
| State | Zustand stores (`src/store/app.ts`, `src/store/settings.ts`), `useLiveQuery` for database reads |
| Search | MiniSearch index, built incrementally and on idle |
| Styling | Design tokens as CSS variables in `src/styles.css`, Tailwind utilities, shared components in `src/components/ui.tsx` |
| Tests | Vitest (unit), Playwright in Chrome (end-to-end, accessibility with axe-core, PWA), Playwright Electron (desktop) |

## Screens inspected

Home, Inbox, Mindstone Intelligence (AI), Tasks (list, board, Eisenhower), Projects, Calendar (day, week, month, agenda),
Databases (table, board, calendar, chart, timeline), Knowledge graph, Files, Templates, Trash, Settings (every section),
page editor with slash menu, command palette (empty and with a query), digest dialog, confirm and prompt dialogs, the
phone layout, and Home at 800×600, 1024×768, 1280×720, 1366×768 and 1920×1080, all in light and dark.
Screenshots: `screenshots/before/` and `screenshots/after/` (44 each, plus the browser console log for each run).

## Issues

Severity: Critical (data loss or unusable), High (a common task fails or a group of people is excluded), Medium (a task
is harder than it should be, or an error is unhelpful), Low (polish).

| ID | Severity | Where | Problem (actual → expected) | Fix | Verified by |
|---|---|---|---|---|---|
| QA-01 | Medium | `src/views/Files.tsx` | Opening Files logged "Can't perform a React state update on a component that hasn't mounted yet": disk usage was requested during rendering → no side effects in render | Moved into an effect that ignores late answers | e2e QA-01; console log of the after run is empty |
| QA-02 | Medium | `src/views/Tasks.tsx` quick add | "Book venue next friday" kept the words in the title and had no date; only today, tomorrow, next week and ISO dates worked → common phrases set the due date | New `src/lib/quickDate.ts`: weekdays (full names anywhere; "fri" after on/next/this), "in 3 days/2 weeks", "next month", "dec 5", "5th December" (past dates roll to next year), ISO | 5 unit tests, e2e QA-02, after screenshot (Book venue due Dec 4) |
| QA-03 | Low | Sidebar | A "Shared" section only said sharing isn't set up: a heading with nothing to do | Removed | e2e QA-03 |
| QA-04 | Low | Sidebar sections | "Recent" is collapsed by default and looked like an empty heading; open/closed was forgotten on restart and not announced | Arrow shows a closed section, `aria-expanded`, state saved per section | e2e QA-04 (survives reload) |
| QA-05 | Low | Calendar toolbar | Permanent sentence that Google/Outlook sync "are not set up" (they work through Subscribe) | Removed; Settings still explains subscriptions | after screenshot |
| QA-06 | Low | Databases, Home, Trash, backlinks | New databases got a "▦" text glyph as icon (54 px in the header); pages without an icon showed 📄, ▦ or a line icon depending on the screen | One `PageIcon` component (line icons), databases get no automatic icon, old "▦" icons display as none (no data rewrite) | e2e QA-06, after screenshots |
| QA-07 | Low | Copy buttons (sync code, recovery key, pairing code, AI answer) | Copied silently; a failure was silent too | `copyText()` confirms or explains | e2e QA-07 |
| QA-08 | High | All dialogs and the command palette | Opening a dialog didn't move focus into it; Tab left it; closing didn't return focus; Escape closed the palette only while its text box had focus | `useFocusTrap` (focus in, Tab wraps, focus restored unless something else took it), `aria-labelledby`, Escape anywhere in the palette | e2e QA-08 (palette and digest dialog) |
| QA-09 | Low | Inbox activity | Pages are created untitled and named afterwards, so activity read "page created" with no name | Shows the page's current name as a link | e2e QA-09 |
| QA-10 | Medium | Home at small windows | Columns followed the window width, not the space beside the sidebar: at 800×600 the quick-capture boxes were cut off | Container queries (`@container`) | after screenshot `*-size-800x600-home.png` |
| QA-11 | Medium | Settings → Backup & restore, Import | A damaged backup showed "Restore failed: Unexpected token…"; an import error had no handler; an import could be started twice | Plain messages that say nothing changed; imports guarded with an "Importing…" state | e2e QA-11 |
| QA-12 | Medium | Page editor | Ctrl+F did nothing unless the cursor was in the text (the desktop app has no find bar of its own) | Opens find for the page in the main view when nothing else has focus | e2e QA-12 |
| QA-13 | Low | Command palette, page title | The global focus ring overrode components' own focus styles, drawing a clipped double outline in the palette | Global ring moved to the base layer, so components can replace it | after screenshot `*-palette-query.png` |
| QA-14 | Low | Interface text | 308 hand-picked font sizes (10.5, 11, 11.5, 12, 12.5, 13, 13.5 px…) | Named type scale: caption 11, meta 12, ui 13, body 14, lead 15 | full test suite, after screenshots |
| QA-15 | Low | Sidebar | The current item and a hovered item looked the same; not announced | Current item is medium weight and `aria-current="page"` | after screenshots |
| QA-16 | Low | Database table | The table's frame ran past its last column | Frame fits the columns | after screenshot |
| QA-17 | High | Releases | Installers are unsigned, so Windows SmartScreen and macOS Gatekeeper warn on first install | Blocked: needs a code-signing certificate (purchase) | — |
| QA-18 | Low | Mindstone Intelligence | With no chats, the chat-list column is empty apart from "New chat" | Open | — |

Not found: no data-loss, crash or security bug. All `dangerouslySetInnerHTML` uses are sanitised (DOMPurify, KaTeX with
`trust: false`, Mermaid with `securityLevel: "strict"`); `npm audit` reports 0 vulnerabilities in runtime dependencies.

## Not verified in this audit

- Windows display scaling (125–200 %), multiple monitors, window snapping and 2560×1440/3840×2160 screens: tested only by
  window size in Chromium, not on real scaled displays.
- Screen readers (NVDA, Narrator): only automated axe checks and keyboard tests.
- macOS and Linux builds: built and unit/e2e tested in CI, not used by hand.
