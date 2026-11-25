import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FolderKanban, Plus, Archive, ArchiveRestore, FileText, Trash2, Check } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { Project, Task } from "@/data/types";
import { useApp } from "@/store/app";
import { Chip, EmptyState, confirmDialog } from "@/components/ui";
import { QuickAdd, TaskDetail, TaskRow } from "./Tasks";
import { cx, fmtDate, relTime, uid, today } from "@/lib/util";

const STATUS_COLOR: Record<Project["status"], string> = { planned: "gray", active: "blue", paused: "yellow", completed: "green" };

function ProjectDetail({ id }: { id: string }) {
  const p = useLiveQuery(() => db().projects.get(id), [id]);
  const tasks = useLiveQuery(() => db().tasks.where("projectId").equals(id).filter((t) => !t.deletedAt).toArray(), [id]);
  const activity = useLiveQuery(async () => {
    const ids = [id, ...(tasks ?? []).map((t) => t.id)];
    return (await db().activity.where("entityId").anyOf(ids).toArray()).sort((a, b) => b.at - a.at).slice(0, 15);
  }, [id, tasks]);
  const [open, setOpen] = useState<Task | null>(null);
  const [ms, setMs] = useState("");
  const app = useApp();
  if (!p) return null;
  const up = (patch: Partial<Project>) => repo.updateProject(p.id, patch);
  const top = (tasks ?? []).filter((t) => !t.parentTaskId);
  const done = top.filter((t) => t.status === "done").length;
  const pct = top.length ? Math.round((done / top.length) * 100) : 0;
  const overdue = top.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < today()).length;
  const estimate = top.reduce((a, t) => a + t.estimateMin, 0), actual = top.reduce((a, t) => a + t.actualMin, 0);

  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <button className="btn mb-3 text-muted" onClick={() => app.open({ kind: "projects" })}>← All projects</button>
      <input className="w-full bg-transparent text-[30px] font-bold tracking-tight outline-none" defaultValue={p.name} onBlur={(e) => up({ name: e.target.value || "Untitled project" })} aria-label="Project name" />
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-2 text-[13px]">
        <select className="input h-7 w-32" value={p.status} onChange={(e) => up({ status: e.target.value as Project["status"] })}>{Object.keys(STATUS_COLOR).map((s) => <option key={s}>{s}</option>)}</select>
        <input type="date" className="input h-7 w-36" value={p.startDate ?? ""} onChange={(e) => up({ startDate: e.target.value || null })} aria-label="Start date" />
        <span className="text-faint">→</span>
        <input type="date" className="input h-7 w-36" value={p.targetDate ?? ""} onChange={(e) => up({ targetDate: e.target.value || null })} aria-label="Target date" />
        <span className="flex-1" />
        {p.docPageId ? <button className="btn-outline" onClick={() => app.open({ kind: "page", id: p.docPageId! })}><FileText size={14} /> Project docs</button>
          : <button className="btn-outline" onClick={async () => { const pg = await repo.createPage(p.workspaceId, null, { title: `${p.name} – docs`, icon: "📁" }); await up({ docPageId: pg.id }); app.open({ kind: "page", id: pg.id }); }}><FileText size={14} /> Create docs page</button>}
        <button className="btn-outline" onClick={() => up({ archived: p.archived ? 0 : 1 })}>{p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{p.archived ? "Unarchive" : "Archive"}</button>
      </div>
      <textarea className="textarea mb-5" rows={2} defaultValue={p.description} placeholder="What is this project about?" onBlur={(e) => up({ description: e.target.value })} />

      <section className="mb-6 grid grid-cols-4 gap-3" aria-label="Progress report">
        {[["Progress", `${pct}%`], ["Tasks done", `${done} / ${top.length}`], ["Overdue", String(overdue)], ["Time (actual / est.)", `${Math.round(actual / 60 * 10) / 10}h / ${Math.round(estimate / 60 * 10) / 10}h`]].map(([k, v]) => (
          <div key={k} className="panel p-3"><div className="text-[12px] text-muted">{k}</div><div className="text-[20px] font-semibold tabular-nums">{v}</div></div>
        ))}
      </section>
      <div className="mb-6 h-1.5 rounded bg-active"><div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} /></div>

      <h2 className="mb-2 font-semibold">Milestones</h2>
      <div className="mb-6 space-y-1">
        {p.milestones.map((m) => (
          <div key={m.id} className="flex items-center gap-2">
            <button className={cx("flex size-4 items-center justify-center rounded-full border", m.done ? "border-success bg-success text-white" : "border-line-strong")} onClick={() => up({ milestones: p.milestones.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)) })} aria-label="Toggle milestone">{m.done && <Check size={10} />}</button>
            <span className={cx("flex-1 text-[13.5px]", m.done && "text-faint line-through")}>{m.name}</span>
            <input type="date" className="input h-7 w-36" value={m.date ?? ""} onChange={(e) => up({ milestones: p.milestones.map((x) => (x.id === m.id ? { ...x, date: e.target.value || null } : x)) })} />
            <button className="icon-btn" aria-label="Delete milestone" onClick={() => up({ milestones: p.milestones.filter((x) => x.id !== m.id) })}><Trash2 size={13} /></button>
          </div>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); if (ms.trim()) { void up({ milestones: [...p.milestones, { id: uid(), name: ms.trim(), date: null, done: false }] }); setMs(""); } }}>
          <input className="input" placeholder="Add a milestone" value={ms} onChange={(e) => setMs(e.target.value)} />
        </form>
      </div>

      {(p.startDate || p.milestones.some((m) => m.date)) && p.targetDate && (() => {
        const s = new Date(p.startDate ?? p.targetDate).getTime(), e = new Date(p.targetDate).getTime(), span = Math.max(1, e - s);
        const pos = (d: string) => `${Math.min(100, Math.max(0, ((new Date(d).getTime() - s) / span) * 100))}%`;
        return (
          <section className="mb-6" aria-label="Timeline">
            <h2 className="mb-2 font-semibold">Timeline</h2>
            <div className="relative h-14 rounded-md border border-line bg-sunken">
              <div className="absolute inset-x-0 top-6 h-1 bg-active" />
              <div className="absolute top-4 h-5 w-0.5 bg-danger" style={{ left: pos(today()) }} title="Today" />
              {p.milestones.filter((m) => m.date).map((m) => <div key={m.id} className="absolute top-5 -translate-x-1/2 text-center" style={{ left: pos(m.date!) }}><div className={cx("mx-auto size-3 rotate-45", m.done ? "bg-success" : "bg-accent")} /><div className="mt-1 whitespace-nowrap text-[10px] text-muted">{m.name}</div></div>)}
              <span className="absolute bottom-0.5 left-1 text-[10px] text-faint">{fmtDate(p.startDate ?? p.targetDate)}</span><span className="absolute bottom-0.5 right-1 text-[10px] text-faint">{fmtDate(p.targetDate)}</span>
            </div>
          </section>
        );
      })()}

      <h2 className="mb-2 font-semibold">Tasks</h2>
      <QuickAdd projectId={p.id} placeholder="Add a task to this project" />
      <div className="mt-2">{top.sort((a, b) => Number(a.status === "done") - Number(b.status === "done")).map((t) => <TaskRow key={t.id} task={t} onOpen={setOpen} />)}</div>

      <h2 className="mb-2 mt-6 font-semibold">Activity</h2>
      <div className="space-y-1 text-[13px] text-muted">{activity?.map((a) => <div key={a.id}>{a.entity} <b className="font-medium text-fg">{a.detail}</b> {a.action} · {relTime(a.at)}</div>)}</div>
      <button className="btn-danger mt-8" onClick={async () => { if (await confirmDialog("Delete this project?", "Its tasks are kept and become unassigned.", { danger: true })) { await repo.updateProject(p.id, { deletedAt: Date.now() }); await db().tasks.where("projectId").equals(p.id).modify({ projectId: null }); app.open({ kind: "projects" }); } }}><Trash2 size={14} /> Delete project</button>
      {open && <TaskDetail task={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export default function Projects({ projectId }: { projectId?: string }) {
  const ws = useApp((s) => s.workspaceId)!;
  const open = useApp((s) => s.open);
  const [archived, setArchived] = useState(false);
  const projects = useLiveQuery(() => db().projects.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray(), [ws]);
  const tasks = useLiveQuery(() => db().tasks.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray(), [ws]);
  if (projectId) return <ProjectDetail id={projectId} />;
  const list = (projects ?? []).filter((p) => !!p.archived === archived);
  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <div className="mb-6 flex items-center gap-3">
        <FolderKanban size={22} className="text-muted" /><h1 className="text-[26px] font-bold tracking-tight">Projects</h1><span className="flex-1" />
        <button className="btn" onClick={() => setArchived(!archived)}>{archived ? "Show active" : "Show archived"}</button>
        <button className="btn-primary" onClick={async () => { const p = await repo.createProject(ws, { status: "active" }); open({ kind: "project", id: p.id }); }}><Plus size={14} /> New project</button>
      </div>
      {list.length === 0 && <EmptyState icon={<FolderKanban />} title={archived ? "No archived projects" : "No projects yet"} body="Projects group tasks, milestones and a documentation page." />}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {list.map((p) => {
          const ts = (tasks ?? []).filter((t) => t.projectId === p.id && !t.parentTaskId);
          const pct = ts.length ? Math.round((ts.filter((t) => t.status === "done").length / ts.length) * 100) : 0;
          return (
            <button key={p.id} className="panel p-4 text-left hover:border-line-strong" onClick={() => open({ kind: "project", id: p.id })}>
              <div className="mb-1 flex items-center gap-2"><span className="flex-1 truncate font-medium">{p.name}</span><Chip color={STATUS_COLOR[p.status]}>{p.status}</Chip></div>
              <div className="mb-3 line-clamp-2 min-h-[2.5em] text-[12.5px] text-muted">{p.description || "No description"}</div>
              <div className="mb-1 h-1 rounded bg-active"><div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} /></div>
              <div className="flex justify-between text-[12px] text-faint"><span>{ts.length} tasks · {pct}%</span><span>{p.targetDate ? `Due ${fmtDate(p.targetDate)}` : ""}</span></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
