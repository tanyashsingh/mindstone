// Domain types for Cairn. All ids are ULID-like strings (time-sortable, sync-safe).
// Soft deletion uses `deletedAt` (0 = live) so it can be indexed by IndexedDB.

export type ID = string;
export type JSONContent = { type?: string; attrs?: Record<string, unknown>; content?: JSONContent[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

export interface Workspace {
  id: ID;
  name: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
}

export type PageKind = "page" | "database";

export interface Page {
  id: ID;
  workspaceId: ID;
  parentId: ID | null;
  kind: PageKind;
  title: string;
  icon: string;
  cover: string; // CSS gradient key or attachment id prefixed with "att:"
  content: JSONContent | null; // TipTap/ProseMirror document; blocks carry stable `id` attrs
  text: string; // derived plain text, used for search and RAG
  databaseId: ID | null; // set when kind === "database"
  tags: string[];
  favorite: 0 | 1;
  locked: 0 | 1;
  sortKey: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  deletedAt: number;
}

export interface PageRevision {
  id: ID;
  pageId: ID;
  title: string;
  content: JSONContent | null;
  createdAt: number;
}

export type LinkKind = "wiki" | "mention" | "embed";
export interface PageLink {
  id: ID; // `${from}:${to}:${kind}`
  workspaceId: ID;
  fromPageId: ID;
  toPageId: ID;
  kind: LinkKind;
}

// ---- Databases ----------------------------------------------------------
export type PropertyType =
  | "title" | "text" | "number" | "currency" | "percent" | "select" | "multiSelect" | "status"
  | "checkbox" | "date" | "dateRange" | "email" | "phone" | "url" | "files" | "person"
  | "relation" | "rollup" | "formula" | "rating" | "progress" | "createdTime" | "editedTime" | "uniqueId";

export interface SelectOption { id: ID; name: string; color: string }

export interface Property {
  id: ID;
  name: string;
  type: PropertyType;
  options?: SelectOption[]; // select / multiSelect / status
  formula?: string; // formula expression
  relationDatabaseId?: ID; // relation target
  rollup?: { relationPropertyId: ID; targetPropertyId: ID; fn: "count" | "sum" | "avg" | "min" | "max" | "showOriginal" };
  currency?: string;
  width?: number;
  prefix?: string; // uniqueId prefix
}

export type FilterOp =
  | "eq" | "neq" | "contains" | "notContains" | "gt" | "lt" | "gte" | "lte" | "isEmpty" | "isNotEmpty" | "checked" | "unchecked";
export interface FilterRule { kind: "rule"; propertyId: ID; op: FilterOp; value?: unknown }
export interface FilterGroup { kind: "group"; mode: "and" | "or"; children: (FilterRule | FilterGroup)[] }
export interface SortRule { propertyId: ID; dir: "asc" | "desc" }

export type ViewType = "table" | "board" | "list" | "gallery" | "calendar" | "timeline" | "chart";
export interface DatabaseView {
  id: ID;
  name: string;
  type: ViewType;
  filter: FilterGroup;
  sorts: SortRule[];
  groupBy?: ID; // select/status property for board & grouping
  dateProperty?: ID; // calendar / timeline
  hidden: ID[];
  order: ID[]; // column order
  search?: string;
}

/** Pre-filled values for new records (stored on the database; no schema change needed). */
export interface RecordTemplate { id: ID; name: string; values: Record<ID, unknown> }

export interface Database {
  id: ID;
  workspaceId: ID;
  pageId: ID;
  name: string;
  properties: Property[];
  views: DatabaseView[];
  nextSeq: number; // for uniqueId property
  templates?: RecordTemplate[];
  createdAt: number;
  updatedAt: number;
}

export interface DbRecord {
  id: ID;
  databaseId: ID;
  seq: number;
  values: Record<ID, unknown>;
  sortKey: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number;
}

// ---- Tasks & projects ----------------------------------------------------
export type TaskStatus = "todo" | "doing" | "blocked" | "done";
export type Priority = "none" | "low" | "medium" | "high" | "urgent";
export type Recurrence = { freq: "daily" | "weekly" | "monthly" | "yearly"; interval: number; until?: string } | null;

export interface Task {
  id: ID;
  workspaceId: ID;
  projectId: ID | null;
  parentTaskId: ID | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  startDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  reminderAt: number | null;
  tags: string[];
  dependsOn: ID[];
  recurrence: Recurrence;
  estimateMin: number;
  actualMin: number;
  important: 0 | 1; // Eisenhower axis (urgency derives from due date)
  sortKey: number;
  completedAt: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number;
}

export interface Milestone { id: ID; name: string; date: string | null; done: boolean }
export interface Project {
  id: ID;
  workspaceId: ID;
  name: string;
  description: string;
  status: "planned" | "active" | "paused" | "completed";
  color: string;
  startDate: string | null;
  targetDate: string | null;
  milestones: Milestone[];
  docPageId: ID | null;
  archived: 0 | 1;
  createdAt: number;
  updatedAt: number;
  deletedAt: number;
}

// ---- Calendar -------------------------------------------------------------
export interface CalendarEvent {
  id: ID;
  workspaceId: ID;
  title: string;
  notes: string;
  start: number; // epoch ms (UTC instant)
  end: number;
  allDay: 0 | 1;
  timezone: string; // IANA zone the event was created in
  calendar: string; // calendar name (colour-coded)
  color: string;
  recurrence: Recurrence;
  reminderMin: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number;
}

// ---- Files ----------------------------------------------------------------
export interface Attachment {
  id: ID;
  workspaceId: ID;
  pageId: ID | null;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
  /** Extracted plain text (PDF, Word, text-like files) for search and AI. */
  text?: string;
  /** undefined = not processed yet. */
  textStatus?: "ok" | "empty" | "unsupported" | "error";
}

export interface Comment {
  id: ID;
  pageId: ID;
  body: string;
  author: string;
  resolved: 0 | 1;
  createdAt: number;
}

export interface Template {
  id: ID;
  workspaceId: ID | null;
  name: string;
  description: string;
  icon: string;
  content: JSONContent;
  builtIn: boolean;
  createdAt: number;
}

export interface Habit { id: ID; workspaceId: ID; name: string; days: string[]; createdAt: number }
export interface Goal { id: ID; workspaceId: ID; name: string; target: number; current: number; unit: string; due: string | null; createdAt: number }

export interface Activity {
  id: ID;
  workspaceId: ID;
  at: number;
  entity: "page" | "task" | "project" | "event" | "database" | "record" | "workspace" | "ai";
  entityId: ID;
  action: string;
  detail: string;
}

export interface SavedSearch { id: ID; workspaceId: ID; name: string; query: string; createdAt: number }

// ---- AI ---------------------------------------------------------------------
export type AiProviderId = "anthropic" | "openai" | "gemini" | "ollama" | "openaiCompatible";
export interface AiConversation { id: ID; workspaceId: ID; title: string; pageId: ID | null; createdAt: number; updatedAt: number }
export interface Citation { pageId: ID; title: string; snippet: string; attachmentId?: ID }
export interface AiMessage {
  id: ID;
  conversationId: ID;
  role: "user" | "assistant" | "system";
  content: string;
  provider: string;
  model: string;
  citations: Citation[];
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
}
export interface Embedding {
  id: ID; // `${pageId}:${chunkIndex}`
  workspaceId: ID;
  pageId: ID;
  chunkIndex: number;
  text: string;
  vector: number[];
  model: string;
  pageUpdatedAt: number;
}

export interface SettingRow { key: string; value: unknown }
