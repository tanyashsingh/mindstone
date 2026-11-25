import { describe, expect, it } from "vitest";
import { docToMarkdown, docToText, extractLinks, extractTags, reassignIds } from "@/lib/doc";
import { parseCSV, toCSV } from "@/lib/csv";
import { parseICS, toICS } from "@/lib/ics";
import { expandEvent, nextDate } from "@/lib/recurrence";
import { safeFileName, uid } from "@/lib/util";
import type { CalendarEvent, JSONContent } from "@/data/types";

const doc: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, id: "h1" }, content: [{ type: "text", text: "Plan" }] },
    {
      type: "paragraph",
      attrs: { id: "p1" },
      content: [
        { type: "text", text: "See " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " and [[Roadmap]] #ideas " },
        { type: "pageMention", attrs: { pageId: "P2", label: "Specs" } },
      ],
    },
    { type: "taskList", attrs: { id: "t" }, content: [{ type: "taskItem", attrs: { checked: true, id: "ti" }, content: [{ type: "paragraph", content: [{ type: "text", text: "ship" }] }] }] },
    { type: "codeBlock", attrs: { language: "ts", id: "c" }, content: [{ type: "text", text: "let x = 1" }] },
  ],
};

describe("document helpers", () => {
  it("extracts text, links and tags", () => {
    const text = docToText(doc);
    expect(text).toContain("Plan");
    expect(text).toContain("Specs");
    expect(extractLinks(doc)).toEqual([{ title: "Roadmap", kind: "wiki" }, { toPageId: "P2", kind: "mention" }]);
    expect(extractTags(text)).toEqual(["ideas"]);
  });
  it("serialises markdown", () => {
    const md = docToMarkdown(doc);
    expect(md).toContain("## Plan");
    expect(md).toContain("**bold**");
    expect(md).toContain("[[Specs]]");
    expect(md).toContain("- [x] ship");
    expect(md).toContain("```ts\nlet x = 1\n```");
  });
  it("reassigns block ids without mutating the source", () => {
    let n = 0;
    const copy = reassignIds(doc, () => `n${n++}`);
    expect(copy.content![0]!.attrs!.id).toBe("n0");
    expect(doc.content![0]!.attrs!.id).toBe("h1");
  });
});

describe("csv", () => {
  it("round-trips quotes, commas and newlines", () => {
    const rows = [["a", "b,c"], ['say "hi"', "line1\nline2"]];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });
  it("neutralises spreadsheet formula injection", () => {
    expect(toCSV([["=HYPERLINK(1)"]])).toBe("'=HYPERLINK(1)\r\n");
  });
});

describe("recurrence and ics", () => {
  it("clamps monthly recurrence to month end", () => {
    expect(nextDate("2026-01-31", { freq: "monthly", interval: 1 })).toBe("2026-02-28");
    expect(nextDate("2026-01-01", { freq: "weekly", interval: 2, until: "2026-01-10" })).toBe(null);
  });
  it("expands recurring events in a window", () => {
    const start = new Date(2026, 0, 5, 9).getTime();
    const ev = { id: "e", start, end: start + 3600e3, recurrence: { freq: "daily", interval: 1 } } as CalendarEvent;
    const occ = expandEvent(ev, new Date(2026, 0, 6).getTime(), new Date(2026, 0, 9).getTime());
    expect(occ.map((o) => new Date(o.start).getDate())).toEqual([6, 7, 8]);
  });
  it("round-trips ICS", () => {
    const start = Date.UTC(2026, 2, 1, 15, 30);
    const ev = { id: "x", title: "Sync, weekly; notes", notes: "line1\nline2", start, end: start + 1800e3, allDay: 0, calendar: "Work", recurrence: { freq: "weekly", interval: 1 }, updatedAt: start } as CalendarEvent;
    const [back] = parseICS(toICS([ev]));
    expect(back).toMatchObject({ title: ev.title, notes: ev.notes, start, end: ev.end, calendar: "Work", recurrence: { freq: "weekly", interval: 1 } });
  });
});

describe("util", () => {
  it("makes sortable unique ids", () => {
    const a = uid();
    const b = uid();
    expect(a).toHaveLength(26);
    expect(a).not.toBe(b);
  });
  it("sanitises file names", () => {
    expect(safeFileName("../..\\evil:name?.md")).toBe("_.._evil_name_.md");
    expect(safeFileName("CON")).toBe("_CON");
  });
});
