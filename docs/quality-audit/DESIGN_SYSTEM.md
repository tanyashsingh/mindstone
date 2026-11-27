# Mindstone design system

Everything visual comes from `src/styles.css` (tokens and primitives) and `src/components/ui.tsx` (shared components).
Use these before writing new styles.

## Character

"Ivory and ink" in light, "graphite and brass" in dark. Calm, editorial, content first: a book serif for titles
(Newsreader), the system sans for the interface (Segoe UI Variable on Windows), one accent per theme, depth from hairline
rings and soft warm shadows rather than borders and gradients. No decorative gradients except page covers the person picks.

## Tokens (CSS variables)

| Role | Token | Tailwind |
|---|---|---|
| App background | `--bg` | `bg-bg` |
| Raised surface (cards, menus, inputs) | `--bg-elev` | `bg-elev` |
| Sunken surface (sidebar, code) | `--bg-sunken` | `bg-sunken` |
| Hover / pressed | `--bg-hover` / `--bg-active` | `bg-hover` / `bg-active` |
| Text: primary, secondary, faint | `--fg`, `--fg-muted`, `--fg-faint` | `text-fg`, `text-muted`, `text-faint` |
| Lines | `--border`, `--border-strong` | `border-line`, `border-line-strong` |
| Accent and text on it | `--accent`, `--accent-fg`, `--accent-soft` | `bg-accent`, `text-on-accent`, `bg-accent-soft` |
| Status | `--danger`, `--success`, `--warning` | `text-danger` … |
| Elevation | `--elev-sm` (controls), `--elev` (cards), `--pop` (menus, dialogs), `--inset` (fields) | `shadow-[var(--elev)]` |
| Radius | 8 px controls, 12 px cards and menus, 14 px panels | `rounded-[8px]` … |

Themes: light, dark, OLED dark, and high contrast (light and dark, 7:1 text, solid borders, 3 px focus rings), which also
follows Windows' contrast setting. `forced-colors` is respected. Faint text is at least 4.5:1 on every surface.

## Type scale

| Token | Size | Use |
|---|---|---|
| `text-caption` | 11 px | Counts, keyboard hints, timestamps in dense lists |
| `text-meta` | 12 px | Secondary lines, descriptions, chips |
| `text-ui` | 13 px | Default interface text: menus, buttons, lists, fields |
| `text-body` | 14 px | Reading text outside the editor, chat messages |
| `text-lead` | 15 px | The command palette field |
| view title | 26 px serif (`h1`) | Top of each view |
| editor | 16 px (setting), headings 2.05 / 1.55 / 1.25 em serif | Page content |

`label` is the uppercase 11 px section label (caption size, semibold, tracked). Use only these sizes; a new size needs a token.

## Spacing and sizing

4 px base: gaps of 4/8/12/16/24 px (`gap-1` … `gap-6`). Controls are 32 px tall (`h-8`), compact rows 28 px (`h-7`),
fields 36 px (`h-9`). Icons are Lucide, 14 px in controls, 16 px in navigation, 22 px beside a view title.

## Primitives (`@utility` in styles.css)

`btn`, `btn-primary`, `btn-outline`, `btn-danger`, `icon-btn` (always give it `aria-label`), `input`, `textarea`,
`label`, `panel`, `menu`, `menu-item`, `chip` (with `c-<colour>`), `kbd`, `skeleton`, `anim-in`.
States: hover uses `bg-hover`, pressed `bg-active`, disabled is 40 % opacity and not clickable, focus is the accent ring
(`:focus-visible`, in the base layer so a field can replace it with its inset ring).

## Components (`src/components/ui.tsx`)

| Component | Use |
|---|---|
| `Modal` | Any dialog. Moves focus in, keeps Tab inside, Escape and outside click close, focus returns afterwards |
| `confirmDialog`, `promptDialog`, `chooseDialog` | Promise-based questions; use `danger` for destructive actions and say what can't be undone |
| `Popover`, `MenuItem`, `MenuSep`, `useAnchor` | Menus and pickers anchored to a control; Escape closes |
| `useFocusTrap` | For custom overlays (the command palette uses it) |
| `EmptyState` | Icon, title, one sentence, optional action. Every list has one |
| `Skeleton` | Loading placeholder for lists and views |
| `Chip`, `Toggle`, `IconPicker` | Tags and options, switches, emoji picker |
| `PageIcon`, `ownIcon` | A page's icon or the standard line icon; never hard-code 📄 |
| `copyText` | Copy with a confirmation toast |
| Toasts (`useApp().toast`) | `success`, `info` or `error`, with an optional action such as Undo |

## Motion

Short and functional: 140 ms fade-and-rise for menus and dialogs, 150 ms colour transitions on controls. Both honour
`prefers-reduced-motion` and the app's own "Reduce motion" setting.

## Rules

- No new colours, sizes or shadows inline: add a token.
- No control without a working action. If a build can't do something, hide the control or explain why.
- Every icon-only button has an accessible name; every view has an `h1`; every dialog has a title.
- Information is never carried by colour alone (priorities have words, status has icons).
