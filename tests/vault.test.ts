import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { SearchIndex } from "@/data/search";
import { LockedError } from "@/data/crypto";
import {
  changePassphrase, disableEncryption, enableEncryption, lockNow, newRecovery, openBackup, prepareVault, recover, sealBackup, unlock, vaultMeta, isEncryptedBackup,
} from "@/data/vault";
import { createBackup } from "@/data/backup";

let name = "";
let n = 0;
beforeEach(() => { name = `vault-${Date.now()}-${n++}`; useDatabase(name); });
afterEach(async () => { lockNow(); await prepareVault().catch(() => {}); });

/** Every row of every store, read straight from IndexedDB (bypassing Dexie and the encryption layer). */
async function rawDump(): Promise<string> {
  const req = indexedDB.open(name);
  const idb: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
  const out: unknown[] = [];
  for (const s of [...idb.objectStoreNames]) {
    out.push(await new Promise((r) => { const q = idb.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); }));
  }
  idb.close();
  return JSON.stringify(out, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v));
}

const PASS = "correct horse battery";

async function seed() {
  const ws = await repo.createWorkspace("Secret Workspace");
  const page = await repo.createPage(ws.id, null, { title: "Diagnosis notes", tags: ["health"] });
  await repo.savePageContent(page.id, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The blood test result is SAPPHIRE-42" }] }] });
  await repo.createTask(ws.id, { title: "Call Dr. Okafor", dueDate: "2026-12-02", tags: ["medical"] });
  const file = new File([new Uint8Array([1, 2, 3, 250, 251])], "scan.bin", { type: "application/x-test" });
  const att = await repo.addAttachment(ws.id, page.id, file);
  return { ws, page, att };
}

describe("encryption at rest", () => {
  it("encrypts every row, keeps the app working, and leaves no readable content", async () => {
    const { ws, page, att } = await seed();
    expect(await rawDump()).toContain("SAPPHIRE-42"); // plain before

    const progress: number[] = [];
    const recovery = await enableEncryption(PASS, (p) => progress.push(p));
    expect(recovery).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
    expect(progress.at(-1)).toBe(1);
    expect((await vaultMeta())?.status).toBe("on");

    const raw = await rawDump();
    for (const secret of ["SAPPHIRE-42", "Diagnosis notes", "Secret Workspace", "Okafor", "health", "medical", "2026-12-02", "scan.bin"]) expect(raw).not.toContain(secret);
    expect(raw).toContain(ws.id); // ids stay plain so lookups work

    // Reads, index queries, cursors and search all see plain data
    expect((await db().pages.get(page.id))!.text).toContain("SAPPHIRE-42");
    expect((await db().pages.where("[workspaceId+deletedAt]").equals([ws.id, 0]).toArray()).map((p) => p.title)).toContain("Diagnosis notes");
    expect(await db().tasks.filter((t) => t.title.includes("Okafor")).count()).toBe(1);
    const seen: string[] = [];
    await db().tasks.each((t) => { seen.push(t.title); });
    expect(seen).toEqual(["Call Dr. Okafor"]);
    await db().tasks.toCollection().modify({ priority: "high" });
    expect((await db().tasks.toArray())[0]!.priority).toBe("high");
    const a = (await db().attachments.get(att.id))!;
    expect([...new Uint8Array(await a.blob.arrayBuffer())]).toEqual([1, 2, 3, 250, 251]);
    expect(a.blob.type).toBe("application/x-test");
    const idx = new SearchIndex();
    await idx.build(ws.id);
    expect(idx.search("sapphire").map((h) => h.refId)).toContain(page.id);

    // New writes are encrypted too
    await repo.createTask(ws.id, { title: "Pick up prescription TOPAZ" });
    expect(await rawDump()).not.toContain("TOPAZ");
  });

  it("locks, refuses a wrong passphrase, unlocks, and recovers with the recovery key", async () => {
    const { page } = await seed();
    const recovery = await enableEncryption(PASS);
    lockNow();
    expect(await prepareVault()).toBe("locked");
    await expect(db().pages.get(page.id)).rejects.toThrow(LockedError);
    await expect(unlock("wrong passphrase!")).rejects.toThrow(/not correct/);
    await unlock(PASS);
    expect((await db().pages.get(page.id))!.title).toBe("Diagnosis notes");

    await changePassphrase(PASS, "a brand new passphrase");
    lockNow();
    await expect(unlock(PASS)).rejects.toThrow();
    await unlock("a brand new passphrase");

    lockNow();
    await expect(recover("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF", "forgot it again pass")).rejects.toThrow(/recovery key/);
    await recover(recovery.toLowerCase().replace(/-/g, " "), "my reset passphrase");
    expect((await db().pages.get(page.id))!.title).toBe("Diagnosis notes");
    lockNow();
    await unlock("my reset passphrase");

    const fresh = await newRecovery("my reset passphrase");
    lockNow();
    await expect(recover(recovery, "another passphrase x")).rejects.toThrow(); // the old recovery key stopped working
    await recover(fresh, "another passphrase x");
  });

  it("turns off cleanly: data decrypted, metadata removed", async () => {
    await seed();
    await enableEncryption(PASS);
    await disableEncryption();
    expect(await vaultMeta()).toBeNull();
    expect(await rawDump()).toContain("SAPPHIRE-42");
    expect(await prepareVault()).toBe("open");
  });

  it("rejects short passphrases", async () => {
    await expect(enableEncryption("short")).rejects.toThrow(/10 characters/);
  });

  it("encrypts backups, which open with the passphrase or the recovery key", async () => {
    const { ws } = await seed();
    const recovery = await enableEncryption(PASS);
    const sealed = await sealBackup(JSON.stringify(await createBackup(ws.id)), ws.name);
    expect(sealed).not.toContain("SAPPHIRE");
    const parsed = JSON.parse(sealed);
    expect(isEncryptedBackup(parsed)).toBe(true);
    const viaPass = await openBackup(parsed, PASS) as { workspace: { name: string } };
    expect(viaPass.workspace.name).toBe("Secret Workspace");
    const viaRecovery = await openBackup(parsed, recovery) as { workspace: { name: string } };
    expect(viaRecovery.workspace.name).toBe("Secret Workspace");
    await expect(openBackup(parsed, "nope nope nope")).rejects.toThrow(/doesn't open/);
  });
});
