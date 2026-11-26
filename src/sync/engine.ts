/**
 * Sync between devices. Each device writes numbered change files (its own folder in the sync space) and reads the
 * other devices' files. Changes are found by comparing every row with the version last exchanged (syncState), so
 * every kind of edit is picked up. Files are encrypted end to end with a key derived from the sync passphrase:
 * a shared folder or the sync server only ever holds ciphertext.
 *
 * Conflicts: the later edit wins, per row. When a page loses, its version is kept in page history.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { db } from "@/data/db";
import { blobsToBytes, decodeFields, encodeFields } from "@/data/crypto";
import { uid } from "@/lib/util";

export const NOT_SYNCED = new Set(["meta", "settings", "embeddings", "syncState"]); // device-local or derived
const PBKDF2_ITERATIONS = 600_000;

export interface SpaceInfo { v: 1; salt: string; check: string; createdAt: number }
export interface Transport {
  readSpace(): Promise<SpaceInfo | null>;
  createSpace(info: SpaceInfo): Promise<void>;
  list(): Promise<{ device: string; seq: number }[]>;
  read(device: string, seq: number): Promise<Uint8Array>;
  write(device: string, seq: number, bytes: Uint8Array): Promise<void>;
}
export interface Entry { t: string; k: string; r: string; ts: number; d?: 1; v?: Record<string, unknown> }

const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const enc = (s: string) => new TextEncoder().encode(s);

export async function deriveSyncKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", enc(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS }, base, 256));
}

/** Server credential derived from the key; the server never learns the key itself. */
export async function authToken(key: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...enc("mindstone-sync-auth:"), ...key])));
  return [...h].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function seal(key: Uint8Array, bytes: Uint8Array, aad: string): Uint8Array {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(key, nonce, enc(aad)).encrypt(bytes);
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce); out.set(ct, 12);
  return out;
}
function open(key: Uint8Array, data: Uint8Array, aad: string): Uint8Array {
  return gcm(key, data.subarray(0, 12), enc(aad)).decrypt(data.subarray(12));
}

export async function newSpace(passphrase: string): Promise<{ info: SpaceInfo; key: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveSyncKey(passphrase, salt);
  return { info: { v: 1, salt: b64(salt), check: b64(seal(key, enc("mindstone-sync"), "check")), createdAt: Date.now() }, key };
}

/** Derives the key for an existing space; throws if the passphrase is wrong. */
export async function joinSpace(info: SpaceInfo, passphrase: string): Promise<Uint8Array> {
  const key = await deriveSyncKey(passphrase, unb64(info.salt));
  try { open(key, unb64(info.check), "check"); } catch { throw new Error("That sync passphrase doesn't match this sync space."); }
  return key;
}

// ---- Change detection -------------------------------------------------------------------
/** 53-bit string hash (cyrb53). */
function hash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const rowHash = (row: unknown) => hash(JSON.stringify(row, (_k, v: unknown) => (v instanceof Blob ? `blob:${v.size}:${v.type}` : v instanceof Uint8Array ? `u8:${v.length}:${hash(String.fromCharCode(...v.subarray(0, 4096)))}` : v)));
const rowTime = (row: Record<string, unknown> | undefined) => Number(row?.updatedAt ?? row?.createdAt ?? row?.at ?? 0) || 0;
const rev = (ts: number, device: string) => `${ts.toString(36).padStart(10, "0")}.${device}`;
const stateKey = (t: string, k: string) => `${t}\u0000${k}`;

const syncedTables = () => db().tables.filter((t) => !NOT_SYNCED.has(t.name));

type StateRow = { key: string; t: string; k: string; r: string; ts: number; h: string; d: 0 | 1 };

/** Rows changed (or deleted) since they were last exchanged, with new versions. Call commit() once they are safely written. */
export async function collectChanges(device: string): Promise<{ entries: Entry[]; commit: () => Promise<void> }> {
  const out: Entry[] = [];
  const pending: StateRow[] = [];
  const now = Date.now();
  for (const table of syncedTables()) {
    const pk = String(table.schema.primKey.keyPath);
    const states = new Map((await db().syncState.where("t").equals(table.name).toArray()).map((s) => [s.k, s]));
    const rows = await table.toArray();
    const updates = pending;
    for (const row of rows as Record<string, unknown>[]) {
      const k = String(row[pk]);
      const h = rowHash(row);
      const st = states.get(k);
      states.delete(k);
      if (st && st.h === h && !st.d) continue;
      const ts = Math.max(rowTime(row) || now, (st?.ts ?? 0) + 1);
      out.push({ t: table.name, k, r: rev(ts, device), ts, v: row });
      updates.push({ key: stateKey(table.name, k), t: table.name, k, r: rev(ts, device), ts, h, d: 0 });
    }
    for (const st of states.values()) { // rows that were synced before and are gone now
      if (st.d) continue;
      const ts = Math.max(now, st.ts + 1);
      out.push({ t: table.name, k: st.k, r: rev(ts, device), ts, d: 1 });
      updates.push({ ...st, r: rev(ts, device), ts, h: "", d: 1 });
    }
  }
  return { entries: out, commit: async () => { if (pending.length) await db().syncState.bulkPut(pending); } };
}

/** Applies another device's changes. Returns how many rows changed here. */
export async function applyChanges(entries: Entry[]): Promise<number> {
  let applied = 0;
  for (const e of entries) {
    if (NOT_SYNCED.has(e.t)) continue;
    const table = db().tables.find((t) => t.name === e.t);
    if (!table) continue; // a table from a newer version: ignored until this device updates
    const key = stateKey(e.t, e.k);
    const st = await db().syncState.get(key);
    if (st && st.r >= e.r) continue; // already have this version or a newer one
    const cur = (await table.get(e.k)) as Record<string, unknown> | undefined;
    const localChanged = cur ? !st || st.h !== rowHash(cur) || !!st.d : !!st && !st.d;
    if (localChanged) {
      const localTs = cur ? rowTime(cur) || Date.now() : Date.now();
      if (localTs > e.ts) { // the local edit is newer: it wins and goes out with the next push
        if (e.t === "pages" && e.v && e.v.content !== undefined) await db().revisions.add({ id: uid(), pageId: e.k, title: `${String(e.v.title ?? "")} (from another device)`, content: e.v.content as never, createdAt: Date.now() });
        continue;
      }
      if (e.t === "pages" && cur && cur.content !== undefined) { // keep the losing version in page history
        await db().revisions.add({ id: uid(), pageId: e.k, title: `${String(cur.title ?? "")} (before sync)`, content: cur.content as never, createdAt: Date.now() });
      }
    }
    if (e.d) await table.delete(e.k);
    else await table.put(e.v);
    await db().syncState.put({ key, t: e.t, k: e.k, r: e.r, ts: e.ts, h: e.d ? "" : rowHash(e.v), d: e.d ? 1 : 0 });
    applied++;
  }
  return applied;
}

// ---- Change files ---------------------------------------------------------------------------
export async function packFile(key: Uint8Array, device: string, seq: number, entries: Entry[]): Promise<Uint8Array> {
  const bytes = encodeFields((await blobsToBytes({ v: 1, device, seq, entries })) as Record<string, unknown>);
  return seal(key, bytes, `file:${device}:${seq}`);
}
export function unpackFile(key: Uint8Array, device: string, seq: number, data: Uint8Array): Entry[] {
  const obj = decodeFields(open(key, data, `file:${device}:${seq}`)) as { device: string; seq: number; entries: Entry[] };
  if (obj.device !== device || obj.seq !== seq) throw new Error("Change file does not match its name");
  return obj.entries;
}

export interface SyncState { device: string; seq: number; cursors: Record<string, number> }

/** One round: read others' new files, then write this device's changes. */
export async function syncOnce(t: Transport, key: Uint8Array, state: SyncState): Promise<{ state: SyncState; pulled: number; pushed: number }> {
  const files = (await t.list()).filter((f) => f.device !== state.device && f.seq > (state.cursors[f.device] ?? 0)).sort((a, b) => a.device.localeCompare(b.device) || a.seq - b.seq);
  let pulled = 0;
  const cursors = { ...state.cursors };
  for (const f of files) {
    if (f.seq !== (cursors[f.device] ?? 0) + 1) continue; // wait for missing earlier files (still uploading)
    pulled += await applyChanges(unpackFile(key, f.device, f.seq, await t.read(f.device, f.seq)));
    cursors[f.device] = f.seq;
  }
  const { entries, commit } = await collectChanges(state.device);
  let seq = state.seq;
  if (entries.length) {
    seq += 1;
    await t.write(state.device, seq, await packFile(key, state.device, seq, entries));
    await commit();
  }
  return { state: { ...state, seq, cursors }, pulled, pushed: entries.length };
}
