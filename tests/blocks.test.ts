import { beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { db, useDatabase, DB_SCHEMA_VERSION } from "@/data/db";
import * as repo from "@/data/repo";
import { createBackup, restoreBackup } from "@/data/backup";
import { SearchIndex } from "@/data/search";
import { docToMarkdown, docToText } from "@/lib/doc";
import type { JSONContent } from "@/data/types";

let n = 0;
beforeEach(() => { useDatabase(`blocks-${Date.now()}-${n++}`); });

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("columns, synced and button blocks", () => {
  it("columns export in reading order and their text is searchable", () => {
    const doc: JSONContent = { type: "doc", content: [{ type: "columns", content: [{ type: "column", content: [p("Left")] }, { type: "column", content: [p("Right")] }] }] };
    expect(docToMarkdown(doc)).toMatch(/Left\s+Right/);
    expect(docToText(doc)).toMatch(/Left[\s\S]*Right/);
  });

  it("synced block content is exported where each copy sits; buttons are left out", () => {
    const shared: JSONContent = { type: "doc", content: [p("Shared line")] };
    const doc: JSONContent = { type: "doc", content: [p("Before"), { type: "syncedBlock", attrs: { syncId: "s1" } }, { type: "buttonBlock", attrs: { label: "Go" } }, p("After")] };
    const md = docToMarkdown(doc, () => "page", (id) => (id === "s1" ? shared : undefined));
    expect(md).toMatch(/Before\s+Shared line\s+After/);
    expect(md).not.toContain("Go");
  });

  it("saves synced content, indexes it under its page, and keeps it in backups", async () => {
    const ws = await repo.createWorkspace("W");
    const page = await repo.createPage(ws.id, null, { title: "Home base" });
    const s = await repo.createSyncedBlock(ws.id, page.id);
    await repo.saveSyncedBlock(s.id, { type: "doc", content: [p("Quarterly target is 40 customers")] }, "editor-a");
    const row = await db().syncedBlocks.get(s.id);
    expect(row?.text).toContain("40 customers");
    expect(row?.editedBy).toBe("editor-a");

    const idx = new SearchIndex();
    await idx.build(ws.id);
    const hit = idx.search("customers").find((h) => h.id === `synced:${s.id}`);
    expect(hit?.refId).toBe(page.id);
    expect(hit?.kind).toBe("page");

    const backup = JSON.parse(JSON.stringify(await createBackup(ws.id)));
    expect(backup.tables.syncedBlocks).toHaveLength(1);
    await restoreBackup(backup, { replace: true });
    expect((await db().syncedBlocks.get(s.id))?.text).toContain("40 customers");

    await repo.deleteWorkspace(ws.id);
    expect(await db().syncedBlocks.count()).toBe(0);
  });

  it("upgrades a version 1 database without losing data", async () => {
    const name = `upgrade-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores({ workspaces: "id, createdAt", pages: "id, workspaceId, parentId, databaseId, [workspaceId+deletedAt], updatedAt, lastOpenedAt, favorite, *tags", settings: "key" });
    await old.table("workspaces").put({ id: "w1", name: "Old", icon: "", createdAt: 1, updatedAt: 1 });
    old.close();
    const d = useDatabase(name);
    await d.open();
    expect(d.verno).toBe(DB_SCHEMA_VERSION);
    expect((await d.workspaces.get("w1"))?.name).toBe("Old");
    expect(await d.syncedBlocks.count()).toBe(0);
  });
});
