import { beforeEach, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { addFeed, normalizeFeedUrl, refreshFeed, removeFeed } from "@/lib/feeds";

let served = "";
(globalThis as { window?: unknown }).window = { rea: { fetchCalendar: async () => served } };
let n = 0;
beforeEach(() => { useDatabase(`feeds-${Date.now()}-${n++}`); });

const ics = (...ev: string[]) => ["BEGIN:VCALENDAR", ...ev.flatMap((e) => ["BEGIN:VEVENT", ...e.split("\n"), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

describe("calendar subscriptions", () => {
  it("normalises addresses", () => {
    expect(normalizeFeedUrl(" webcal://example.com/cal.ics ")).toBe("https://example.com/cal.ics");
    expect(() => normalizeFeedUrl("ftp://x/y.ics")).toThrow();
    expect(() => normalizeFeedUrl("not a url")).toThrow();
  });

  it("adds, refreshes without needless changes, updates, removes stale events, and unsubscribes", async () => {
    const ws = await repo.createWorkspace("W");
    const feed = await addFeed(ws.id, "Work", "https://example.com/work.ics", "blue");
    served = ics("UID:1\nSUMMARY:Planning\nDTSTART:20261201T090000Z\nDTEND:20261201T100000Z", "UID:2\nSUMMARY:Review\nDTSTART:20261202T090000Z\nDTEND:20261202T100000Z");
    expect(await refreshFeed(feed.id)).toBe(2);
    let evs = await db().events.toArray();
    expect(evs.map((e) => [e.title, e.calendar, e.color, !!e.feedId])).toEqual(expect.arrayContaining([["Planning", "Work", "blue", true], ["Review", "Work", "blue", true]]));
    const before = Object.fromEntries(evs.map((e) => [e.id, e.updatedAt]));

    await new Promise((r) => setTimeout(r, 5));
    await refreshFeed(feed.id); // same content: nothing rewritten
    evs = await db().events.toArray();
    expect(Object.fromEntries(evs.map((e) => [e.id, e.updatedAt]))).toEqual(before);

    served = ics("UID:1\nSUMMARY:Planning (moved)\nDTSTART:20261201T110000Z\nDTEND:20261201T120000Z");
    expect(await refreshFeed(feed.id)).toBe(1);
    evs = await db().events.toArray();
    expect(evs.map((e) => e.title)).toEqual(["Planning (moved)"]);
    expect(evs[0]!.id).toBe(Object.keys(before).find((k) => before[k] && evs[0]!.id === k)); // same id for the same UID

    served = "<html>not a calendar</html>";
    await expect(refreshFeed(feed.id)).rejects.toThrow(/didn't return a calendar/);
    expect((await db().calendarFeeds.get(feed.id))!.lastError).toMatch(/didn't return a calendar/);
    expect(await db().events.count()).toBe(1); // a failed refresh keeps the last good events

    await removeFeed(feed.id);
    expect(await db().events.count()).toBe(0);
    expect(await db().calendarFeeds.count()).toBe(0);
  });
});
