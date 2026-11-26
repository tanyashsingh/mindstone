# Mindstone database schema

Storage: IndexedDB database `rea`, managed by Dexie (`src/data/db.ts`). Schema version **1**.
All primary keys are 26-character ULID-style strings unless noted. `deletedAt = 0` means live, and any
other value is the soft-delete timestamp (epoch ms). Index syntax: `[a+b]` is compound and `*x` is multi-entry.

| Table | Key | Indexes | Purpose |
|---|---|---|---|
| workspaces | id | createdAt | Top-level container |
| pages | id | workspaceId, parentId, databaseId, [workspaceId+deletedAt], updatedAt, lastOpenedAt, favorite, *tags | Pages and database pages (tree via `parentId`) |
| revisions | id | pageId, createdAt | Page history (≤ 50 per page, ≥ 5 min apart) |
| links | `from:to:kind` | workspaceId, fromPageId, toPageId | Derived backlinks (`wiki`, `mention`, `embed`) |
| databases | id | workspaceId, pageId | Schema: `properties[]`, `views[]`, `nextSeq` |
| records | id | databaseId, [databaseId+deletedAt], updatedAt | Rows; `values` keyed by property id |
| tasks | id | workspaceId, projectId, parentTaskId, [workspaceId+deletedAt], dueDate, status | Tasks with subtasks, dependencies, recurrence |
| projects | id | workspaceId, [workspaceId+deletedAt] | Projects with embedded milestones |
| events | id | workspaceId, [workspaceId+deletedAt], start | Calendar events (UTC instants and the creating time zone) |
| attachments | id | workspaceId, pageId, createdAt | Files as Blobs (≤ 100 MB; executables blocked) |
| comments | id | pageId, createdAt | Local page comments |
| templates | id | workspaceId | User templates (built-ins live in code) |
| habits, goals | id | workspaceId | Productivity tools |
| activity | id | workspaceId, at, entityId | Activity log |
| savedSearches | id | workspaceId | Saved queries |
| aiConversations | id | workspaceId, updatedAt | Chat threads |
| aiMessages | id | conversationId, createdAt | Messages, provider, model, tokens, citations |
| embeddings | `pageId:chunk` | workspaceId, pageId | RAG vectors (derived; rebuildable) |
| settings | key | (none) | App settings (`settings`, `lastWorkspace`) |

Field definitions are the TypeScript interfaces in `src/data/types.ts` (the source of truth).

## Relationships and deletion policy

- `pages.parentId → pages.id`. Moving a page under its own descendant is rejected (`repo.movePage`).
  Trashing soft-deletes the whole subtree with one timestamp; restoring brings back exactly that subtree
  and re-roots it if the parent is gone. Purging deletes the subtree's revisions, links, comments,
  embeddings, attachments and owned database records.
- `databases.pageId ↔ pages.databaseId` (1:1). `records.databaseId → databases.id` (cascade on purge).
- Relation properties store arrays of record IDs in `records.values[propId]`; dangling IDs are ignored on read.
- `tasks.projectId → projects.id` (set to null when a project is deleted). `tasks.parentTaskId → tasks.id`.
  `tasks.dependsOn[]` is checked for cycles before insert (`repo.wouldCreateCycle`).
- Deleting a workspace removes every row that carries its `workspaceId`, plus dependent rows (records, messages).

## Migration rules

1. Never edit a published `this.version(n)` block.
2. Add `this.version(n + 1).stores({...})` with only the changed tables, plus `.upgrade(tx => …)` for data changes.
3. Bump `DB_SCHEMA_VERSION`, add a test that opens a v`n` database and checks the upgrade.
4. Backups record `schemaVersion`; restoring an older backup runs it through the same upgrade path.

## Backup format (`rea-backup`, version 1)

```json
{ "format": "rea-backup", "version": 1, "schemaVersion": 1, "exportedAt": "ISO-8601", "app": "Mindstone",
  "workspace": { …Workspace },
  "tables": { "pages": [], "links": [], "databases": [], "records": [], "tasks": [], "projects": [], "events": [],
              "templates": [], "habits": [], "goals": [], "activity": [], "savedSearches": [],
              "aiConversations": [], "aiMessages": [], "revisions": [], "comments": [] },
  "attachments": [{ "id": "…", "name": "…", "mime": "…", "size": 0, "data": "<base64>" }] }
```

Validation rejects unknown formats, newer versions and rows that belong to another workspace. Restoring keeps
the original IDs, and replacing an existing workspace requires explicit confirmation. Embeddings are excluded (derived).

## Retention

Revisions are capped at 50 per page. Trash is kept until emptied. Activity and AI history are kept until the
workspace or conversation is deleted. No data leaves the device unless a cloud AI provider is enabled and used.
