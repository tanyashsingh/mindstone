# CLAUDE.md: working on Mindstone

## Product
Mindstone is a local-first, privacy-first productivity and knowledge workspace (notes, block editor, databases,
tasks, projects, calendar, knowledge graph, optional AI). Core features must work offline and without an AI key.
Mindstone was called REA during early development; internal identifiers (IndexedDB name `rea`, `window.rea`, `rea-backup`) keep that name on purpose. It is distinct from the `rea` reverse-engineering CLI in `..\rea-main`; do not mix the two.

## Architecture (see ARCHITECTURE.md)
React 19 + TS strict + Vite 8 + Tailwind 4 · Electron 45 desktop · Dexie/IndexedDB storage · TipTap 3 editor ·
MiniSearch · Zustand · provider-independent AI layer (`src/ai/providers.ts`; Claude through `@anthropic-ai/sdk`).

## Commands (PowerShell)
- `npm run dev` (browser, port 5183) · `npm test` · `npm run test:e2e` (Playwright, installed Chrome) · `npm run typecheck` · `npm run check:all` · `npm run test:desktop` (built app in Electron)
- `npm run build` (typecheck + web + electron bundles) · `npm run dist:win` (NSIS installer in `release/`)
- `npm run voice:setup` once per checkout: downloads and SHA-256-verifies the Whisper model into git-ignored `public/voice/` (needed for voice features and builds)
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
- Never commit secrets. AI keys live in `%APPDATA%\Mindstone\secrets.json`, encrypted with DPAPI via `safeStorage`.
- Renderer stays sandboxed (contextIsolation, no nodeIntegration). New IPC channels go through `handle()` in
  `electron/main.ts` (sender check) and validate their inputs.
- Tests start their own dev server on port 5191 (`playwright.config.ts`); never reuse a server on another port.
- With passphrase protection on, Dexie hooks see encrypted rows: hooks may record keys only, then re-read rows.
- Plugins never get direct database or DOM access; extend `src/plugins/host.ts` with permission-checked methods.
- Large lists render in steps (`src/components/Limited.tsx`); don't render unbounded lists of tasks, pages or records.
- Release only through the tag-driven workflow (RELEASING.md). Keep `build.electronFuses` hardened.
- Cloud AI calls go through `guardBegin` in `src/ai/client.ts` (spending guard); don't bypass it.
- Workspace content goes to cloud AI only when `ai.allowCloud` is on; imported or retrieved content is wrapped as untrusted data.

## Database migrations
Never edit an existing `version(n)` block; add `version(n+1)` with an upgrade, bump `DB_SCHEMA_VERSION`, add a test.

## UI principles
Restrained neutral palette, thin borders, tokens in `src/styles.css` (`@utility` for primitives), keyboard
first, every list has an empty state, every async view has a loading state, respect reduced motion.

## Status
See IMPLEMENTATION_STATUS.md. The next steps are listed at its end.
