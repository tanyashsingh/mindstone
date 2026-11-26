import { beforeEach, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { applyChanges, databaseContext, planActions, stripActions, tasksContext, undoChanges, pageRefs } from "@/ai/agentActions";

let n = 0;
beforeEach(() => { useDatabase(`acts-${Date.now()}-${n++}`); });

describe("assistant actions", () => {
  it("parses the block out of a reply", () => {
    const r = stripActions('Here you go.\n```cairn-actions\n[{"op":"task","ref":"T1","status":"done"}]\n```');
    expect(r.display).toBe("Here you go.");
    expect(r.raw).toEqual([{ op: "task", ref: "T1", status: "done" }]);
    expect(stripActions("```cairn-actions\nnot json\n```").raw).toBeNull();
  });

  it("validates, applies and undoes task, tag and field changes", async () => {
    const ws = await repo.createWorkspace("W");
    const a = await repo.createTask(ws.id, { title: "Renew passport", dueDate: "2026-11-20", tags: ["admin"] });
    const b = await repo.createTask(ws.id, { title: "Book dentist", dueDate: "2026-12-01" });
    const page = await repo.createPage(ws.id, null, { title: "Trip", tags: ["travel"] });
    const { database } = await repo.createDatabase(ws.id, null, "Deals");
    const [name, status, , date] = database.properties;
    const rec = await repo.addRecord(database.id, { [name!.id]: "Acme" });

    const tc = await tasksContext(ws.id);
    expect(tc.text).toContain('T1: "Renew passport"');
    const dc = (await databaseContext(database.id))!;
    expect(dc.text).toContain("R1:");
    expect(dc.text).toMatch(/Status \(status: Not started \| In progress \| Done\)/);
    const refs = { ...tc.refs, ...pageRefs([page.id]), ...dc.refs };

    const { changes, skipped } = await planActions([
      { op: "task", ref: "T1", status: "done", addTags: ["#Done-Soon"], removeTags: ["admin"] },
      { op: "task", ref: "t2", due: "2026-12-05", priority: "high" },
      { op: "tags", ref: "P1", add: ["holiday"], remove: [] },
      { op: "field", ref: "R1", field: "status", value: "in progress" },
      { op: "field", ref: "R1", field: "Date", value: "2026-12-24" },
      { op: "field", ref: "R1", field: "Status", value: "Nonexistent" }, // invalid option
      { op: "task", ref: "T9", status: "done" }, // unknown reference
      { op: "task", ref: "T1", status: "sideways" }, // invalid status, nothing else to change
      { op: "delete", ref: "T1" }, // unsupported operation
    ], refs);
    expect(skipped).toBe(4);
    expect(changes.map((c) => c.after)).toEqual([
      "status done, tags #done-soon",
      "due 2026-12-05, priority high",
      "tags #travel #holiday",
      "Status: In progress",
      "Date: 2026-12-24",
    ]);
    expect(changes[0]!.before).toBe("status todo, tags #admin");

    const undo = await applyChanges(changes);
    expect((await db().tasks.get(a.id))).toMatchObject({ status: "done", tags: ["done-soon"] });
    expect((await db().tasks.get(a.id))!.completedAt).toBeGreaterThan(0);
    expect((await db().tasks.get(b.id))).toMatchObject({ dueDate: "2026-12-05", priority: "high" });
    expect((await db().pages.get(page.id))!.tags).toEqual(["travel", "holiday"]);
    const r1 = (await db().records.get(rec.id))!;
    expect(r1.values[status!.id]).toBe(status!.options!.find((o) => o.name === "In progress")!.id);
    expect(r1.values[date!.id]).toBe("2026-12-24");

    await undoChanges(undo);
    expect((await db().tasks.get(a.id))).toMatchObject({ status: "todo", tags: ["admin"], completedAt: 0, dueDate: "2026-11-20" });
    expect((await db().tasks.get(b.id))).toMatchObject({ dueDate: "2026-12-01", priority: "none" });
    expect((await db().pages.get(page.id))!.tags).toEqual(["travel"]);
    const r2 = (await db().records.get(rec.id))!;
    expect(status!.id in r2.values).toBe(false);
    expect(date!.id in r2.values).toBe(false);
  });
});
