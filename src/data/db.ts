import Dexie, { type Table } from "dexie";
import type {
  Activity, AiConversation, AiMessage, Attachment, CalendarEvent, Comment, Database, DbRecord, Embedding,
  Goal, Habit, Page, PageLink, PageRevision, Project, SavedSearch, SettingRow, Task, Template, Workspace,
} from "./types";

/**
 * Local-first store. IndexedDB (via Dexie) is used in both the browser and the Electron
 * shell; in Electron, Chromium persists it under the app's userData directory.
 *
 * Migration rule: never edit a published version block. Add `this.version(n + 1)` with
 * the new store definition and an `.upgrade()` callback for data changes.
 */
export class ReaDB extends Dexie {
  workspaces!: Table<Workspace, string>;
  pages!: Table<Page, string>;
  revisions!: Table<PageRevision, string>;
  links!: Table<PageLink, string>;
  databases!: Table<Database, string>;
  records!: Table<DbRecord, string>;
  tasks!: Table<Task, string>;
  projects!: Table<Project, string>;
  events!: Table<CalendarEvent, string>;
  attachments!: Table<Attachment, string>;
  comments!: Table<Comment, string>;
  templates!: Table<Template, string>;
  habits!: Table<Habit, string>;
  goals!: Table<Goal, string>;
  activity!: Table<Activity, string>;
  savedSearches!: Table<SavedSearch, string>;
  aiConversations!: Table<AiConversation, string>;
  aiMessages!: Table<AiMessage, string>;
  embeddings!: Table<Embedding, string>;
  settings!: Table<SettingRow, string>;

  constructor(name = "rea") {
    super(name);
    this.version(1).stores({
      workspaces: "id, createdAt",
      pages: "id, workspaceId, parentId, databaseId, [workspaceId+deletedAt], updatedAt, lastOpenedAt, favorite, *tags",
      revisions: "id, pageId, createdAt",
      links: "id, workspaceId, fromPageId, toPageId",
      databases: "id, workspaceId, pageId",
      records: "id, databaseId, [databaseId+deletedAt], updatedAt",
      tasks: "id, workspaceId, projectId, parentTaskId, [workspaceId+deletedAt], dueDate, status",
      projects: "id, workspaceId, [workspaceId+deletedAt]",
      events: "id, workspaceId, [workspaceId+deletedAt], start",
      attachments: "id, workspaceId, pageId, createdAt",
      comments: "id, pageId, createdAt",
      templates: "id, workspaceId",
      habits: "id, workspaceId",
      goals: "id, workspaceId",
      activity: "id, workspaceId, at, entityId",
      savedSearches: "id, workspaceId",
      aiConversations: "id, workspaceId, updatedAt",
      aiMessages: "id, conversationId, createdAt",
      embeddings: "id, workspaceId, pageId",
      settings: "key",
    });
  }
}

export const DB_SCHEMA_VERSION = 1;

/**
 * Partial update by primary key. Dexie typed UpdateSpec recurses into nested document
 * types (JSONContent, FilterGroup) and fails to type-check, so updates go through here.
 */
export function patch<T>(table: Table<T, string>, id: string, changes: Partial<T>): Promise<number> {
  return (table as unknown as Table<Record<string, unknown>, string>).update(id, changes as Record<string, unknown>);
}

let instance: ReaDB | null = null;
export function db(): ReaDB {
  if (!instance) instance = new ReaDB();
  return instance;
}
/** Test hook: point the app at a different database name. */
export function useDatabase(name: string): ReaDB {
  instance = new ReaDB(name);
  return instance;
}
