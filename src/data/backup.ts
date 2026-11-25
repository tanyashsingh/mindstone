import { db, DB_SCHEMA_VERSION } from "./db";
import type { ID, Workspace } from "./types";
import { deleteWorkspace } from "./repo";

/**
 * Workspace backup format "rea-backup", version 1 (documented in DATABASE_SCHEMA.md).
 * A single JSON document; attachment blobs are base64-encoded. Embeddings are omitted
 * (they are derived and can be rebuilt). Restores keep original ids.
 */
export const BACKUP_FORMAT = "rea-backup";
export const BACKUP_VERSION = 1;

const WS_TABLES = ["pages", "links", "databases", "tasks", "projects", "events", "templates", "habits", "goals", "activity", "savedSearches", "aiConversations"] as const;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  app: string;
  workspace: Workspace;
  tables: Record<string, unknown[]>;
  attachments: { id: ID; workspaceId: ID; pageId: ID | null; name: string; mime: string; size: number; createdAt: number; data: string }[];
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: mime });
}

export async function createBackup(workspaceId: ID): Promise<BackupFile> {
  const d = db();
  const workspace = await d.workspaces.get(workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  const tables: Record<string, unknown[]> = {};
  for (const name of WS_TABLES) tables[name] = await d.table(name).where("workspaceId").equals(workspaceId).toArray();
  const pageIds = (tables.pages as { id: ID }[]).map((p) => p.id);
  const dbIds = (tables.databases as { id: ID }[]).map((x) => x.id);
  const convIds = (tables.aiConversations as { id: ID }[]).map((x) => x.id);
  tables.revisions = await d.revisions.where("pageId").anyOf(pageIds).toArray();
  tables.comments = await d.comments.where("pageId").anyOf(pageIds).toArray();
  tables.records = await d.records.where("databaseId").anyOf(dbIds).toArray();
  tables.aiMessages = await d.aiMessages.where("conversationId").anyOf(convIds).toArray();
  const atts = await d.attachments.where("workspaceId").equals(workspaceId).toArray();
  const attachments = [];
  for (const a of atts) attachments.push({ id: a.id, workspaceId: a.workspaceId, pageId: a.pageId, name: a.name, mime: a.mime, size: a.size, createdAt: a.createdAt, data: await blobToBase64(a.blob) });
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: DB_SCHEMA_VERSION, exportedAt: new Date().toISOString(), app: "Cairn", workspace, tables, attachments };
}

export class BackupError extends Error {}

export function validateBackup(raw: unknown): BackupFile {
  const b = raw as Partial<BackupFile>;
  if (!b || typeof b !== "object" || b.format !== BACKUP_FORMAT) throw new BackupError("Not a Cairn backup file");
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) throw new BackupError(`Unsupported backup version ${String(b.version)}`);
  if (!b.workspace || typeof b.workspace.id !== "string") throw new BackupError("Backup has no workspace");
  if (!b.tables || typeof b.tables !== "object") throw new BackupError("Backup has no tables");
  const wsId = b.workspace.id;
  for (const [name, rows] of Object.entries(b.tables)) {
    if (!Array.isArray(rows)) throw new BackupError(`Table ${name} is malformed`);
    if ((WS_TABLES as readonly string[]).includes(name) && rows.some((r) => (r as { workspaceId?: string }).workspaceId !== wsId)) {
      throw new BackupError(`Table ${name} contains rows from another workspace`);
    }
  }
  return b as BackupFile;
}

/** Restore a backup. When the workspace already exists, `replace` must be true. */
export async function restoreBackup(raw: unknown, opts: { replace: boolean }): Promise<Workspace> {
  const b = validateBackup(raw);
  const d = db();
  const existing = await d.workspaces.get(b.workspace.id);
  if (existing && !opts.replace) throw new BackupError("This workspace already exists. Confirm replacement to restore over it.");
  if (existing) await deleteWorkspace(existing.id);
  await d.transaction("rw", d.tables, async () => {
    await d.workspaces.put(b.workspace);
    for (const [name, rows] of Object.entries(b.tables)) {
      if (!d.tables.some((t) => t.name === name) || name === "settings" || name === "workspaces") continue;
      await d.table(name).bulkPut(rows);
    }
    await d.attachments.bulkPut(b.attachments.map((a) => ({ id: a.id, workspaceId: b.workspace.id, pageId: a.pageId, name: a.name, mime: a.mime, size: a.size, createdAt: a.createdAt, blob: base64ToBlob(a.data, a.mime) })));
  });
  return b.workspace;
}
