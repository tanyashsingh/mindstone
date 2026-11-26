import { describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { joinSpace, newSpace, syncOnce, type SpaceInfo, type SyncState, type Transport } from "@/sync/engine";

/** A shared "folder" in memory, recording every byte written. */
function memoryTransport() {
  let space: SpaceInfo | null = null;
  const files = new Map<string, Uint8Array>();
  const t: Transport = {
    readSpace: async () => space,
    createSpace: async (s) => { space = s; },
    list: async () => [...files.keys()].map((k) => { const [device, seq] = k.split("/"); return { device: device!, seq: Number(seq) }; }),
    read: async (d, s) => files.get(`${d}/${s}`)!,
    write: async (d, s, b) => { files.set(`${d}/${s}`, b); },
  };
  return { t, files };
}

let n = 0;
const device = (name: string) => { const dbName = `sync-${name}-${Date.now()}-${n++}`; return { use: () => useDatabase(dbName), state: { device: name, seq: 0, cursors: {} } as SyncState }; };

describe("sync engine", () => {
  it("syncs pages, tasks, files and deletions both ways, end-to-end encrypted", async () => {
    const { t, files } = memoryTransport();
    const { info, key } = await newSpace("shared sync phrase");
    await t.createSpace(info);
    const A = device("A"), B = device("B");

    A.use();
    const ws = await repo.createWorkspace("Shared");
    const page = await repo.createPage(ws.id, null, { title: "Packing list" });
    await repo.savePageContent(page.id, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Passport and charger LAPIS" }] }] });
    const task = await repo.createTask(ws.id, { title: "Buy sunscreen" });
    await repo.addAttachment(ws.id, page.id, new File([new Uint8Array([9, 8, 7])], "map.bin", { type: "application/x-map" }));
    let r = await syncOnce(t, key, A.state); A.state = r.state;
    expect(r.pushed).toBeGreaterThan(5);
    for (const bytes of files.values()) expect(new TextDecoder().decode(bytes)).not.toContain("LAPIS");

    B.use();
    const keyB = await joinSpace((await t.readSpace())!, "shared sync phrase");
    await expect(joinSpace((await t.readSpace())!, "wrong phrase here")).rejects.toThrow(/doesn't match/);
    r = await syncOnce(t, keyB, B.state); B.state = r.state;
    expect(r.pulled).toBeGreaterThan(5);
    expect((await db().pages.get(page.id))!.text).toContain("LAPIS");
    const att = (await db().attachments.where("pageId").equals(page.id).toArray())[0]!;
    expect([...new Uint8Array(await att.blob.arrayBuffer())]).toEqual([9, 8, 7]);
    expect(r.pushed).toBe(0); // nothing new on B: applied rows are not echoed back

    // B edits and deletes; A receives both
    await repo.updateTask(task.id, { status: "done" });
    await db().attachments.delete(att.id);
    r = await syncOnce(t, keyB, B.state); B.state = r.state;
    expect(r.pushed).toBe(3); // the task, the deleted file, and the activity entry for completing the task
    A.use();
    r = await syncOnce(t, key, A.state); A.state = r.state;
    expect((await db().tasks.get(task.id))!.status).toBe("done");
    expect(await db().attachments.get(att.id)).toBeUndefined();
    expect(r.pushed).toBe(0);
  });

  it("resolves conflicts by the later edit and keeps the losing page version in history", async () => {
    const { t } = memoryTransport();
    const { info, key } = await newSpace("conflict phrase!");
    await t.createSpace(info);
    const A = device("A"), B = device("B");
    A.use();
    const ws = await repo.createWorkspace("W");
    const page = await repo.createPage(ws.id, null, { title: "Plan" });
    A.state = (await syncOnce(t, key, A.state)).state;
    B.use();
    B.state = (await syncOnce(t, key, B.state)).state;

    // Both edit the same page; B's edit is later.
    A.use();
    await repo.savePageContent(page.id, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A version" }] }] });
    await new Promise((r) => setTimeout(r, 15));
    B.use();
    await repo.savePageContent(page.id, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "B version" }] }] });

    A.use();
    A.state = (await syncOnce(t, key, A.state)).state; // pushes A's edit
    B.use();
    B.state = (await syncOnce(t, key, B.state)).state; // A's older edit loses; B pushes its own
    expect((await db().pages.get(page.id))!.text).toBe("B version");
    A.use();
    A.state = (await syncOnce(t, key, A.state)).state;
    expect((await db().pages.get(page.id))!.text).toBe("B version");
    const kept = await db().revisions.where("pageId").equals(page.id).toArray();
    expect(kept.some((rv) => /\((before sync|from another device)\)/.test(rv.title) && JSON.stringify(rv.content).includes("A version"))).toBe(true);
  });

  it("waits for missing earlier files instead of skipping them", async () => {
    const { t, files } = memoryTransport();
    const { info, key } = await newSpace("ordering phrase");
    await t.createSpace(info);
    const A = device("A"), B = device("B");
    A.use();
    const ws = await repo.createWorkspace("W");
    A.state = (await syncOnce(t, key, A.state)).state;
    await repo.createTask(ws.id, { title: "second" });
    A.state = (await syncOnce(t, key, A.state)).state;
    const first = files.get("A/1")!;
    files.delete("A/1"); // file 1 hasn't arrived yet (still copying)
    B.use();
    B.state = (await syncOnce(t, key, B.state)).state;
    expect(B.state.cursors.A ?? 0).toBe(0);
    files.set("A/1", first);
    B.state = (await syncOnce(t, key, B.state)).state;
    expect(B.state.cursors.A).toBe(2);
    expect((await db().tasks.toArray()).map((x) => x.title)).toContain("second");
  });
});
