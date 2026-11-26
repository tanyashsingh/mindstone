import { describe, expect, it } from "vitest";
import { parseICS, toICS, zonedTime, eventFields } from "@/lib/ics";
import { expandEvent, occurrenceDates } from "@/lib/recurrence";
import type { CalendarEvent } from "@/data/types";

const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e.trim().split("\n").map((l) => l.trim()), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
const asEvent = (p: ReturnType<typeof parseICS>[number], id = "e"): CalendarEvent => ({ id, workspaceId: "w", timezone: "", color: "", reminderMin: null, createdAt: 0, updatedAt: 0, deletedAt: 0, ...eventFields(p) });
const days = (occ: { start: number }[]) => occ.map((o) => { const d = new Date(o.start); return `${d.getMonth() + 1}/${d.getDate()}`; });

describe("calendar feeds (iCalendar)", () => {
  it("converts named time zones, including Windows names, to the right instant", () => {
    // 09:00 in New York on 2026-12-01 is 14:00 UTC; in July (daylight time) it is 13:00 UTC.
    expect(new Date(zonedTime(2026, 11, 1, 9, 0, 0, "America/New_York")!).toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(new Date(zonedTime(2026, 6, 1, 9, 0, 0, "Eastern Standard Time")!).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(new Date(zonedTime(2026, 11, 1, 9, 30, 0, "\"India Standard Time\"")!).toISOString()).toBe("2026-12-01T04:00:00.000Z");
    expect(zonedTime(2026, 0, 1, 0, 0, 0, "Not/AZone")).toBeNull();
    const [e] = parseICS(cal("UID:a\nSUMMARY:Standup\nDTSTART;TZID=Europe/London:20260615T093000\nDTEND;TZID=Europe/London:20260615T094500"));
    expect(new Date(e!.start).toISOString()).toBe("2026-06-15T08:30:00.000Z");
    expect(e!.end - e!.start).toBe(15 * 60e3);
  });

  it("expands weekday rules, monthly 'second Tuesday', counts and skipped dates", () => {
    const [weekly] = parseICS(cal("UID:w\nSUMMARY:Gym\nDTSTART:20261130T070000\nDURATION:PT1H\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5\nEXDATE:20261204T070000"));
    expect(weekly!.recurrence).toEqual({ freq: "weekly", interval: 1, count: 5, byDay: ["MO", "WE", "FR"] });
    const ev = asEvent(weekly!);
    expect(ev.end - ev.start).toBe(3600e3);
    expect(days(expandEvent(ev, new Date(2026, 10, 1).getTime(), new Date(2027, 0, 1).getTime()))).toEqual(["11/30", "12/2", "12/7", "12/9"]); // 5 by count, Dec 4 skipped
    expect([...occurrenceDates("2026-12-08", { freq: "monthly", interval: 1, byDay: ["2TU"], count: 3 })]).toEqual(["2026-12-08", "2027-01-12", "2027-02-09"]);
    expect([...occurrenceDates("2026-12-25", { freq: "monthly", interval: 1, byDay: ["-1FR"], count: 2 })]).toEqual(["2026-12-25", "2027-01-29"]);
    expect([...occurrenceDates("2026-01-31", { freq: "monthly", interval: 1, count: 3 })]).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("keeps a moved occurrence as its own event, drops cancelled ones, ignores alarms", () => {
    const events = parseICS(cal(
      "UID:s1\nSUMMARY:Weekly sync\nDTSTART:20261201T100000\nDTEND:20261201T103000\nRRULE:FREQ=WEEKLY;UNTIL=20261231\nLOCATION:Room 4\nBEGIN:VALARM\nTRIGGER:-PT15M\nSUMMARY:Alarm text\nEND:VALARM",
      "UID:s1\nRECURRENCE-ID:20261208T100000\nSUMMARY:Weekly sync (moved)\nDTSTART:20261209T150000\nDTEND:20261209T153000",
      "UID:s1\nRECURRENCE-ID:20261215T100000\nSTATUS:CANCELLED\nSUMMARY:Weekly sync\nDTSTART:20261215T100000",
      "UID:gone\nSTATUS:CANCELLED\nSUMMARY:Called off\nDTSTART:20261203T100000",
    ));
    expect(events.map((e) => e.title)).toEqual(["Weekly sync", "Weekly sync (moved)"]);
    const master = events[0]!;
    expect(master.notes).toBe("Location: Room 4");
    expect(master.exdates).toEqual(["2026-12-08", "2026-12-15"]);
    expect(days(expandEvent(asEvent(master), new Date(2026, 11, 1).getTime(), new Date(2027, 0, 1).getTime()))).toEqual(["12/1", "12/22", "12/29"]);
  });

  it("round-trips weekday rules, counts and skipped dates through export", () => {
    const ev: CalendarEvent = { id: "x", workspaceId: "w", title: "Class", notes: "", start: new Date(2026, 11, 1, 18).getTime(), end: new Date(2026, 11, 1, 19).getTime(), allDay: 0, timezone: "", calendar: "School", color: "", recurrence: { freq: "weekly", interval: 1, byDay: ["TU", "TH"], count: 6 }, reminderMin: null, createdAt: 0, updatedAt: 0, deletedAt: 0, exdates: ["2026-12-03"] };
    const [back] = parseICS(toICS([ev]));
    expect(back!.recurrence).toEqual(ev.recurrence);
    expect(back!.exdates).toEqual(["2026-12-03"]);
  });
});
