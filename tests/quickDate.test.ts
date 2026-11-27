import { describe, expect, it } from "vitest";
import { parseQuickDate } from "@/lib/quickDate";
import { parseQuickTask } from "@/views/Tasks";

// Friday 27 November 2026, midday
const now = new Date(2026, 10, 27, 12);
const p = (s: string) => parseQuickDate(s, now);

describe("due dates in plain words", () => {
  it("understands relative words", () => {
    expect(p("Call Sam today")).toEqual({ date: "2026-11-27", rest: "Call Sam" });
    expect(p("Call Sam tomorrow")?.date).toBe("2026-11-28");
    expect(p("Ship in 3 days")).toEqual({ date: "2026-11-30", rest: "Ship" });
    expect(p("Ship in 2 weeks")?.date).toBe("2026-12-11");
    expect(p("Review next week")?.date).toBe("2026-12-04");
    expect(p("Renew next month")?.date).toBe("2026-12-27");
  });
  it("understands days of the week, always the coming one", () => {
    expect(p("Book venue next friday")).toEqual({ date: "2026-12-04", rest: "Book venue" });
    expect(p("Book venue friday")?.date).toBe("2026-12-04"); // today is Friday
    expect(p("Standup on monday")).toEqual({ date: "2026-11-30", rest: "Standup" });
    expect(p("Gym next sat")?.date).toBe("2026-11-28");
    expect(p("Lunch Wednesday")?.date).toBe("2026-12-02");
  });
  it("understands calendar dates, rolling past ones into next year", () => {
    expect(p("Taxes dec 5")).toEqual({ date: "2026-12-05", rest: "Taxes" });
    expect(p("Party 3rd January")?.date).toBe("2027-01-03");
    expect(p("Report 2026-12-31")?.date).toBe("2026-12-31");
    expect(p("Nonsense feb 31")).toBeNull();
  });
  it("leaves ordinary words alone", () => {
    expect(p("Fix the sat nav")).toBeNull();
    expect(p("Wed photos")).toBeNull();
    expect(p("Monday.com migration notes")?.date).toBe("2026-11-30"); // a full day name counts
    expect(p("Read chapter 5")).toBeNull();
  });
  it("feeds quick add", () => {
    const t = parseQuickTask("Book venue next friday !high #events");
    expect(t.title).toBe("Book venue");
    expect(t.priority).toBe("high");
    expect(t.tags).toEqual(["events"]);
    expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
