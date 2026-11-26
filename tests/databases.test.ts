import { beforeEach, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { cellValue, chartData, type QueryContext } from "@/lib/dbquery";
import type { Database } from "@/data/types";

let n = 0;
beforeEach(() => { useDatabase(`dbs-${Date.now()}-${n++}`); });

async function ctxFor(...ids: string[]): Promise<QueryContext> {
  const databases = new Map<string, Database>();
  const records = new Map();
  for (const id of ids) { databases.set(id, (await db().databases.get(id))!); records.set(id, await db().records.where("databaseId").equals(id).toArray()); }
  return { databases, records };
}

describe("relations, rollups and charts", () => {
  it("keeps two-way relations in step and fills the mirror from existing links", async () => {
    const ws = await repo.createWorkspace("W");
    const { database: projects } = await repo.createDatabase(ws.id, null, "Projects", [repo.newProperty("Name", "title")]);
    const { database: tasks } = await repo.createDatabase(ws.id, null, "Tasks", [repo.newProperty("Name", "title"), repo.newProperty("Done", "checkbox"), repo.newProperty("Hours", "number"), repo.newProperty("Due", "date")]);
    const rel = repo.newProperty("Project", "relation", { relationDatabaseId: projects.id });
    await repo.updateDatabase(tasks.id, { properties: [...tasks.properties, rel] });
    const p1 = await repo.addRecord(projects.id, { [projects.properties[0]!.id]: "Launch" });
    const p2 = await repo.addRecord(projects.id, { [projects.properties[0]!.id]: "Hiring" });
    const [tName, tDone, tHours, tDue] = tasks.properties;
    const t1 = await repo.addRecord(tasks.id, { [tName!.id]: "Write copy", [tDone!.id]: true, [tHours!.id]: 3, [tDue!.id]: "2026-12-05", [rel.id]: [p1.id] });
    const t2 = await repo.addRecord(tasks.id, { [tName!.id]: "Design", [tDone!.id]: false, [tHours!.id]: 5, [tDue!.id]: "2026-12-01" });

    await repo.setRelationTwoWay(tasks.id, rel.id, true);
    const proj = (await db().databases.get(projects.id))!;
    const mirror = proj.properties.find((p) => p.type === "relation")!;
    expect(mirror.name).toBe("Tasks");
    expect(mirror.relationMirrorId).toBe(rel.id);
    expect((await db().records.get(p1.id))!.values[mirror.id]).toEqual([t1.id]); // filled from the existing link

    // Linking from the task side updates the project, and unlinking removes it
    await repo.updateRecord(t2.id, rel.id, [p1.id, p2.id]);
    expect((await db().records.get(p1.id))!.values[mirror.id]).toEqual([t1.id, t2.id]);
    expect((await db().records.get(p2.id))!.values[mirror.id]).toEqual([t2.id]);
    await repo.updateRecord(t2.id, rel.id, [p1.id]);
    expect((await db().records.get(p2.id))!.values[mirror.id]).toEqual([]);
    // ...and from the project side back to tasks
    await repo.updateRecord(p2.id, mirror.id, [t1.id]);
    expect((await db().records.get(t1.id))!.values[rel.id]).toEqual([p1.id, p2.id]);

    // Rollups across the relation (from the project side)
    const mk = (fn: "count" | "sum" | "avg" | "percentChecked" | "earliest" | "latest", target: string) => repo.newProperty(fn, "rollup", { rollup: { relationPropertyId: mirror.id, targetPropertyId: target, fn } });
    const freshProj = (await db().databases.get(projects.id))!;
    const ctx = await ctxFor(projects.id, tasks.id);
    const launch = (await db().records.get(p1.id))!;
    const v = (fn: Parameters<typeof mk>[0], t: string) => cellValue(freshProj, launch, mk(fn, t), ctx);
    expect(v("count", tName!.id)).toBe(2);
    expect(v("sum", tHours!.id)).toBe(8);
    expect(v("avg", tHours!.id)).toBe(4);
    expect(v("percentChecked", tDone!.id)).toBe(50);
    expect(v("earliest", tDue!.id)).toBe("2026-12-01");
    expect(v("latest", tDue!.id)).toBe("2026-12-05");

    // Turning two-way off removes the mirror property
    await repo.setRelationTwoWay(tasks.id, rel.id, false);
    expect((await db().databases.get(projects.id))!.properties.some((p) => p.type === "relation")).toBe(false);
    expect((await db().databases.get(tasks.id))!.properties.find((p) => p.id === rel.id)?.relationMirrorId).toBeUndefined();
  });

  it("aggregates chart values by group: count, sum and average", async () => {
    const ws = await repo.createWorkspace("W");
    const { database } = await repo.createDatabase(ws.id, null, "Deals", [repo.newProperty("Name", "title"), repo.newProperty("Stage", "status"), repo.newProperty("Value", "number")]);
    const [name, stage, value] = database.properties;
    const [a, b] = stage!.options!;
    await repo.addRecord(database.id, { [name!.id]: "x", [stage!.id]: a!.id, [value!.id]: 10 });
    await repo.addRecord(database.id, { [name!.id]: "y", [stage!.id]: a!.id, [value!.id]: 30 });
    await repo.addRecord(database.id, { [name!.id]: "z", [stage!.id]: b!.id, [value!.id]: 5 });
    const recs = await db().records.where("databaseId").equals(database.id).toArray();
    const byLabel = (metric: "count" | "sum" | "avg") => Object.fromEntries(chartData(database, recs, { groupBy: stage!.id, chart: { metric, valueProperty: value!.id } }).map((p) => [p.label, p.value]));
    expect(byLabel("count")).toMatchObject({ [a!.name]: 2, [b!.name]: 1 });
    expect(byLabel("sum")).toMatchObject({ [a!.name]: 40, [b!.name]: 5 });
    expect(byLabel("avg")).toMatchObject({ [a!.name]: 20, [b!.name]: 5 });
  });
});
