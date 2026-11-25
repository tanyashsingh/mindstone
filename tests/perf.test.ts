import { beforeAll, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { SearchIndex } from "@/data/search";
import { queryView } from "@/lib/dbquery";
import { uid } from "@/lib/util";

/**
 * Generated-workspace performance checks. Runs against fake-indexeddb in Node, which is slower than
 * Chromium's IndexedDB, so the budgets are generous upper bounds, not targets. Timings are printed.
 */
let ws = "";
let dbId = "";
beforeAll(async () => {
  useDatabase(`perf-${Date.now()}`);
  ws = (await repo.createWorkspace("Perf")).id;
  const t = Date.now();
  const pages = Array.from({ length: 3000 }, (_, i) => ({
    ...repo.newPage(ws, null, { title: `Note ${i} ${i % 7 === 0 ? "roadmap" : "meeting"}` }),
    text: `Body of note ${i}. ${"lorem ipsum dolor sit amet ".repeat(20)} keyword${i % 50}`,
  }));
  await db().pages.bulkAdd(pages);
  const { database } = await repo.createDatabase(ws, null, "Big table", [repo.newProperty("Name", "title"), repo.newProperty("Points", "number"), repo.newProperty("Status", "status")]);
  dbId = database.id;
  const status = database.properties[2]!;
  await db().records.bulkAdd(Array.from({ length: 10000 }, (_, i) => ({
    id: uid(), databaseId: database.id, seq: i + 1, sortKey: i, createdAt: t, updatedAt: t, deletedAt: 0,
    values: { [database.properties[0]!.id]: `Row ${i}`, [database.properties[1]!.id]: i % 100, [status.id]: status.options![i % 3]!.id },
  })));
}, 120_000);

describe("performance on a generated workspace", () => {
  it("indexes 3,000 pages + 10,000 records and searches quickly", async () => {
    const idx = new SearchIndex();
    const t0 = performance.now();
    const n = await idx.build(ws);
    const tBuild = performance.now() - t0;
    const t1 = performance.now();
    const hits = idx.search("roadmap keyword7");
    const tSearch = performance.now() - t1;
    console.log(`search index: ${n} docs built in ${tBuild.toFixed(0)} ms; query in ${tSearch.toFixed(1)} ms`);
    expect(n).toBeGreaterThan(13000);
    expect(hits.length).toBeGreaterThan(0);
    expect(tSearch).toBeLessThan(150);
  }, 120_000);

  it("filters and sorts 10,000 records", async () => {
    const database = (await db().databases.get(dbId))!;
    const recs = await db().records.where("databaseId").equals(dbId).toArray();
    database.views[0]!.sorts = [{ propertyId: database.properties[1]!.id, dir: "desc" }];
    database.views[0]!.filter = { kind: "group", mode: "and", children: [{ kind: "rule", propertyId: database.properties[1]!.id, op: "gte", value: 50 }] };
    const t0 = performance.now();
    const rows = queryView(database, recs, database.views[0]!.id);
    const ms = performance.now() - t0;
    console.log(`query view: ${recs.length} records → ${rows.length} rows in ${ms.toFixed(0)} ms`);
    expect(rows.length).toBe(5000);
    expect(rows[0]!.values[database.properties[1]!.id]).toBe(99);
    expect(ms).toBeLessThan(1500);
  }, 60_000);
});
