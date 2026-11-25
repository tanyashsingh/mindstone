import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckSquare, Plus, Circle, CheckCircle2, CircleDot, Ban, Repeat, Bell, Link2, Trash2, Flag } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { Priority, Recurrence, Task, TaskStatus } from "@/data/types";
import { useApp } from "@/store/app";
import { Chip, EmptyState, Modal } from "@/components/ui";
import { addDays, cx, fmtDate, today } from "@/lib/util";

export const STATUS: Record<TaskStatus, { label: string; icon: React.ReactNode; color: string }> = {
  todo: { label: "To do", icon: <Circle size={16} />, color: "gray" },
  doing: { label: "In progress", icon: <CircleDot size={16} className="text-accent" />, color: "blue" },
  blocked: { label: "Blocked", icon: <Ban size={16} className="text-danger" />, color: "red" },
  done: { label: "Done", icon: <CheckCircle2 size={16} className="text-success" />, color: "green" },
};
export const PRIORITY: Record<Priority, { label: string; color: string; rank: number }> = {
  urgent: { label: "Urgent", color: "red", rank: 0 }, high: { label: "High", color: "orange", rank: 1 }, medium: { label: "Medium", color: "yellow", rank: 2 }, low: { label: "Low", color: "blue", rank: 3 }, none: { label: "None", color: "gray", rank: 4 },
};

/** "Call Sam tomorrow !high #work" → title, due date, priority, tags. */
export function parseQuickTask(input: string): Partial<Task> {
  let title = input;
  let dueDate: string | null = null;
  let priority: Priority = "none";
  const tags: string[] = [];
  title = title.replace(/\s!(urgent|high|medium|low)\b/i, (_m, p: string) => { priority = p.toLowerCase() as Priority; return ""; });
  title = title.replace(/\s#([\w-]+)/g, (_m, t: string) => { tags.push(t.toLowerCase()); return ""; });
  title = title.replace(/\s(today|tomorrow|next week)\b/i, (_m, d: string) => { dueDate = d.toLowerCase() === "today" ? today() : d.toLowerCase() === "tomorrow" ? addDays(today(), 1) : addDays(today(), 7); return ""; });
  title = title.replace(/\s(\d{4}-\d{2}-\d{2})\b/, (_m, d: string) => { dueDate = d; return ""; });
  return { title: title.trim(), dueDate, priority, tags };
}

export function QuickAdd({ projectId = null, placeholder = "Add a task… try “Review draft tomorrow !high #work”" }: { projectId?: string | null; placeholder?: string }) {
  const ws = useApp((s) => s.workspaceId)!;
  const [v, setV] = useState("");
  return (
    <form className="flex items-center gap-2" onSubmit={async (e) => { e.preventDefault(); const p = parseQuickTask(` ${v}`); if (!p.title) return; await repo.createTask(ws, { ...p, projectId }); setV(""); }}>
      <Plus size={16} className="text-faint" />
      <input className="input h-9 border-transparent bg-sunken" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} aria-label="New task" />
    </form>
  );
}

export function TaskRow({ task, onOpen, showProject }: { task: Task; onOpen: (t: Task) => void; showProject?: string }) {
  const overdue = task.dueDate && task.dueDate < today() && task.status !== "done";
  return (
    <div className="group flex h-9 items-center gap-2 rounded-md px-2 hover:bg-hover">
      <button aria-label={task.status === "done" ? "Mark not done" : "Mark done"} className="text-muted hover:text-fg" onClick={async () => {
        if (task.status !== "done") {
          const blockers = await repo.openBlockers(task);
          if (blockers.length) return useApp.getState().toast(`Blocked by “${blockers[0]!.title}”`, "error");
        }
        await repo.updateTask(task.id, { status: task.status === "done" ? "todo" : "done" });
      }}>{STATUS[task.status].icon}</button>
      <button className={cx("min-w-0 flex-1 truncate text-left text-[13.5px]", task.status === "done" && "text-faint line-through")} onClick={() => onOpen(task)}>{task.title || "Untitled task"}</button>
      {task.recurrence && <Repeat size={13} className="text-faint" aria-label="Recurring" />}
      {task.reminderAt && <Bell size={13} className="text-faint" aria-label="Has reminder" />}
      {task.dependsOn.length > 0 && <Link2 size={13} className="text-faint" aria-label="Has dependencies" />}
      {showProject && <span className="text-[12px] text-faint">{showProject}</span>}
      {task.tags.map((t) => <span key={t} className="text-[12px] text-faint">#{t}</span>)}
      {task.priority !== "none" && <Chip color={PRIORITY[task.priority].color}>{PRIORITY[task.priority].label}</Chip>}
      {task.dueDate && <span className={cx("w-16 text-right text-[12px]", overdue ? "text-danger" : "text-muted")}>{fmtDate(task.dueDate)}</span>}
    </div>
  );
}

export function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const t = useLiveQuery(() => db().tasks.get(task.id), [task.id]) ?? task;
  const projects = useLiveQuery(() => db().projects.where("[workspaceId+deletedAt]").equals([t.workspaceId, 0]).toArray(), [t.workspaceId]);
  const all = useLiveQuery(() => db().tasks.where("[workspaceId+deletedAt]").equals([t.workspaceId, 0]).toArray(), [t.workspaceId]);
  const subtasks = all?.filter((x) => x.parentTaskId === t.id) ?? [];
  const up = (patch: Partial<Task>) => repo.updateTask(t.id, patch);
  const [sub, setSub] = useState("");
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="flex items-center gap-3"><span className="w-28 shrink-0 text-[13px] text-muted">{label}</span><div className="flex-1">{children}</div></div>;
  const reminderLocal = t.reminderAt ? new Date(t.reminderAt - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16) : "";
  return (
    <Modal open onClose={onClose} width={640} title="Task"
      footer={<button className="btn-danger mr-auto" onClick={async () => { await repo.trashTask(t.id); onClose(); }}><Trash2 size={14} /> Delete task</button>}>
      <input className="mb-3 w-full bg-transparent text-[20px] font-semibold outline-none" defaultValue={t.title} placeholder="Task title" onBlur={(e) => up({ title: e.target.value })} />
      <div className="space-y-2">
        <Row label="Status"><select className="input" value={t.status} onChange={(e) => up({ status: e.target.value as TaskStatus })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Row>
        <Row label="Priority"><select className="input" value={t.priority} onChange={(e) => up({ priority: e.target.value as Priority })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Row>
        <Row label="Important"><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!t.important} onChange={(e) => up({ important: e.target.checked ? 1 : 0 })} /> Counts as important in the Eisenhower matrix</label></Row>
        <Row label="Project"><select className="input" value={t.projectId ?? ""} onChange={(e) => up({ projectId: e.target.value || null })}><option value="">No project</option>{projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Row>
        <Row label="Start / due"><div className="flex gap-2"><input type="date" className="input" value={t.startDate ?? ""} onChange={(e) => up({ startDate: e.target.value || null })} /><input type="date" className="input" value={t.dueDate ?? ""} onChange={(e) => up({ dueDate: e.target.value || null })} /></div></Row>
        <Row label="Reminder"><input type="datetime-local" className="input" value={reminderLocal} onChange={(e) => up({ reminderAt: e.target.value ? new Date(e.target.value).getTime() : null })} /></Row>
        <Row label="Repeat">
          <div className="flex gap-2">
            <select className="input" value={t.recurrence?.freq ?? ""} onChange={(e) => up({ recurrence: e.target.value ? { freq: e.target.value as NonNullable<Recurrence>["freq"], interval: t.recurrence?.interval ?? 1 } : null })}>
              <option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
            </select>
            {t.recurrence && <input type="number" min={1} className="input w-20" value={t.recurrence.interval} onChange={(e) => up({ recurrence: { ...t.recurrence!, interval: Math.max(1, Number(e.target.value)) } })} aria-label="Repeat interval" />}
          </div>
          {t.recurrence && !t.dueDate && <div className="mt-1 text-[12px] text-warning">Set a due date so the next occurrence can be scheduled.</div>}
        </Row>
        <Row label="Estimate / actual"><div className="flex items-center gap-2"><input type="number" min={0} className="input w-24" value={t.estimateMin} onChange={(e) => up({ estimateMin: Number(e.target.value) })} /><span className="text-[12px] text-faint">min</span><input type="number" min={0} className="input w-24" value={t.actualMin} onChange={(e) => up({ actualMin: Number(e.target.value) })} /><span className="text-[12px] text-faint">min</span></div></Row>
        <Row label="Tags"><input className="input" defaultValue={t.tags.join(", ")} placeholder="comma, separated" onBlur={(e) => up({ tags: e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) })} /></Row>
        <Row label="Depends on">
          <div className="flex flex-wrap items-center gap-1">
            {t.dependsOn.map((id) => { const d = all?.find((x) => x.id === id); return <Chip key={id} color={d?.status === "done" ? "green" : "gray"} onRemove={() => up({ dependsOn: t.dependsOn.filter((x) => x !== id) })}>{d?.title ?? "Deleted task"}</Chip>; })}
            <select className="input h-7 w-48" value="" onChange={async (e) => {
              const id = e.target.value;
              if (!id) return;
              if (await repo.wouldCreateCycle(t.id, id)) return useApp.getState().toast("That would create a dependency loop", "error");
              await up({ dependsOn: [...t.dependsOn, id] });
            }}><option value="">Add dependency…</option>{all?.filter((x) => x.id !== t.id && !t.dependsOn.includes(x.id) && x.status !== "done").map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
          </div>
        </Row>
      </div>
      <div className="label mb-1 mt-4">Description</div>
      <textarea className="textarea" rows={4} defaultValue={t.description} onBlur={(e) => up({ description: e.target.value })} placeholder="Notes, links, context…" />
      <div className="label mb-1 mt-4">Subtasks {subtasks.length > 0 && `· ${subtasks.filter((s) => s.status === "done").length}/${subtasks.length}`}</div>
      {subtasks.map((s) => <TaskRow key={s.id} task={s} onOpen={() => {}} />)}
      <form onSubmit={async (e) => { e.preventDefault(); if (!sub.trim()) return; await repo.createTask(t.workspaceId, { title: sub.trim(), parentTaskId: t.id, projectId: t.projectId }); setSub(""); }}>
        <input className="input mt-1" placeholder="Add a subtask" value={sub} onChange={(e) => setSub(e.target.value)} />
      </form>
    </Modal>
  );
}

type Mode = "list" | "board" | "matrix";

export default function Tasks() {
  const ws = useApp((s) => s.workspaceId)!;
  const [mode, setMode] = useState<Mode>("list");
  const [showDone, setShowDone] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [open, setOpen] = useState<Task | null>(null);
  const tasks = useLiveQuery(() => db().tasks.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray(), [ws]);
  const projects = useLiveQuery(() => db().projects.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray(), [ws]);
  const pname = useMemo(() => new Map(projects?.map((p) => [p.id, p.name])), [projects]);

  const list = useMemo(() => (tasks ?? []).filter((t) => !t.parentTaskId && (showDone || t.status !== "done") && (!projectFilter || t.projectId === projectFilter))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || PRIORITY[a.priority].rank - PRIORITY[b.priority].rank || a.sortKey - b.sortKey), [tasks, showDone, projectFilter]);

  const t0 = today(), week = addDays(t0, 7);
  const sections: [string, Task[]][] = [
    ["Overdue", list.filter((t) => t.dueDate && t.dueDate < t0 && t.status !== "done")],
    ["Today", list.filter((t) => t.dueDate === t0)],
    ["Next 7 days", list.filter((t) => t.dueDate && t.dueDate > t0 && t.dueDate <= week)],
    ["Later", list.filter((t) => t.dueDate && t.dueDate > week)],
    ["No date", list.filter((t) => !t.dueDate)],
  ];

  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <div className="mb-6 flex items-center gap-3">
        <CheckSquare size={22} className="text-muted" />
        <h1 className="text-[26px] font-bold tracking-tight">Tasks</h1>
        <span className="flex-1" />
        <div className="flex gap-0.5 rounded-[10px] bg-sunken p-0.5 shadow-[var(--inset)]">
          {(["list", "board", "matrix"] as Mode[]).map((m) => <button key={m} className={cx("btn h-6", mode === m && "bg-active")} onClick={() => setMode(m)}>{m === "matrix" ? "Eisenhower" : m[0]!.toUpperCase() + m.slice(1)}</button>)}
        </div>
        <select className="input h-7 w-40" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Filter by project"><option value="">All projects</option>{projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="flex items-center gap-1.5 text-[13px] text-muted"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      <div className="mb-4"><QuickAdd projectId={projectFilter || null} /></div>
      {tasks && tasks.length === 0 && <EmptyState icon={<CheckSquare />} title="No tasks yet" body="Add one above. Tasks can have due dates, reminders, subtasks, dependencies and repeat schedules." />}
      {mode === "list" && sections.filter(([, ts]) => ts.length).map(([name, ts]) => (
        <section key={name} className="mb-5">
          <h2 className={cx("mb-1 px-2 text-[12px] font-semibold uppercase tracking-wide", name === "Overdue" ? "text-danger" : "text-faint")}>{name} · {ts.length}</h2>
          {ts.map((t) => <TaskRow key={t.id} task={t} onOpen={setOpen} showProject={t.projectId ? pname.get(t.projectId) : undefined} />)}
        </section>
      ))}
      {mode === "board" && (
        <div className="grid grid-cols-4 gap-3">
          {(Object.keys(STATUS) as TaskStatus[]).map((s) => (
            <div key={s} className="min-h-40 rounded-[14px] bg-sunken p-2.5 shadow-[var(--inset)]" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/rea-task"); if (id) void repo.updateTask(id, { status: s }); }}>
              <div className="mb-2 flex items-center gap-2 px-1 text-[13px] font-medium">{STATUS[s].icon}{STATUS[s].label}<span className="text-faint">{(tasks ?? []).filter((t) => t.status === s && !t.parentTaskId && (!projectFilter || t.projectId === projectFilter)).length}</span></div>
              {(tasks ?? []).filter((t) => t.status === s && !t.parentTaskId && (!projectFilter || t.projectId === projectFilter)).map((t) => (
                <button key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/rea-task", t.id)} onClick={() => setOpen(t)} className="panel mb-1.5 block w-full p-2 text-left text-[13px] hover:border-line-strong">
                  <div className="mb-1">{t.title}</div>
                  <div className="flex gap-1 text-[11px] text-faint">{t.priority !== "none" && <Flag size={11} />}{t.dueDate && fmtDate(t.dueDate)}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {mode === "matrix" && (
        <div className="grid grid-cols-2 gap-3">
          {([[true, true, "Do first", "Important & urgent"], [true, false, "Schedule", "Important, not urgent"], [false, true, "Delegate", "Urgent, not important"], [false, false, "Eliminate", "Neither"]] as const).map(([imp, urg, title, sub]) => {
            const urgent = (t: Task) => t.priority === "urgent" || (!!t.dueDate && t.dueDate <= addDays(t0, 2));
            const ts = list.filter((t) => t.status !== "done" && !!t.important === imp && urgent(t) === urg);
            return (
              <div key={title} className="panel min-h-48 p-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/rea-task"); if (id) void repo.updateTask(id, { important: imp ? 1 : 0 }); }}>
                <div className="font-medium">{title}</div><div className="mb-2 text-[12px] text-faint">{sub} · urgent = due within 2 days or urgent priority</div>
                {ts.map((t) => <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/rea-task", t.id)}><TaskRow task={t} onOpen={setOpen} /></div>)}
              </div>
            );
          })}
        </div>
      )}
      {open && <TaskDetail task={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
