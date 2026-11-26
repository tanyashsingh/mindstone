/**
 * Calendar subscriptions: read-only calendars added by their private iCalendar (ICS) address. Google Calendar
 * ("Secret address in iCal format") and Outlook ("Publish a calendar" → ICS link) both provide one, so no account
 * sign-in is needed. Feeds refresh every 30 minutes. Event ids are derived from the feed and the event's UID, so
 * every device that refreshes a feed produces the same events (no duplicates after sync).
 */
import { db, patch } from "@/data/db";
import type { CalendarEvent, CalendarFeed, ID } from "@/data/types";
import { eventFields, parseICS } from "./ics";
import { uid } from "./util";

export function normalizeFeedUrl(u: string): string {
  const s = u.trim().replace(/^webcal:\/\//i, "https://");
  let url: URL;
  try { url = new URL(s); } catch { throw new Error("That doesn't look like a web address."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Use the calendar's https:// (or webcal://) address.");
  return url.href;
}

/** True where Mindstone can download calendars itself: the desktop app, or a browser for addresses on this computer. */
export const canFetchFeeds = () => true; // the browser build can read servers that allow it; errors are shown per feed

async function fetchText(url: string): Promise<string> {
  if (window.rea) return window.rea.fetchCalendar(url);
  const res = await fetch(url, { cache: "no-store" }); // browser build: works for servers that allow it (CORS)
  if (!res.ok) throw new Error(`The calendar server answered ${res.status}`);
  return res.text();
}

function h(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619); b = Math.imul(b ^ s.charCodeAt(i), 2246822519); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

export async function addFeed(workspaceId: ID, name: string, url: string, color: string): Promise<CalendarFeed> {
  const feed: CalendarFeed = { id: uid(), workspaceId, name: name.trim().slice(0, 80) || "Subscribed calendar", url: normalizeFeedUrl(url), color, lastFetched: 0, lastError: "", eventCount: 0, createdAt: Date.now(), updatedAt: Date.now() };
  await db().calendarFeeds.add(feed);
  return feed;
}

/** Downloads a feed and brings its events up to date. Unchanged events are left untouched (no needless sync). */
export async function refreshFeed(id: ID): Promise<number> {
  const feed = await db().calendarFeeds.get(id);
  if (!feed) return 0;
  try {
    const text = await fetchText(feed.url);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("The address didn't return a calendar (iCalendar) file.");
    const parsed = parseICS(text);
    const existing = new Map((await db().events.where("workspaceId").equals(feed.workspaceId).filter((e) => e.feedId === id).toArray()).map((e) => [e.id, e]));
    const now = Date.now();
    const next: CalendarEvent[] = [];
    const seen = new Set<string>();
    for (const p of parsed) {
      const eid = `feed-${id}-${h(`${p.uid || p.title}|${p.recurrenceId ?? ""}|${p.uid ? "" : p.start}`)}`;
      if (seen.has(eid)) continue;
      seen.add(eid);
      const fields = { ...eventFields(p), calendar: feed.name, color: feed.color };
      const old = existing.get(eid);
      const same = old && JSON.stringify({ ...eventFields({ ...old, uid: "" }), calendar: old.calendar, color: old.color }) === JSON.stringify(fields) && !old.deletedAt;
      if (same) continue;
      next.push({ id: eid, workspaceId: feed.workspaceId, timezone: "", reminderMin: null, createdAt: old?.createdAt ?? now, updatedAt: now, deletedAt: 0, feedId: id, ...fields });
    }
    const gone = [...existing.keys()].filter((k) => !seen.has(k));
    await db().transaction("rw", db().events, db().calendarFeeds, async () => {
      if (next.length) await db().events.bulkPut(next);
      if (gone.length) await db().events.bulkDelete(gone);
      await patch(db().calendarFeeds, id, { lastFetched: now, lastError: "", eventCount: seen.size, updatedAt: now });
    });
    return seen.size;
  } catch (e) {
    await patch(db().calendarFeeds, id, { lastError: e instanceof Error ? e.message : String(e), lastFetched: Date.now() });
    throw e;
  }
}

export async function removeFeed(id: ID) {
  const feed = await db().calendarFeeds.get(id);
  if (!feed) return;
  await db().transaction("rw", db().events, db().calendarFeeds, async () => {
    const ids = (await db().events.where("workspaceId").equals(feed.workspaceId).filter((e) => e.feedId === id).primaryKeys()) as ID[];
    await db().events.bulkDelete(ids);
    await db().calendarFeeds.delete(id);
  });
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Refreshes every feed soon after start and every 30 minutes (where this device can download them). */
export function startFeedRefresh() {
  if (timer || !canFetchFeeds()) return;
  const all = async () => { for (const f of await db().calendarFeeds.toArray()) await refreshFeed(f.id).catch(() => {}); };
  setTimeout(() => void all(), 5_000);
  timer = setInterval(() => void all(), 30 * 60_000);
}
