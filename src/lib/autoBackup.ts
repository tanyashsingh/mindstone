/**
 * Automatic local backups (desktop app): once a day per workspace, a full backup is written to the data
 * folder's backups/ directory, keeping the newest 14 per workspace. Runs at startup and every 6 hours.
 */
import { db } from "@/data/db";
import { createBackup } from "@/data/backup";
import { getSetting, setSetting } from "@/data/repo";
import { useSettings } from "@/store/settings";
import { toISODate } from "./util";

const DAY = 24 * 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | undefined;

/** "My Workspace" + id → "My Workspace (01J…) 2026-11-26.rea.json"; only characters the main process accepts. */
export function backupFileName(name: string, id: string, date = new Date()): string {
  const safe = name.replace(/[^A-Za-z0-9 ._()-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "Workspace";
  return `${safe} (${id.slice(-8)}) ${toISODate(date)}.rea.json`;
}

export async function runAutoBackups(force = false): Promise<number> {
  if (!window.rea?.backup || !useSettings.getState().s.backup.auto) return 0;
  let written = 0;
  for (const ws of await db().workspaces.toArray()) {
    const key = `autoBackup:${ws.id}`;
    const last = await getSetting<number>(key, 0);
    if (!force && Date.now() - last < DAY) continue;
    try {
      const json = JSON.stringify(await createBackup(ws.id));
      await window.rea.backup.save(backupFileName(ws.name, ws.id), json);
      await setSetting(key, Date.now());
      written++;
    } catch (e) {
      void window.rea.log("error", `Automatic backup failed for workspace ${ws.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return written;
}

export function startAutoBackups() {
  if (timer || !window.rea?.backup) return;
  setTimeout(() => void runAutoBackups(), 20_000); // after startup settles
  timer = setInterval(() => void runAutoBackups(), 6 * 60 * 60 * 1000);
}
