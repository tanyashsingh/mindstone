/**
 * Passphrase protection. A random 256-bit data key encrypts the database (crypto.ts). The data key is stored only
 * wrapped (AES-GCM) by a key derived from the passphrase with PBKDF2-SHA-256 (600,000 iterations), and separately
 * by a key derived from a one-time recovery key. Changing the passphrase re-wraps the data key; nothing is
 * re-encrypted. Without the passphrase or the recovery key the data can't be read, by design.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { db } from "./db";
import { encryptionMode, isEncryptedRow, setEncryption, setLocked, UNENCRYPTED_TABLES } from "./crypto";

export const PBKDF2_ITERATIONS = 600_000;
const RECOVERY_ITERATIONS = 100_000; // the recovery key is high-entropy
const META_KEY = "vault";

interface Wrapped { salt: string; iterations: number; nonce: string; ct: string }
export interface VaultMeta { v: 1; status: "on" | "encrypting" | "decrypting"; pass: Wrapped; recovery: Wrapped; createdAt: number }

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function kek(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, 256));
}

async function wrap(dataKey: Uint8Array, secret: string, iterations: number): Promise<Wrapped> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(await kek(secret, salt, iterations), nonce, new TextEncoder().encode("mindstone-vault-v1")).encrypt(dataKey);
  return { salt: b64(salt), iterations, nonce: b64(nonce), ct: b64(ct) };
}

/** Throws if the secret is wrong (GCM authentication fails). */
export async function unwrap(w: Wrapped, secret: string): Promise<Uint8Array> {
  try {
    return gcm(await kek(secret, unb64(w.salt), w.iterations), unb64(w.nonce), new TextEncoder().encode("mindstone-vault-v1")).decrypt(unb64(w.ct));
  } catch { throw new Error("That passphrase is not correct."); }
}

/** A recovery key people can write down: 24 characters from an unambiguous alphabet, in groups of 4 (~120 bits). */
export function newRecoveryKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => alphabet[b % 32]).join("").match(/.{4}/g)!.join("-");
}
const normRecovery = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function vaultMeta(): Promise<VaultMeta | null> {
  return ((await db().meta.get(META_KEY))?.value as VaultMeta | undefined) ?? null;
}

const contentTables = () => db().tables.filter((t) => !UNENCRYPTED_TABLES.has(t.name));

/** Rewrites every row through the middleware (encrypting or decrypting, depending on the current mode). */
async function rewriteAll(onProgress?: (p: number) => void) {
  const tables = contentTables();
  const total = (await Promise.all(tables.map((t) => t.count()))).reduce((a, b) => a + b, 0) || 1;
  let done = 0;
  for (const t of tables) {
    const keys = await t.toCollection().primaryKeys();
    for (let i = 0; i < keys.length; i += 200) {
      const rows = await t.bulkGet(keys.slice(i, i + 200));
      await t.bulkPut(rows.filter(Boolean));
      done += rows.length;
      onProgress?.(done / total);
    }
  }
  onProgress?.(1);
}

export const passphraseProblem = (p: string): string | null =>
  p.length < 10 ? "Use at least 10 characters." : /^(.)\1+$/.test(p) ? "Use more than one repeated character." : null;

/** Turns encryption on. Returns the recovery key, which is shown once. */
export async function enableEncryption(passphrase: string, onProgress?: (p: number) => void): Promise<string> {
  if (await vaultMeta()) throw new Error("Encryption is already on.");
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const recovery = newRecoveryKey();
  const meta: VaultMeta = { v: 1, status: "encrypting", pass: await wrap(dataKey, passphrase, PBKDF2_ITERATIONS), recovery: await wrap(dataKey, normRecovery(recovery), RECOVERY_ITERATIONS), createdAt: Date.now() };
  await db().meta.put({ key: META_KEY, value: meta });
  currentKey = dataKey;
  setEncryption("on", dataKey);
  await rewriteAll(onProgress);
  await db().meta.put({ key: META_KEY, value: { ...meta, status: "on" } });
  return recovery;
}

/** Finishes an interrupted switch (app closed while encrypting or decrypting). Call after unlocking. */
export async function resumeIfInterrupted(onProgress?: (p: number) => void) {
  const meta = await vaultMeta();
  if (!meta || meta.status === "on") return;
  if (meta.status === "encrypting") { await rewriteAll(onProgress); await db().meta.put({ key: META_KEY, value: { ...meta, status: "on" } }); }
  else await finishDecrypt(onProgress);
}

async function finishDecrypt(onProgress?: (p: number) => void) {
  await rewriteAll(onProgress); // reads decrypt, writes stay plain
  await db().meta.delete(META_KEY);
  setEncryption("plain", null);
}

/** Turns encryption off (decrypts everything). Must be unlocked. */
export async function disableEncryption(onProgress?: (p: number) => void) {
  const meta = await vaultMeta();
  if (!meta) return;
  const key = currentKey;
  if (!key) throw new Error("Unlock first.");
  await db().meta.put({ key: META_KEY, value: { ...meta, status: "decrypting" } });
  setEncryption("decrypting", key);
  await finishDecrypt(onProgress);
  currentKey = null;
}

let currentKey: Uint8Array | null = null;

/** Opens the vault with the passphrase. Throws on a wrong passphrase. */
export async function unlock(passphrase: string): Promise<void> {
  const meta = await vaultMeta();
  if (!meta) return;
  const key = await unwrap(meta.pass, passphrase);
  currentKey = key;
  setEncryption(meta.status === "decrypting" ? "decrypting" : "on", key);
}

/** Uses the recovery key to set a new passphrase. */
export async function recover(recoveryKey: string, newPassphrase: string): Promise<void> {
  const meta = await vaultMeta();
  if (!meta) return;
  const problem = passphraseProblem(newPassphrase);
  if (problem) throw new Error(problem);
  let key: Uint8Array;
  try { key = await unwrap(meta.recovery, normRecovery(recoveryKey)); } catch { throw new Error("That recovery key is not correct."); }
  await db().meta.put({ key: META_KEY, value: { ...meta, pass: await wrap(key, newPassphrase, PBKDF2_ITERATIONS) } });
  currentKey = key;
  setEncryption(meta.status === "decrypting" ? "decrypting" : "on", key);
}

export async function changePassphrase(current: string, next: string): Promise<void> {
  const meta = await vaultMeta();
  if (!meta) throw new Error("Encryption is off.");
  const problem = passphraseProblem(next);
  if (problem) throw new Error(problem);
  const key = await unwrap(meta.pass, current);
  await db().meta.put({ key: META_KEY, value: { ...meta, pass: await wrap(key, next, PBKDF2_ITERATIONS) } });
}

/** Makes a new recovery key (the old one stops working). Needs the passphrase. */
export async function newRecovery(passphrase: string): Promise<string> {
  const meta = await vaultMeta();
  if (!meta) throw new Error("Encryption is off.");
  const key = await unwrap(meta.pass, passphrase);
  const code = newRecoveryKey();
  await db().meta.put({ key: META_KEY, value: { ...meta, recovery: await wrap(key, normRecovery(code), RECOVERY_ITERATIONS) } });
  return code;
}

/** Forgets the key in memory. The caller reloads the app so no decrypted data stays in memory. */
export function lockNow() {
  currentKey = null;
  setLocked();
}

/** Called once at start: puts the middleware in the right state. Returns whether a passphrase is needed. */
export async function prepareVault(): Promise<"open" | "locked"> {
  const meta = await vaultMeta();
  if (!meta) { setEncryption("plain", null); return "open"; }
  if (currentKey) return "open";
  setLocked();
  return "locked";
}

export const vaultActive = () => encryptionMode() !== "plain";
export { isEncryptedRow };

// ---- Encrypted backups ----------------------------------------------------------------------
export interface EncryptedBackup { format: "rea-backup-encrypted"; version: 1; vault: Pick<VaultMeta, "pass" | "recovery">; nonce: string; data: string; workspaceName: string; exportedAt: string }

/** When encryption is on, backups are encrypted with the data key, and carry the wrapped key so the passphrase (or recovery key) opens them anywhere. */
export async function sealBackup(json: string, workspaceName: string): Promise<string> {
  const meta = await vaultMeta();
  if (!meta || !currentKey) return json;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(json);
  const ct = gcm(currentKey, nonce, new TextEncoder().encode("mindstone-backup-v1")).encrypt(bytes);
  let bin = "";
  for (let i = 0; i < ct.length; i += 0x8000) bin += String.fromCharCode(...ct.subarray(i, i + 0x8000));
  const out: EncryptedBackup = { format: "rea-backup-encrypted", version: 1, vault: { pass: meta.pass, recovery: meta.recovery }, nonce: b64(nonce), data: btoa(bin), workspaceName, exportedAt: new Date().toISOString() };
  return JSON.stringify(out);
}

export const isEncryptedBackup = (raw: unknown): raw is EncryptedBackup => !!raw && typeof raw === "object" && (raw as { format?: string }).format === "rea-backup-encrypted";

/** Opens an encrypted backup with a passphrase or recovery key (either may be the one from another device). */
export async function openBackup(b: EncryptedBackup, secret: string): Promise<unknown> {
  let key: Uint8Array;
  try { key = await unwrap(b.vault.pass, secret); }
  catch { try { key = await unwrap(b.vault.recovery, normRecovery(secret)); } catch { throw new Error("That passphrase or recovery key doesn't open this backup."); } }
  const ct = unb64(b.data);
  const plain = gcm(key, unb64(b.nonce), new TextEncoder().encode("mindstone-backup-v1")).decrypt(ct);
  return JSON.parse(new TextDecoder().decode(plain));
}
