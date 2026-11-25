# CLAUDE.md: working on Cairn

## Product
Cairn is a local-first, privacy-first productivity and knowledge workspace (notes, block editor, databases,
tasks, projects, calendar, knowledge graph, optional AI). Core features must work offline and without an AI key.
Cairn was called REA during early development; internal identifiers (IndexedDB name `rea`, `window.rea`, `rea-backup`) keep that name on purpose. It is distinct from the `rea` reverse-engineering CLI in `..\rea-main`; do not mix the two.

## Architecture (see ARCHITECTURE.md)
React 19 + TS strict + Vite 8 + Tailwind 4 · Electron 45 desktop · Dexie/IndexedDB storage · TipTap 3 editor ·
MiniSearch · Zustand · provider-independent AI layer (`src/ai/providers.ts`; Claude through `@anthropic-ai/sdk`).

## Commands (PowerShell)
- `npm run dev` (browser, port 5183) · `npm test` · `npm run test:e2e` (Playwright, installed Chrome) · `npm run typecheck` · `npm run check:all` · `npm run test:desktop` (built app in Electron)
- `npm run build` (typecheck + web + electron bundles) · `npm run dist:win` (NSIS installer in `release/`)
- `node scripts/render-logo.mjs` re-renders the 3D logo (brand/, build/icon.png, public/favicon.png, src/assets/)

## Conventions
- All writes go through `src/data/repo.ts`; views read with `useLiveQuery`. Use `patch()` from `db.ts` for
  partial updates on tables with nested document types (Dexie typing limitation).
- `src/lib/` stays pure (no React, Dexie or DOM) and unit-tested.
- IDs come from `uid()`; soft delete with `deletedAt`; timestamps in epoch ms; calendar dates are `YYYY-MM-DD`.
- No `eval`/`new Function`. Render user HTML only through DOMPurify. Links: http, https and mailto only.
- No fake UI: if something needs infrastructure that isn't configured, say so in the UI.
- Keep `IMPLEMENTATION_STATUS.md` current; mark features Tested only when tests exist.

## Security rules
- Never commit secrets. AI keys live in `%APPDATA%\Cairn\secrets.json`, encrypted with DPAPI via `safeStorage`.
- Renderer stays sandboxed (contextIsolation, no nodeIntegration). New IPC channels go through `handle()` in
  `electron/main.ts` (sender check) and validate their inputs.
- Workspace content goes to cloud AI only when `ai.allowCloud` is on; imported or retrieved content is wrapped as untrusted data.

## Database migrations
Never edit an existing `version(n)` block; add `version(n+1)` with an upgrade, bump `DB_SCHEMA_VERSION`, add a test.

## UI principles
Restrained neutral palette, thin borders, tokens in `src/styles.css` (`@utility` for primitives), keyboard
first, every list has an empty state, every async view has a loading state, respect reduced motion.

## Status
See IMPLEMENTATION_STATUS.md. The next steps are listed at its end.
