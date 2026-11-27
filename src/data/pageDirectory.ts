/**
 * A lightweight, always-current list of a workspace's pages (everything except their content and text), kept in
 * memory. Read once per workspace, then updated from database hooks as pages change, so the sidebar, page-link
 * suggestions and title lookups don't re-read every page (and its content) on each save.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { db, type ReaDB } from "./db";
import type { ID, Page } from "./types";

/** A page without its content (content is null and text is ""). */
export type PageMeta = Page;

const byWorkspace = new Map<ID, Map<ID, PageMeta>>();
const loading = new Map<ID, Promise<void>>();
const hooked = new WeakSet<ReaDB>();
const useVersion = create<{ v: number }>(() => ({ v: 0 }));
let bumpQueued = false;
const bump = () => {
  if (bumpQueued) return;
  bumpQueued = true;
  setTimeout(() => { bumpQueued = false; useVersion.setState((s) => ({ v: s.v + 1 })); }, 30);
};

const slim = (p: Page): PageMeta => ({ ...p, content: null, text: "" });

// Hooks see rows as stored (encrypted when passphrase protection is on), so they only note which pages changed;
// the changed pages are then re-read through the normal (decrypting) path just after the write.
const changed = new Set<ID>();
let flushQueued = false;
function noteChange(id: ID) {
  changed.add(id);
  if (flushQueued) return;
  flushQueued = true;
  setTimeout(() => void flush(), 0);
}
let chain: Promise<void> = Promise.resolve();
/** Applies noted changes. Runs one at a time, so an older read can never overwrite a newer one. */
function flush(): Promise<void> {
  chain = chain.then(async () => {
    flushQueued = false;
    const ids = [...changed];
    changed.clear();
    if (!ids.length || !byWorkspace.size) return;
    const rows = await db().pages.bulkGet(ids);
    ids.forEach((id, i) => {
      const p = rows[i];
      for (const m of byWorkspace.values()) m.delete(id);
      if (p) byWorkspace.get(p.workspaceId)?.set(p.id, slim(p));
    });
    bump();
  });
  return chain;
}

function hook() {
  const d = db();
  if (hooked.has(d)) return;
  hooked.add(d);
  byWorkspace.clear();
  loading.clear();
  d.pages.hook("creating", (key, obj) => { noteChange(String(key ?? (obj as { id?: string }).id)); });
  d.pages.hook("updating", (_mods, key) => { noteChange(String(key)); });
  d.pages.hook("deleting", (key) => { noteChange(String(key)); });
}

/** Resolves once changes noted so far are applied. */
async function settled() { await chain; while (flushQueued || changed.size) await flush(); }

async function load(ws: ID) {
  hook();
  let p = loading.get(ws);
  if (!p && byWorkspace.has(ws)) return;
  if (!p) {
    p = (async () => {
      const m = new Map<ID, PageMeta>();
      byWorkspace.set(ws, m); // hooks fill it while it loads
      for (const pg of await db().pages.where("workspaceId").equals(ws).toArray()) if (!m.has(pg.id)) m.set(pg.id, slim(pg));
      bump();
    })().finally(() => loading.delete(ws));
    loading.set(ws, p);
  }
  await p;
}

/** Live (not trashed) pages of a workspace, without content. */
export async function pageList(ws: ID): Promise<PageMeta[]> {
  await load(ws);
  await settled();
  return [...(byWorkspace.get(ws)?.values() ?? [])].filter((p) => !p.deletedAt);
}

/** React hook: the workspace's live pages (without content); undefined until first loaded. */
export function usePageList(ws: ID | null | undefined): PageMeta[] | undefined {
  const v = useVersion((s) => s.v);
  const [list, setList] = useState<PageMeta[] | undefined>(undefined);
  useEffect(() => {
    if (!ws) { setList([]); return; }
    let alive = true;
    void pageList(ws).then((l) => { if (alive) setList(l); });
    return () => { alive = false; };
  }, [ws, v]);
  return list;
}

/** The page list if it is already in memory (safe inside a database transaction), otherwise undefined. */
export function peekPageList(ws: ID): PageMeta[] | undefined {
  const m = byWorkspace.get(ws);
  return m && !loading.has(ws) ? [...m.values()].filter((p) => !p.deletedAt) : undefined;
}
