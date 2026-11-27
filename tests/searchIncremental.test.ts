import { beforeEach, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { SearchIndex } from "@/data/search";

let n = 0;
beforeEach(() => { useDatabase(`si-${Date.now()}-${n++}`); });

describe("search index updates", () => {
  it("adds, updates and removes single rows without a rebuild", async () => {
    const ws = await repo.createWorkspace("W");
    const idx = new SearchIndex();
    await idx.build(ws.id);
    const p = await repo.createPage(ws.id, null, { title: "Quince jam" });
    const t = await repo.createTask(ws.id, { title: "Buy jars", tags: ["pantry"] });
    await idx.applyChanges(ws.id, new Map([["pages", new Set([p.id])], ["tasks", new Set([t.id])]]));
    expect(idx.search("quince").map((h) => h.refId)).toContain(p.id);
    expect(idx.search("pantry").some((h) => h.kind === "tag")).toBe(true);

    await repo.updatePageMeta(p.id, { title: "Plum jam" });
    await idx.applyChanges(ws.id, new Map([["pages", new Set([p.id])]]));
    expect(idx.search("quince").map((h) => h.refId)).not.toContain(p.id);
    expect(idx.search("plum").map((h) => h.refId)).toContain(p.id);

    await repo.trashPage(p.id);
    await db().tasks.delete(t.id);
    await idx.applyChanges(ws.id, new Map([["pages", new Set([p.id])], ["tasks", new Set([t.id])]]));
    expect(idx.search("plum")).toHaveLength(0);
    expect(idx.search("jars")).toHaveLength(0);
  });
});
