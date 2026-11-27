import { beforeEach, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { pageList, peekPageList } from "@/data/pageDirectory";

let n = 0;
beforeEach(() => { useDatabase(`pd-${Date.now()}-${n++}`); });

describe("in-memory page list", () => {
  it("loads once, then follows creates, edits, trash and deletes without content", async () => {
    const ws = await repo.createWorkspace("W");
    const a = await repo.createPage(ws.id, null, { title: "Alpha" });
    expect(peekPageList(ws.id)).toBeUndefined();
    const first = await pageList(ws.id);
    expect(first.map((p) => p.title)).toContain("Alpha");
    expect(first.every((p) => p.content === null && p.text === "")).toBe(true);
    expect(peekPageList(ws.id)?.map((p) => p.title)).toContain("Alpha");

    const b = await repo.createPage(ws.id, null, { title: "Beta" });
    await repo.updatePageMeta(a.id, { title: "Alpha 2" });
    expect((await pageList(ws.id)).map((p) => p.title).sort()).toEqual(expect.arrayContaining(["Alpha 2", "Beta"]));
    await repo.trashPage(b.id);
    expect((await pageList(ws.id)).map((p) => p.title)).not.toContain("Beta");
    await db().pages.delete(a.id);
    expect((await pageList(ws.id)).map((p) => p.title)).not.toContain("Alpha 2");
  });
});
