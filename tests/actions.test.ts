import { describe, expect, it } from "vitest";
import { citedIndices, groundedSources, parseTaskProposal, reminderAt, systemPrompt } from "@/ai/actions";

const NOW = new Date(2026, 10, 25, 17, 40); // Wed 25 Nov 2026, 17:40 local

describe("assistant task proposals", () => {
  it("parses a proposal, strips the raw block, and normalises times", () => {
    const reply = 'Here are your travel tasks.\n\n```cairn-tasks\n[{"title":"Flight","due":"2026-11-26","time":"12:00 am","priority":"high","notes":"Terminal 3"},{"title":"Train","due":"tomorrow","time":"2:00 pm","priority":"none","notes":""}]\n```\n';
    const { display, tasks } = parseTaskProposal(reply, NOW);
    expect(display).toBe("Here are your travel tasks.");
    expect(tasks).toEqual([
      { title: "Flight", due: "2026-11-26", time: "00:00", priority: "high", notes: "Terminal 3" },
      { title: "Train", due: "2026-11-26", time: "14:00", priority: "none", notes: "" },
    ]);
    expect(new Date(reminderAt(tasks[1]!)!).getHours()).toBe(14);
  });

  it("rejects malformed input safely", () => {
    expect(parseTaskProposal("no block here").tasks).toEqual([]);
    expect(parseTaskProposal("```cairn-tasks\nnot json\n```").tasks).toEqual([]);
    const { tasks } = parseTaskProposal('```cairn-tasks\n[{"title":""},{"title":"X","due":"2026-02-31","time":"25:00","priority":"extreme"},42]\n```', NOW);
    expect(tasks).toEqual([{ title: "X", due: null, time: null, priority: "none", notes: "" }]);
    expect(reminderAt(tasks[0]!)).toBe(null);
  });

  it("accepts a single object instead of an array, and caps the list", () => {
    expect(parseTaskProposal('```cairn-tasks\n{"title":"Solo"}\n```', NOW).tasks).toHaveLength(1);
    const many = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ title: `T${i}` })));
    expect(parseTaskProposal("```cairn-tasks\n" + many + "\n```", NOW).tasks).toHaveLength(20);
  });

  it("gives the model today's date and the proposal format", () => {
    const p = systemPrompt(NOW);
    expect(p).toContain("2026-11-25");
    expect(p).toContain("Tomorrow is 2026-11-26");
    expect(p).toContain("cairn-tasks");
    expect(p).not.toContain("[n]");
  });

  it("finds which sources a reply cites", () => {
    expect([...citedIndices("Per [1] and [3], yes. Not [n].")]).toEqual([0, 2]);
    expect(citedIndices("No citations.").size).toBe(0);
  });
});

describe("grounded sources", () => {
  const welcome = { title: "Welcome to Mindstone", snippet: "", excerpt: "Mindstone is a local-first workspace. Pages nest without limit. Tasks, projects and the calendar live in the sidebar." };
  const launch = { title: "Launch logistics", snippet: "", excerpt: "Internal notes. The launch codename is BLUEFIN and the venue is the Harbour Hall in Lisbon." };
  const warranty = { title: "warranty.pdf", snippet: "", excerpt: "The warranty period for the KX-9 drill is 36 months." };
  it("keeps sources the answer uses even without [n] markers", () => {
    expect(groundedSources("The codename is BLUEFIN, at Harbour Hall in Lisbon.", [welcome, launch])).toEqual([1]);
    expect(groundedSources("The KX-9 drill has a 36-month warranty.", [welcome, warranty])).toEqual([1]);
  });
  it("drops retrieved sources the answer does not use", () => {
    expect(groundedSources("Flight at 00:00 and train at 14:00 tomorrow.", [welcome])).toEqual([]);
    expect(groundedSources("Project: Community Garden Revitalization. Recruit volunteers.", [welcome])).toEqual([]);
  });
  it("always keeps explicitly cited sources", () => {
    expect(groundedSources("See [1].", [welcome, launch])).toEqual([0]);
  });
});
