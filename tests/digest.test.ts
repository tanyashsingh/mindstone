import { beforeEach, describe, expect, it } from "vitest";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { buildDigest, digestMarkdown, isEmptyDigest, notesFromPage } from "@/lib/digest";
import type { JSONContent } from "@/data/types";

// Minimal Markdown to document: ## headings, '- [ ]' / '- [x]' task items, '- ' bullets, plain paragraphs.
function markdownToDoc(md: string): JSONContent {
  const out: JSONContent[] = [];
  const text = (t: string) => [{ type: "paragraph", content: [{ type: "text", text: t }] }];
  for (const block of md.split(/\n\n/)) {
    const lines = block.split("\n");
    for (const l of lines) {
      const h = /^## (.*)/.exec(l), tk = /^- \[( |x)\] (.*)/.exec(l), b = /^- (.*)/.exec(l);
      const last = out[out.length - 1];
      if (h) out.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: h[1]! }] });
      else if (tk) { const item = { type: "taskItem", attrs: { checked: tk[1] === "x" }, content: text(tk[2]!) }; if (last?.type === "taskList") last.content!.push(item); else out.push({ type: "taskList", content: [item] }); }
      else if (b) { const item = { type: "listItem", content: text(b[1]!) }; if (last?.type === "bulletList") last.content!.push(item); else out.push({ type: "bulletList", content: [item] }); }
      else if (l.trim()) out.push(...text(l));
    }
  }
  return { type: "doc", content: out };
}

let n = 0;
beforeEach(() => { useDatabase(`digest-${Date.now()}-${n++}`); });

describe("digest", () => {
  it("reads decisions and action items from meeting notes", () => {
    const content = markdownToDoc("## Summary\nWe met.\n\n## Decisions\n- Launch moves to March 3\n- Keep the price\n\n## Action items\n- [ ] Priya: send budget\n- [x] Tanya: book room\n\n## Notes\n- not an action");
    const r = notesFromPage({ id: "p1", title: "Call", content });
    expect(r.decisions.map((d) => d.text)).toEqual(["Launch moves to March 3", "Keep the price"]);
    expect(r.actionItems.map((a) => [a.text, a.done])).toEqual([["Priya: send budget", false], ["Tanya: book room", true]]);
  });

  it("collects the period's tasks, events, pages and notes from real data", async () => {
    const now = new Date(2026, 10, 26, 15, 0);
    const ws = await repo.createWorkspace("W");
    const t = (title: string, partial: Parameters<typeof repo.createTask>[1]) => repo.createTask(ws.id, { title, ...partial });
    const done = await t("Ship v2", {});
    await db().tasks.update(done.id, { status: "done", completedAt: now.getTime() - 3600_000 });
    const oldDone = await t("Old thing", {});
    await db().tasks.update(oldDone.id, { status: "done", completedAt: now.getTime() - 3 * 864e5 });
    await t("Pay invoice", { dueDate: "2026-11-24" });
    await t("Call bank", { dueDate: "2026-11-27" });
    await t("Far away", { dueDate: "2026-12-20" });
    await db().events.add({ id: "e1", workspaceId: ws.id, title: "Board meeting", notes: "", start: new Date(2026, 10, 27, 10).getTime(), end: new Date(2026, 10, 27, 11).getTime(), allDay: 0, timezone: "UTC", calendar: "Work", color: "blue", recurrence: null, reminderMin: null, createdAt: 0, updatedAt: 0, deletedAt: 0 });
    const page = await repo.createPage(ws.id, null, { title: "Standup" });
    await repo.savePageContent(page.id, markdownToDoc("## Decisions\n- Freeze scope\n\n## Action items\n- [ ] Draft FAQ"));

    const today = await buildDigest(ws.id, "today", now);
    expect(today.tasksDone.map((x) => x.title)).toEqual(["Ship v2"]);
    expect(today.tasksOverdue.map((x) => x.title)).toEqual(["Pay invoice"]);
    expect(today.tasksDue.map((x) => x.title)).toEqual(["Call bank"]);
    expect(today.events.map((e) => e.title)).toEqual(["Board meeting"]);
    expect(today.decisions.map((d) => d.text)).toEqual(["Freeze scope"]);
    expect(today.actionItems.map((d) => d.text)).toEqual(["Draft FAQ"]);
    expect(isEmptyDigest(today)).toBe(false);

    const week = await buildDigest(ws.id, "week", now);
    expect(week.tasksDone.map((x) => x.title).sort()).toEqual(["Old thing", "Ship v2"]);
    const md = digestMarkdown(week);
    expect(md).toMatch(/## Done this week[\s\S]*Ship v2/);
    expect(md).toMatch(/## Overdue[\s\S]*Pay invoice/);
    expect(md).toMatch(/## Decisions\n- Freeze scope \(Standup\)/);
    expect(md).not.toContain("Far away");
  });

  it("says so when nothing happened", async () => {
    const ws = await repo.createWorkspace("Empty");
    await db().pages.where("workspaceId").equals(ws.id).delete();
    const d = await buildDigest(ws.id, "today");
    expect(isEmptyDigest(d)).toBe(true);
    expect(digestMarkdown(d)).toBe("Nothing happened today yet.");
  });
});
