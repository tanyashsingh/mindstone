/**
 * Encryption at rest for the local database. A Dexie DBCore middleware encrypts every row's content with
 * AES-256-GCM before it reaches IndexedDB and decrypts it on the way out, so the rest of the app works with
 * plain objects. Only the primary key and indexed fields (ids, workspace and parent links, deletion time,
 * event start times) stay readable, because the database needs them to look rows up.
 *
 * Each row's ciphertext is bound to its table and primary key (associated data), so rows can't be swapped.
 * The data key lives only in memory while Mindstone is unlocked (see vault.ts).
 */
import type { DBCore, DBCoreCursor, DBCoreTable, Middleware } from "dexie";
import { gcm } from "@noble/ciphers/aes.js";

const ENC = "__enc";
const NONCE = 12;
export const UNENCRYPTED_TABLES = new Set(["meta"]); // key-wrapping metadata, needed before unlock

export class LockedError extends Error {
  constructor() { super("Mindstone is locked. Unlock it with your passphrase to read your data."); }
}

/** "plain": no encryption. "on": encrypt writes, decrypt reads. "decrypting": decrypt reads, write plain (turning encryption off). */
let mode: "plain" | "on" | "decrypting" = "plain";
let dataKey: Uint8Array | null = null;
let locked = false;

export function setEncryption(m: typeof mode, key: Uint8Array | null) { mode = m; dataKey = key; locked = false; }
export function setLocked() { mode = "plain"; dataKey = null; locked = true; }
export const encryptionMode = () => mode;
export const isUnlocked = () => !!dataKey;

// ---- Binary codec: JSON plus raw binary chunks (Blob, Uint8Array, Float32Array) -------------------
type Bin = { b: number; t: "u8" | "f32" | "blob"; m?: string };
const isBin = (v: unknown): v is Bin => !!v && typeof v === "object" && "\u0000" in (v as object) && typeof (v as Bin).b === "number" && typeof (v as Bin).t === "string";

function encodeFields(fields: Record<string, unknown>): Uint8Array {
  const bins: Uint8Array[] = [];
  const json = JSON.stringify(fields, function (_k, v: unknown) {
    if (v instanceof Uint8Array) { bins.push(v); return { "\u0000": 1, b: bins.length - 1, t: "u8" }; }
    if (v instanceof Float32Array) { bins.push(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))); return { "\u0000": 1, b: bins.length - 1, t: "f32" }; }
    if (v && typeof v === "object" && (v as { __blobBytes?: Uint8Array }).__blobBytes) { const o = v as { __blobBytes: Uint8Array; type: string }; bins.push(o.__blobBytes); return { "\u0000": 1, b: bins.length - 1, t: "blob", m: o.type }; }
    return v;
  });
  const j = new TextEncoder().encode(json);
  const size = 8 + j.length + bins.reduce((a, b) => a + 4 + b.length, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, j.length, true);
  out.set(j, 4);
  let p = 4 + j.length;
  dv.setUint32(p, bins.length, true); p += 4;
  for (const b of bins) { dv.setUint32(p, b.length, true); out.set(b, p + 4); p += 4 + b.length; }
  return out;
}

function decodeFields(buf: Uint8Array): Record<string, unknown> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jl = dv.getUint32(0, true);
  const json = new TextDecoder().decode(buf.subarray(4, 4 + jl));
  let p = 4 + jl;
  const n = dv.getUint32(p, true); p += 4;
  const bins: Uint8Array[] = [];
  for (let i = 0; i < n; i++) { const l = dv.getUint32(p, true); bins.push(buf.slice(p + 4, p + 4 + l)); p += 4 + l; }
  return JSON.parse(json, (_k, v: unknown) => {
    if (!isBin(v)) return v;
    const b = bins[v.b]!;
    if (v.t === "u8") return b;
    if (v.t === "f32") return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    return new Blob([b as BlobPart], { type: v.m ?? "" });
  }) as Record<string, unknown>;
}

// ---- Row encryption ------------------------------------------------------------------------
const aad = (table: string, pk: unknown) => new TextEncoder().encode(`${table}\u0000${JSON.stringify(pk)}`);

/** Blobs can't be read synchronously, so they are turned into bytes before encrypting. */
async function blobsToBytes(v: unknown): Promise<unknown> {
  if (v instanceof Blob) return { __blobBytes: new Uint8Array(await v.arrayBuffer()), type: v.type };
  if (Array.isArray(v)) return Promise.all(v.map(blobsToBytes));
  if (v && typeof v === "object" && !(v instanceof Uint8Array) && !(v instanceof Float32Array) && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = await blobsToBytes(x);
    return out;
  }
  return v;
}

export async function encryptRow(table: string, row: Record<string, unknown>, plainKeys: Set<string>, pkPath: string, key: Uint8Array): Promise<Record<string, unknown>> {
  const keep: Record<string, unknown> = {}, secret: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) (plainKeys.has(k) || k === pkPath ? keep : secret)[k] = v;
  const bytes = encodeFields((await blobsToBytes(secret)) as Record<string, unknown>);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE));
  const ct = gcm(key, nonce, aad(table, row[pkPath])).encrypt(bytes);
  const enc = new Uint8Array(NONCE + ct.length);
  enc.set(nonce); enc.set(ct, NONCE);
  return { ...keep, [ENC]: enc };
}

export function decryptRow(table: string, row: unknown, pkPath: string): unknown {
  if (!row || typeof row !== "object" || !(ENC in row)) return row; // plain row (not encrypted, or written before encryption)
  if (!dataKey) throw new LockedError();
  const r = row as Record<string, unknown>;
  const enc = r[ENC] as Uint8Array;
  const plain = gcm(dataKey, enc.subarray(0, NONCE), aad(table, r[pkPath])).decrypt(enc.subarray(NONCE));
  const { [ENC]: _drop, ...keep } = r;
  return { ...keep, ...decodeFields(plain) };
}

export const isEncryptedRow = (row: unknown) => !!row && typeof row === "object" && ENC in row;

// ---- Middleware ----------------------------------------------------------------------------
function plainKeysOf(t: DBCoreTable): { plain: Set<string>; pk: string } {
  const plain = new Set<string>();
  const add = (kp: string | string[] | null | undefined) => { for (const k of [kp ?? []].flat()) if (k) plain.add(String(k).split(".")[0]!); };
  add(t.schema.primaryKey.keyPath as string | string[] | null);
  for (const ix of t.schema.indexes) add(ix.keyPath as string | string[] | null);
  return { plain, pk: String(t.schema.primaryKey.keyPath) };
}

export const encryptionMiddleware: Middleware<DBCore> = {
  stack: "dbcore",
  name: "mindstone-encryption",
  create(down) {
    return {
      ...down,
      table(name) {
        const t = down.table(name);
        if (UNENCRYPTED_TABLES.has(name)) return t;
        const { plain, pk } = plainKeysOf(t);
        const dec = (v: unknown) => decryptRow(name, v, pk);
        const wrapCursor = (c: DBCoreCursor | null): DBCoreCursor | null => {
          if (!c) return c;
          const p: DBCoreCursor = new Proxy(c, {
            get(target, prop) {
              if (prop === "value") return dec(target.value);
              if (prop === "next") return () => target.next().then(() => p);
              const v = Reflect.get(target, prop, target) as unknown;
              return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
            },
          });
          return p;
        };
        return {
          ...t,
          async mutate(req) {
            if (mode === "on" && (req.type === "add" || req.type === "put")) {
              if (!dataKey) throw new LockedError();
              const key = dataKey;
              const values = await Promise.all(req.values.map((v) => encryptRow(name, v as Record<string, unknown>, plain, pk, key)));
              return t.mutate({ ...req, values } as typeof req);
            }
            return t.mutate(req);
          },
          async get(req) { return dec(await t.get(req)); },
          async getMany(req) { return (await t.getMany(req)).map(dec); },
          async query(req) {
            const res = await t.query(req);
            return req.values ? { ...res, result: res.result.map(dec) } : res;
          },
          async openCursor(req) {
            const c = await t.openCursor(req);
            return req.values === false ? c : wrapCursor(c);
          },
        };
      },
    };
  },
};

export const isLocked = () => locked;
