import { beforeEach, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { createBackup, restoreBackup } from "@/data/backup";
import { SearchIndex } from "@/data/search";
import { groupRecords, queryView } from "@/lib/dbquery";

let n = 0;
beforeEach(() => {
  useDatabase(`test-${Date.now()}-${n++}`);
});

describe("pages", () => {
  it("creates nested pages and prevents cycles", async () => {
    const ws = await repo.createWorkspace("Test");
    const a = await repo.createPage(ws.id, null, { title: "A" });
    const b = await repo.createPage(ws.id, a.id, { title: "B" });
    const c = await repo.createPage(ws.id, b.id, { title: "C" });
    expect(await repo.movePage(a.id, c.id)).toBe(false);
    expect(await repo.movePage(a.id, a.id)).toBe(false);
    expect(await repo.movePage(c.id, null)).toBe(true);
  });

  it("saves content, tracks backlinks and persists", async () => {
    const ws = await repo.createWorkspace("Test");
    const target = await repo.createPage(ws.id, null, { title: "Roadmap" });
    const src = await repo.createPage(ws.id, null, { title: "Notes" });
    await repo.savePageContent(src.id, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "see [[roadmap]] #q1" }] }] });
    const back = await db().links.where("toPageId").equals(target.id).toArray();
    expect(back.map((l) => l.fromPageId)).toEqual([src.id]);
    const reloaded = await repo.getPage(src.id);
    expect(reloaded?.text).toContain("see [[roadmap]]");
    expect(reloaded?.tags).toEqual(["q1"]);
    expect(await db().revisions.where("pageId").equals(src.id).count()).toBe(1);
  });

  it("trashes and restores a subtree, and refuses edits when locked", async () => {
    const ws = await repo.createWorkspace("Test");
    const a = await repo.createPage(ws.id, null, { title: "A" });
    const b = await repo.createPage(ws.id, a.id, { title: "B" });
    await repo.trashPage(a.id);
    expect((await repo.livePages(ws.id)).length).toBe(0);
    await repo.restorePage(a.id);
    expect((await repo.livePages(ws.id)).map((p) => p.title).sort()).toEqual(["A", "B"]);
    await repo.updatePageMeta(b.id, { locked: 1 });
    await expect(repo.savePageContent(b.id, { type: "doc", content: [] })).rejects.toThrow(/locked/);
    await repo.purgePage(a.id);
    expect(await repo.getPage(b.id)).toBeUndefined();
  });

  it("duplicates a page with fresh block ids", async () => {
    const ws = await repo.createWorkspace("Test");
    const a = await repo.createPage(ws.id, null, { title: "A", content: { type: "doc", content: [{ type: "paragraph", attrs: { id: "blk" }, content: [{ type: "text", text: "x" }] }] } });
    const copy = await repo.duplicatePage(a.id);
    expect(copy?.title).toBe("A (copy)");
    expect(copy?.content?.content?.[0]?.attrs?.id).not.toBe("blk");
  });
});

describe("databases", () => {
  it("filters, sorts and groups records consistently across views", async () => {
    const ws = await repo.createWorkspace("Test");
    const { database } = await repo.createDatabase(ws.id, null, "Tasks", [
      repo.newProperty("Name", "title"),
      repo.newProperty("Status", "status"),
      repo.newProperty("Points", "number"),
      repo.newProperty("Double", "formula", { formula: 'prop("Points") * 2' }),
    ]);
    const [name, status, points, dbl] = database.properties;
    const [notStarted, , done] = status!.options!;
    await repo.addRecord(database.id, { [name!.id]: "b", [points!.id]: 5, [status!.id]: done!.id });
    const r2 = await repo.addRecord(database.id, { [name!.id]: "a", [points!.id]: 1, [status!.id]: notStarted!.id });
    await repo.addRecord(database.id, { [name!.id]: "c", [points!.id]: 9 });
    const fresh = (await db().databases.get(database.id))!;
    fresh.views[0]!.sorts = [{ propertyId: points!.id, dir: "desc" }];
    fresh.views[0]!.filter = {
      kind: "group",
      mode: "or",
      children: [
        { kind: "rule", propertyId: dbl!.id, op: "gt", value: 5 },
        { kind: "group", mode: "and", children: [{ kind: "rule", propertyId: status!.id, op: "eq", value: notStarted!.id }] },
      ],
    };
    let recs = await db().records.where("databaseId").equals(database.id).toArray();
    expect(queryView(fresh, recs, fresh.views[0]!.id).map((r) => r.values[name!.id])).toEqual(["c", "b", "a"]);
    await repo.updateRecord(r2.id, status!.id, done!.id);
    recs = await db().records.where("databaseId").equals(database.id).toArray();
    const board = groupRecords(fresh, recs, status!.id);
    expect(board.find((g) => g.label === "Done")?.records.length).toBe(2);
    expect(recs.map((r) => r.seq).sort()).toEqual([1, 2, 3]);
  });
});

describe("record templates", () => {
  it("saves editable values, skips computed ones, and survives property deletion", async () => {
    const ws = await repo.createWorkspace("T");
    const { database } = await repo.createDatabase(ws.id, null, "Bugs", [
      repo.newProperty("Name", "title"), repo.newProperty("Priority", "select"), repo.newProperty("Estimate", "number"),
      repo.newProperty("Double", "formula", { formula: 'prop("Estimate") * 2' }), repo.newProperty("ID", "uniqueId"),
    ]);
    const [name, prio, est, dbl, idp] = database.properties;
    await repo.saveRecordTemplate(database.id, "Bug report", { [name!.id]: "Bug: ", [prio!.id]: "p1", [est!.id]: 3, [dbl!.id]: 6, [idp!.id]: "X-1", stale: "gone" });
    let fresh = (await db().databases.get(database.id))!;
    const tpl = fresh.templates![0]!;
    expect(tpl.name).toBe("Bug report");
    expect(Object.keys(tpl.values).sort()).toEqual([est!.id, name!.id, prio!.id].sort());

    const r = await repo.addRecordFromTemplate(database.id, tpl.id);
    expect(r.values[name!.id]).toBe("Bug: ");
    expect(r.values[est!.id]).toBe(3);

    // Delete the Estimate property: new records from the template no longer carry its value.
    await repo.updateDatabase(database.id, { properties: fresh.properties.filter((p) => p.id !== est!.id) });
    const r2 = await repo.addRecordFromTemplate(database.id, tpl.id);
    expect(r2.values[est!.id]).toBeUndefined();
    expect(r2.seq).toBe(r.seq + 1);

    await repo.deleteRecordTemplate(database.id, tpl.id);
    fresh = (await db().databases.get(database.id))!;
    expect(fresh.templates).toEqual([]);
  });
});

describe("tasks", () => {
  it("rolls recurring tasks forward and detects dependency cycles", async () => {
    const ws = await repo.createWorkspace("Test");
    const t = await repo.createTask(ws.id, { title: "Water plants", dueDate: "2026-03-01", recurrence: { freq: "weekly", interval: 1 } });
    await repo.updateTask(t.id, { status: "done" });
    const all = await db().tasks.where("workspaceId").equals(ws.id).toArray();
    expect(all.find((x) => x.status === "todo")?.dueDate).toBe("2026-03-08");
    const a = await repo.createTask(ws.id, { title: "a" });
    const b = await repo.createTask(ws.id, { title: "b", dependsOn: [a.id] });
    expect(await repo.wouldCreateCycle(a.id, b.id)).toBe(true);
    expect((await repo.openBlockers(b)).map((x) => x.id)).toEqual([a.id]);
  });
});

describe("backup and search", () => {
  it("restores a workspace backup exactly", async () => {
    const ws = await repo.createWorkspace("Backup me");
    const p = await repo.createPage(ws.id, null, { title: "Hello" });
    await repo.savePageContent(p.id, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "persist me" }] }] });
    const { database } = await repo.createDatabase(ws.id, p.id, "DB");
    await repo.addRecord(database.id, { [database.properties[0]!.id]: "row" });
    await repo.createTask(ws.id, { title: "task" });
    const backup = JSON.parse(JSON.stringify(await createBackup(ws.id)));
    await expect(restoreBackup(backup, { replace: false })).rejects.toThrow(/already exists/);
    await restoreBackup(backup, { replace: true });
    expect((await repo.getPage(p.id))?.text).toBe("persist me");
    expect(await db().records.where("databaseId").equals(database.id).count()).toBe(1);
    expect(await db().tasks.where("workspaceId").equals(ws.id).count()).toBe(1);
    await expect(restoreBackup({ format: "nope" }, { replace: true })).rejects.toThrow(/Not a REA backup/);
  });

  it("finds pages, records and tasks with fuzzy matching", async () => {
    const ws = await repo.createWorkspace("S");
    const p = await repo.createPage(ws.id, null, { title: "Quarterly planning" });
    await repo.savePageContent(p.id, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "budget allocation for marketing" }] }] });
    await repo.createTask(ws.id, { title: "Review budget" });
    const idx = new SearchIndex();
    await idx.build(ws.id);
    expect(idx.search("budgat").map((h) => h.kind).sort()).toEqual(["page", "task"]);
    expect(idx.search("quart")[0]?.title).toBe("Quarterly planning");
    expect(idx.search("budget", { kinds: ["task"] }).length).toBe(1);
  });
});
