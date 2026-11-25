import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Sun, Moon, Sunrise, CalendarDays, Star, Clock, FolderKanban, NotebookPen, Timer, Target, Flame, Plus, Play, Pause, RotateCcw, Trash2, ListChecks } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { Task } from "@/data/types";
import { useApp } from "@/store/app";
import { expandEvent } from "@/lib/recurrence";
import { addDays, cx, fmtDate, fmtTime, parseISODate, relTime, startOfWeek, toISODate, today, uid } from "@/lib/util";
import { QuickAdd, TaskDetail, TaskRow } from "./Tasks";
import { EmptyState, promptDialog } from "@/components/ui";

function Card({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="panel p-4" aria-label={title}>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-muted"><span className="[&>svg]:size-4">{icon}</span><span className="flex-1">{title}</span>{action}</div>
      {children}
    </section>
  );
}

function Pomodoro({ tasks }: { tasks: Task[] }) {
  const [mins, setMins] = useState(25);
  const [left, setLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [taskId, setTaskId] = useState("");
  const tick = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(tick.current);
  }, [running]);
  useEffect(() => {
    if (left > 0 || !running) return;
    setRunning(false);
    setLeft(mins * 60);
    useApp.getState().toast(`Focus session complete (${mins} min)`, "success");
    if (window.rea) void window.rea.notify("Pomodoro complete", `${mins} minutes of focus`);
    if (taskId) void db().tasks.get(taskId).then((t) => t && repo.updateTask(t.id, { actualMin: t.actualMin + mins }));
  }, [left, running, mins, taskId]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
  return (
    <div>
      <div className="mb-2 text-center font-mono text-[34px] tabular-nums" role="timer" aria-live="off">{mm}:{ss}</div>
      <div className="mb-2 flex justify-center gap-1">
        <button className="btn-primary" onClick={() => setRunning(!running)}>{running ? <Pause size={14} /> : <Play size={14} />}{running ? "Pause" : "Start"}</button>
        <button className="btn-outline" onClick={() => { setRunning(false); setLeft(mins * 60); }} aria-label="Reset"><RotateCcw size={14} /></button>
        <select className="input h-7 w-20" value={mins} disabled={running} onChange={(e) => { setMins(Number(e.target.value)); setLeft(Number(e.target.value) * 60); }} aria-label="Session length">{[15, 25, 45, 50].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
      </div>
      <select className="input h-7" value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Track time against task"><option value="">Track time against… (optional)</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
    </div>
  );
}

function Habits({ ws }: { ws: string }) {
  const habits = useLiveQuery(() => db().habits.where("workspaceId").equals(ws).toArray(), [ws]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  const streak = (d: string[]) => { let n = 0; let cur = today(); const s = new Set(d); if (!s.has(cur)) cur = addDays(cur, -1); while (s.has(cur)) { n++; cur = addDays(cur, -1); } return n; };
  return (
    <div>
      {habits?.length === 0 && <div className="text-[13px] text-faint">Track a daily habit to build a streak.</div>}
      {habits?.map((h) => (
        <div key={h.id} className="group flex items-center gap-2 py-0.5">
          <span className="w-24 truncate text-[13px]">{h.name}</span>
          {days.map((d) => (
            <button key={d} title={fmtDate(d)} aria-label={`${h.name} on ${d}`} aria-pressed={h.days.includes(d)}
              className={cx("size-5 rounded", h.days.includes(d) ? "bg-accent" : "bg-active hover:bg-line-strong")}
              onClick={() => db().habits.update(h.id, { days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d] })} />
          ))}
          <span className="ml-1 flex items-center gap-0.5 text-[12px] text-muted"><Flame size={12} />{streak(h.days)}</span>
          <button className="icon-btn size-5 opacity-0 group-hover:opacity-100" aria-label="Delete habit" onClick={() => db().habits.delete(h.id)}><Trash2 size={12} /></button>
        </div>
      ))}
      <button className="btn mt-1 h-6 text-faint" onClick={async () => { const n = await promptDialog("New habit"); if (n) await db().habits.add({ id: uid(), workspaceId: ws, name: n, days: [], createdAt: Date.now() }); }}><Plus size={12} /> Habit</button>
    </div>
  );
}

function Goals({ ws }: { ws: string }) {
  const goals = useLiveQuery(() => db().goals.where("workspaceId").equals(ws).toArray(), [ws]);
  return (
    <div className="space-y-2">
      {goals?.length === 0 && <div className="text-[13px] text-faint">Set a measurable goal, like “Read 12 books”.</div>}
      {goals?.map((g) => {
        const pct = Math.min(100, Math.round((g.current / Math.max(1, g.target)) * 100));
        return (
          <div key={g.id} className="group">
            <div className="flex items-center text-[13px]"><span className="flex-1 truncate">{g.name}</span>
              <input type="number" className="w-14 bg-transparent text-right tabular-nums outline-none" value={g.current} onChange={(e) => db().goals.update(g.id, { current: Number(e.target.value) })} aria-label={`${g.name} progress`} />
              <span className="text-faint">/{g.target} {g.unit}</span>
              <button className="icon-btn ml-1 size-5 opacity-0 group-hover:opacity-100" aria-label="Delete goal" onClick={() => db().goals.delete(g.id)}><Trash2 size={12} /></button></div>
            <div className="mt-1 h-1 rounded bg-active"><div className="h-full rounded bg-success" style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
      <button className="btn h-6 text-faint" onClick={async () => {
        const name = await promptDialog("Goal name"); if (!name) return;
        const target = Number(await promptDialog("Target number", "10")) || 10;
        await db().goals.add({ id: uid(), workspaceId: ws, name, target, current: 0, unit: "", due: null, createdAt: Date.now() });
      }}><Plus size={12} /> Goal</button>
    </div>
  );
}

async function openJournal(ws: string, date = today()) {
  const pages = await repo.livePages(ws);
  let root = pages.find((p) => p.title === "Journal" && !p.parentId);
  if (!root) root = await repo.createPage(ws, null, { title: "Journal", icon: "📓" });
  const title = parseISODate(date).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let entry = pages.find((p) => p.parentId === root!.id && p.title === title);
  if (!entry) entry = await repo.createPage(ws, root.id, {
    title, icon: "📝",
    content: { type: "doc", content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Top priorities" }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Notes" }] }, { type: "paragraph" },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Reflection" }] }, { type: "paragraph" },
    ] },
  });
  useApp.getState().open({ kind: "page", id: entry.id });
}

export default function Home() {
  const ws = useApp((s) => s.workspaceId)!;
  const open = useApp((s) => s.open);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [note, setNote] = useState("");
  const data = useLiveQuery(async () => {
    const d = db();
    const t0 = today();
    const tasks = await d.tasks.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray();
    const pages = await repo.livePages(ws);
    const projects = (await d.projects.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray()).filter((p) => !p.archived && p.status === "active");
    const startDay = parseISODate(t0).getTime();
    const evs = await d.events.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray();
    const todays = evs.flatMap((e) => expandEvent(e, startDay, startDay + 864e5)).sort((a, b) => a.start - b.start);
    const weekFrom = startOfWeek(new Date()).getTime();
    return {
      open: tasks.filter((t) => t.status !== "done" && !t.parentTaskId),
      today: tasks.filter((t) => t.status !== "done" && !t.parentTaskId && t.dueDate && t.dueDate <= t0).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
      upcoming: tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate > t0 && t.dueDate <= addDays(t0, 7)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
      recent: [...pages].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 6),
      pinned: pages.filter((p) => p.favorite).slice(0, 6),
      projects,
      projectTasks: tasks,
      events: todays,
      week: {
        done: tasks.filter((t) => t.completedAt >= weekFrom).length,
        created: tasks.filter((t) => t.createdAt >= weekFrom).length,
        pagesEdited: pages.filter((p) => p.updatedAt >= weekFrom).length,
        focusMin: tasks.reduce((a, t) => a + (t.updatedAt >= weekFrom ? t.actualMin : 0), 0),
      },
    };
  }, [ws]);
  const h = new Date().getHours();
  const greet = h < 12 ? ["Good morning", <Sunrise key="i" size={22} />] : h < 18 ? ["Good afternoon", <Sun key="i" size={22} />] : ["Good evening", <Moon key="i" size={22} />];

  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <div className="mb-1 flex items-center gap-2 text-faint">{greet[1]}<span className="text-[13px]">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span></div>
      <h1 className="mb-6 text-[30px] font-bold tracking-tight">{greet[0]}</h1>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="panel p-3"><div className="mb-1 text-[12px] text-muted">Quick capture: task</div><QuickAdd /></div>
        <form className="panel flex items-center gap-2 p-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!note.trim()) return;
          const pages = await repo.livePages(ws);
          let inbox = pages.find((p) => p.title === "Quick notes" && !p.parentId);
          if (!inbox) inbox = await repo.createPage(ws, null, { title: "Quick notes", icon: "🗒️" });
          await repo.createPage(ws, inbox.id, { title: note.trim().slice(0, 80), content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: note.trim() }] }] } });
          setNote("");
          useApp.getState().toast("Note saved to Quick notes", "success");
        }}>
          <div className="flex-1"><div className="mb-1 text-[12px] text-muted">Quick capture: note</div><input className="input h-9 border-transparent bg-sunken" placeholder="Jot something down and press Enter" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Quick note" /></div>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-3">
          <Card title="Today & overdue" icon={<ListChecks />} action={<button className="btn h-6" onClick={() => open({ kind: "tasks" })}>All tasks</button>}>
            {data?.today.length === 0 ? <div className="py-3 text-[13px] text-faint">Nothing due today. Plan your day by giving tasks a due date.</div> : data?.today.map((t) => <TaskRow key={t.id} task={t} onOpen={setOpenTask} />)}
          </Card>
          <Card title="Upcoming deadlines · next 7 days" icon={<Clock />}>
            {data?.upcoming.length === 0 ? <div className="py-2 text-[13px] text-faint">No deadlines this week.</div> : data?.upcoming.map((t) => <TaskRow key={t.id} task={t} onOpen={setOpenTask} />)}
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Card title="Recent pages" icon={<Clock />}>
              {data?.recent.map((p) => <button key={p.id} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-hover" onClick={() => open({ kind: "page", id: p.id })}><span className="w-5 text-center">{p.icon || "📄"}</span><span className="flex-1 truncate">{p.title || "Untitled"}</span><span className="text-[11px] text-faint">{relTime(p.lastOpenedAt)}</span></button>)}
            </Card>
            <Card title="Pinned" icon={<Star />}>
              {data?.pinned.length === 0 ? <div className="text-[13px] text-faint">Star a page to pin it here.</div> : data?.pinned.map((p) => <button key={p.id} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-hover" onClick={() => open({ kind: "page", id: p.id })}><span className="w-5 text-center">{p.icon || "📄"}</span><span className="truncate">{p.title || "Untitled"}</span></button>)}
            </Card>
          </div>
          <Card title="Active projects" icon={<FolderKanban />}>
            {data?.projects.length === 0 ? <EmptyState title="No active projects" action={<button className="btn-outline" onClick={() => open({ kind: "projects" })}>Go to projects</button>} /> : data?.projects.map((p) => {
              const ts = data.projectTasks.filter((t) => t.projectId === p.id && !t.parentTaskId);
              const pct = ts.length ? Math.round((ts.filter((t) => t.status === "done").length / ts.length) * 100) : 0;
              return <button key={p.id} className="flex w-full items-center gap-3 rounded px-1 py-1.5 text-left text-[13px] hover:bg-hover" onClick={() => open({ kind: "project", id: p.id })}><span className="flex-1 truncate">{p.name}</span><span className="h-1 w-32 rounded bg-active"><span className="block h-full rounded bg-accent" style={{ width: `${pct}%` }} /></span><span className="w-10 text-right text-faint">{pct}%</span></button>;
            })}
          </Card>
        </div>
        <div className="space-y-3">
          <Card title="Today's schedule" icon={<CalendarDays />} action={<button className="btn h-6" onClick={() => open({ kind: "calendar" })}>Calendar</button>}>
            {data?.events.length === 0 ? <div className="text-[13px] text-faint">No events today.</div> : data?.events.map((o) => <div key={o.key} className="flex gap-2 py-0.5 text-[13px]"><span className="w-20 text-muted">{o.event.allDay ? "All day" : fmtTime(o.start)}</span><span className="truncate">{o.event.title}</span></div>)}
          </Card>
          <Card title="Daily journal" icon={<NotebookPen />}>
            <button className="btn-outline w-full justify-center" onClick={() => openJournal(ws)}>Open today's entry</button>
          </Card>
          <Card title="Weekly review" icon={<Target />}>
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <div><dt className="text-faint">Tasks completed</dt><dd className="text-[18px] font-semibold tabular-nums">{data?.week.done ?? 0}</dd></div>
              <div><dt className="text-faint">Tasks added</dt><dd className="text-[18px] font-semibold tabular-nums">{data?.week.created ?? 0}</dd></div>
              <div><dt className="text-faint">Pages edited</dt><dd className="text-[18px] font-semibold tabular-nums">{data?.week.pagesEdited ?? 0}</dd></div>
              <div><dt className="text-faint">Open tasks</dt><dd className="text-[18px] font-semibold tabular-nums">{data?.open.length ?? 0}</dd></div>
            </dl>
            <div className="mt-1 text-[11px] text-faint">Since {fmtDate(toISODate(startOfWeek(new Date())))}</div>
          </Card>
          <Card title="Focus timer" icon={<Timer />}><Pomodoro tasks={data?.open ?? []} /></Card>
          <Card title="Habits" icon={<Flame />}><Habits ws={ws} /></Card>
          <Card title="Goals" icon={<Target />}><Goals ws={ws} /></Card>
        </div>
      </div>
      {openTask && <TaskDetail task={openTask} onClose={() => setOpenTask(null)} />}
    </div>
  );
}
