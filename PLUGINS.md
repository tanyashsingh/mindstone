# Writing Mindstone plugins

A plugin is a folder with a `manifest.json` and one JavaScript file. Install it in **Settings → Plugins → Install
from folder** (or from a .zip of the folder). A complete example is in [plugins/word-count](plugins/word-count).

## Safety model

Each plugin runs in its own sandboxed frame with an opaque origin. It **cannot**:

- use the network (no fetch, XHR, WebSocket or images: `connect-src 'none'`, `img-src 'none'`),
- see Mindstone's page, database, local storage or cookies,
- do anything except through the `mindstone` API below, and every call is checked against the permissions shown to
  you before installing.

Plugins are kept on the device where you install them; they are not synced.

## manifest.json

```json
{
  "id": "word-count",               // lowercase letters, digits and dashes
  "name": "Word count",
  "version": "1.0.0",
  "description": "What it does, shown before installing.",
  "permissions": ["pages:read", "pages:write"],
  "main": "main.js"
}
```

Permissions: `pages:read` (read pages), `pages:write` (create pages and add to them), `tasks:read`, `tasks:write`
(create tasks). Commands, slash items and the panel need no permission.

## The `mindstone` API

The plugin's file is a JavaScript module (top-level `await` works). Every data call returns a promise.

| Call | Does | Needs |
|---|---|---|
| `mindstone.commands.register(id, label, handler)` | Adds "Plugin name: label" to the command palette (Ctrl+K) | |
| `mindstone.slash.register(id, title, handler)` | Adds a slash item; the handler returns Markdown to insert | |
| `mindstone.panel.render(markdown, buttons?)` | Shows Markdown in the right panel's Plugins tab; buttons are `{ id, label }` | |
| `mindstone.panel.onButton(id, handler)` | Runs when a panel button is clicked | |
| `mindstone.on("pageChanged", fn)` | Called with `{ id }` (or `null`) when the open page changes | |
| `mindstone.pages.current()` | The open page: `{ id, title, text, tags, updatedAt }` or `null` | pages:read |
| `mindstone.pages.get(id)` / `.list()` / `.search(query)` | Read pages | pages:read |
| `mindstone.pages.create(title, markdown)` | New page; returns its id | pages:write |
| `mindstone.pages.append(id, markdown)` | Adds Markdown to the end of a page | pages:write |
| `mindstone.tasks.list()` | Tasks: `{ id, title, status, dueDate, priority, tags }` | tasks:read |
| `mindstone.tasks.create({ title, dueDate })` | New task; returns its id | tasks:write |
| `mindstone.toast(text)` | A short message | |

Handlers may be async; they have 15 seconds to finish. Errors appear in Settings → Plugins.
