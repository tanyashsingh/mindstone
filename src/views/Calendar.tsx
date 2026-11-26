import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, Plus, Download, Upload, ChevronLeft, ChevronRight, Trash2, CheckSquare, Rss } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { CalendarEvent, Recurrence, Task } from "@/data/types";
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { Modal } from "@/components/ui";
import { expandEvent, type Occurrence } from "@/lib/recurrence";
import { eventFields, parseICS, toICS } from "@/lib/ics";
import { addDays, cx, downloadBlob, fmtTime, parseISODate, startOfWeek, toISODate, today } from "@/lib/util";
import { FeedsDialog } from "@/components/FeedsDialog";
import { TaskDetail } from "./Tasks";

type Mode = "day" | "week" | "month" | "agenda";
const COLORS = ["blue", "green", "purple", "orange", "red", "pink", "yellow", "gray"];
const toLocalInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);

function FeedEventModal({ e, onClose }: { e: CalendarEvent; onClose: () => void }) {
  const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, e.allDay ? { dateStyle: "full" } : { dateStyle: "full", timeStyle: "short" });
  return (
    <Modal open onClose={onClose} title={e.title} width={480}>
      <div className="space-y-2 text-[13.5px]" data-testid="feed-event">
        <p>{fmt(e.start)}{!e.allDay && e.end > e.start ? ` to ${new Date(e.end).toLocaleTimeString(undefined, { timeStyle: "short" })}` : ""}</p>
        {e.recurrence && <p className="text-muted">Repeats {e.recurrence.freq}{e.recurrence.byDay?.length ? ` on ${e.recurrence.byDay.join(", ")}` : ""}</p>}
        {e.notes && <p className="whitespace-pre-wrap text-muted">{e.notes}</p>}
        <p className="rounded-md bg-sunken p-2 text-[12.5px] text-muted">From the subscribed calendar “{e.calendar}”. It is read-only here; change it in its own calendar and it updates within 30 minutes.</p>
      </div>
    </Modal>
  );
}

function EventModal({ ev, onClose }: { ev: CalendarEvent; onClose: () => void }) {
  const e = useLiveQuery(() => db().events.get(ev.id), [ev.id]) ?? ev;
  const up = (patch: Partial<CalendarEvent>) => repo.updateEvent(e.id, patch);
  if (e.feedId) return <FeedEventModal e={e} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title="Event" width={520}
      footer={<button className="btn-danger mr-auto" onClick={async () => { await repo.updateEvent(e.id, { deletedAt: Date.now() }); onClose(); }}><Trash2 size={14} /> Delete</button>}>
      <input autoFocus className="mb-3 w-full bg-transparent text-[20px] font-semibold outline-none" defaultValue={e.title} onBlur={(x) => up({ title: x.target.value || "Untitled event" })} />
      <div className="space-y-2 text-[13px]">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!e.allDay} onChange={(x) => up({ allDay: x.target.checked ? 1 : 0 })} /> All day</label>
        {e.allDay ? (
          <div className="flex gap-2"><input type="date" className="input" value={toISODate(new Date(e.start))} onChange={(x) => { const s = parseISODate(x.target.value).getTime(); void up({ start: s, end: Math.max(s, e.end) }); }} />
            <input type="date" className="input" value={toISODate(new Date(e.end))} onChange={(x) => up({ end: Math.max(e.start, parseISODate(x.target.value).getTime()) })} /></div>
        ) : (
          <div className="flex gap-2"><input type="datetime-local" className="input" value={toLocalInput(e.start)} onChange={(x) => { const s = new Date(x.target.value).getTime(); void up({ start: s, end: s + (e.end - e.start) }); }} />
            <input type="datetime-local" className="input" value={toLocalInput(e.end)} onChange={(x) => up({ end: Math.max(e.start, new Date(x.target.value).getTime()) })} /></div>
        )}
        <div className="text-[12px] text-faint">Time zone: {e.timezone} (times shown in your current zone)</div>
        <div className="flex gap-2">
          <input className="input" defaultValue={e.calendar} placeholder="Calendar" onBlur={(x) => up({ calendar: x.target.value || "Personal" })} aria-label="Calendar name" />
          <div className="flex items-center gap-1">{COLORS.map((c) => <button key={c} aria-label={c} className={cx("size-5 rounded-full", `dot-${c}`, e.color === c && "ring-2 ring-offset-1 ring-fg")} onClick={() => up({ color: c })} />)}</div>
        </div>
        <div className="flex gap-2">
          <select className="input" value={e.recurrence?.freq ?? ""} onChange={(x) => up({ recurrence: x.target.value ? { freq: x.target.value as NonNullable<Recurrence>["freq"], interval: 1 } : null })}>
            <option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select>
          {e.recurrence && <input type="date" className="input" value={e.recurrence.until ?? ""} onChange={(x) => up({ recurrence: { ...e.recurrence!, until: x.target.value || undefined } })} title="Repeat until" />}
          <select className="input" value={e.reminderMin ?? ""} onChange={(x) => up({ reminderMin: x.target.value === "" ? null : Number(x.target.value) })}>
            <option value="">No reminder</option><option value="0">At start</option><option value="10">10 min before</option><option value="30">30 min before</option><option value="60">1 hour before</option><option value="1440">1 day before</option>
          </select>
        </div>
        <textarea className="textarea" rows={3} defaultValue={e.notes} placeholder="Notes" onBlur={(x) => up({ notes: x.target.value })} />
      </div>
    </Modal>
  );
}

export default function CalendarView() {
  const ws = useApp((s) => s.workspaceId)!;
  const weekStart = useSettings((s) => s.s.weekStartsOn);
  const [mode, setMode] = useState<Mode>("week");
  const [cursor, setCursor] = useState(today());
  const [open, setOpen] = useState<CalendarEvent | null>(null);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const [feedsOpen, setFeedsOpen] = useState(false);
  const hoursRef = useRef<HTMLDivElement>(null);
  // Open the time grid at 07:00 rather than midnight.
  useEffect(() => { if (hoursRef.current) hoursRef.current.scrollTop = 7 * 48; }, [mode]);
  const events = useLiveQuery(() => db().events.where("[workspaceId+deletedAt]").equals([ws, 0]).toArray(), [ws]);
  const tasks = useLiveQuery(() => db().tasks.where("[workspaceId+deletedAt]").equals([ws, 0]).filter((t) => !!t.dueDate).toArray(), [ws]);

  const range = useMemo(() => {
    const c = parseISODate(cursor);
    if (mode === "day") return { from: c, days: 1 };
    if (mode === "week") return { from: startOfWeek(c, weekStart), days: 7 };
    if (mode === "agenda") return { from: c, days: 30 };
    return { from: startOfWeek(new Date(c.getFullYear(), c.getMonth(), 1), weekStart), days: 42 };
  }, [cursor, mode, weekStart]);
  const fromMs = range.from.getTime(), toMs = fromMs + range.days * 864e5;
  const calendars = [...new Set((events ?? []).map((e) => e.calendar))];
  const occ: Occurrence[] = useMemo(() => (events ?? []).filter((e) => !hidden.has(e.calendar)).flatMap((e) => expandEvent(e, fromMs, toMs)).sort((a, b) => a.start - b.start), [events, fromMs, toMs, hidden]);
  const days = Array.from({ length: range.days }, (_, i) => addDays(toISODate(range.from), i));
  const onDay = (d: string) => occ.filter((o) => { const s = toISODate(new Date(o.start)), e = toISODate(new Date(o.end)); return s <= d && d <= e; });
  const tasksOn = (d: string) => (tasks ?? []).filter((t) => t.dueDate === d && !hidden.has("Tasks"));

  const step = (dir: 1 | -1) => {
    const c = parseISODate(cursor);
    if (mode === "month") setCursor(toISODate(new Date(c.getFullYear(), c.getMonth() + dir, 1)));
    else setCursor(addDays(cursor, dir * (mode === "day" ? 1 : mode === "week" ? 7 : 30)));
  };
  const create = async (start: number, allDay = false) => setOpen(await repo.createEvent(ws, { start, end: allDay ? start : start + 3600e3, allDay: allDay ? 1 : 0 }));
  const reschedule = async (id: string, newStart: number, keepTime: boolean) => {
    const ev = await db().events.get(id.split("@")[0]!);
    if (!ev) return;
    if (ev.feedId) return useApp.getState().toast("Events from a subscribed calendar can't be moved here; change them in their own calendar.", "info");
    let start = newStart;
    if (keepTime) { const o = new Date(ev.start); const d = new Date(newStart); d.setHours(o.getHours(), o.getMinutes()); start = d.getTime(); }
    await repo.updateEvent(ev.id, { start, end: start + (ev.end - ev.start) });
  };
  const title = mode === "day" ? parseISODate(cursor).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : parseISODate(mode === "month" ? cursor : toISODate(range.from)).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const Chip = ({ o }: { o: Occurrence }) => (
    <button draggable onDragStart={(e) => e.dataTransfer.setData("text/rea-event", o.key)} onClick={() => setOpen(o.event)}
      className={cx("mb-0.5 block w-full truncate rounded px-1 text-left text-[12px]", `c-${o.event.color}`)}>
      {!o.event.allDay && <span className="text-muted">{fmtTime(o.start)} </span>}{o.event.title}
    </button>
  );
  const TaskChip = ({ t }: { t: Task }) => <button onClick={() => setOpenTask(t)} className={cx("mb-0.5 flex w-full items-center gap-1 truncate rounded border border-dashed border-line-strong px-1 text-left text-[12px]", t.status === "done" && "line-through text-faint")}><CheckSquare size={11} />{t.title}</button>;

  return (
    <div className="flex h-full flex-col px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CalendarDays size={20} className="text-muted" />
        <h1 className="mr-3 text-[22px] font-bold tracking-tight">{title}</h1>
        <button className="icon-btn" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft size={16} /></button>
        <button className="btn-outline" onClick={() => setCursor(today())}>Today</button>
        <button className="icon-btn" aria-label="Next" onClick={() => step(1)}><ChevronRight size={16} /></button>
        <span className="flex-1" />
        <div className="flex gap-0.5 rounded-[10px] bg-sunken p-0.5 shadow-[var(--inset)]">{(["day", "week", "month", "agenda"] as Mode[]).map((m) => <button key={m} className={cx("btn h-6 capitalize", mode === m && "bg-active")} onClick={() => setMode(m)}>{m}</button>)}</div>
        <button className="btn" onClick={() => setFeedsOpen(true)}><Rss size={14} /> Subscribe</button>
        <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import .ics</button>
        <button className="btn" onClick={() => downloadBlob(new Blob([toICS(events ?? [])], { type: "text/calendar" }), "rea-calendar.ics")}><Download size={14} /> Export</button>
        <button className="btn-primary" onClick={() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); void create(d.getTime()); }}><Plus size={14} /> Event</button>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const parsed = parseICS(await f.text());
          for (const p of parsed) await repo.createEvent(ws, { ...eventFields(p), color: "purple" });
          useApp.getState().toast(`Imported ${parsed.length} events`, "success");
          e.target.value = "";
        }} />
      {feedsOpen && <FeedsDialog onClose={() => setFeedsOpen(false)} />}
        {[...calendars, "Tasks"].map((c) => (
          <label key={c} className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={!hidden.has(c)} onChange={() => { const h = new Set(hidden); if (h.has(c)) h.delete(c); else h.add(c); setHidden(h); }} />{c}</label>
        ))}
        <span className="text-faint">Google Calendar and Outlook sync are not set up: they need your explicit sign-in, and Mindstone works without them.</span>
      </div>

      {mode === "month" && (
        <div className="grid flex-1 grid-cols-7 grid-rows-[auto_repeat(6,1fr)] overflow-hidden rounded-[12px] shadow-[var(--inset)]">
          {days.slice(0, 7).map((d) => <div key={d} className="border-b border-r border-line px-2 py-1 text-[11.5px] text-faint">{parseISODate(d).toLocaleDateString(undefined, { weekday: "short" })}</div>)}
          {days.map((d) => (
            <div key={d} className={cx("min-h-0 overflow-hidden border-b border-r border-line p-1", parseISODate(d).getMonth() !== parseISODate(cursor).getMonth() && "bg-sunken/60")}
              onDoubleClick={() => create(parseISODate(d).getTime() + 9 * 3600e3)}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/rea-event"); if (id) void reschedule(id, parseISODate(d).getTime(), true); }}>
              <div className={cx("mb-0.5 inline-flex size-5 items-center justify-center rounded-full text-[11.5px]", d === today() ? "bg-accent text-on-accent" : "text-muted")}>{parseISODate(d).getDate()}</div>
              {onDay(d).slice(0, 4).map((o) => <Chip key={o.key + d} o={o} />)}
              {tasksOn(d).slice(0, 2).map((t) => <TaskChip key={t.id} t={t} />)}
              {onDay(d).length > 4 && <div className="text-[11px] text-faint">+{onDay(d).length - 4} more</div>}
            </div>
          ))}
        </div>
      )}

      {(mode === "week" || mode === "day") && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] shadow-[var(--inset)]">
          <div className="flex border-b border-line">
            <div className="w-14 shrink-0" />
            {days.map((d) => (
              <div key={d} className="flex-1 border-l border-line px-2 py-1">
                <div className={cx("text-[12px]", d === today() ? "font-semibold text-accent" : "text-muted")}>{parseISODate(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</div>
                {onDay(d).filter((o) => o.event.allDay).map((o) => <Chip key={o.key} o={o} />)}
                {tasksOn(d).map((t) => <TaskChip key={t.id} t={t} />)}
              </div>
            ))}
          </div>
          <div ref={hoursRef} className="relative min-h-0 flex-1 overflow-y-auto" tabIndex={0} role="region" aria-label="Hours">
            <div className="flex" style={{ height: 24 * 48 }}>
              <div className="w-14 shrink-0">{Array.from({ length: 24 }, (_, h) => <div key={h} className="h-12 pr-2 text-right text-[10.5px] text-faint">{h ? `${h}:00` : ""}</div>)}</div>
              {days.map((d) => (
                <div key={d} className="relative flex-1 border-l border-line">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="h-12 border-b border-line/60 hover:bg-hover/50" onDoubleClick={() => create(parseISODate(d).getTime() + h * 3600e3)}
                      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/rea-event"); if (id) void reschedule(id, parseISODate(d).getTime() + h * 3600e3, false); }} />
                  ))}
                  {onDay(d).filter((o) => !o.event.allDay).map((o) => {
                    const dayStart = parseISODate(d).getTime();
                    const s = Math.max(o.start, dayStart), e = Math.min(o.end, dayStart + 864e5);
                    return (
                      <button key={o.key} draggable onDragStart={(ev) => ev.dataTransfer.setData("text/rea-event", o.key)} onClick={() => setOpen(o.event)}
                        className={cx("absolute inset-x-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[12px]", `c-${o.event.color}`)}
                        style={{ top: ((s - dayStart) / 3600e3) * 48, height: Math.max(20, ((e - s) / 3600e3) * 48 - 2) }}>
                        <div className="font-medium">{o.event.title}</div><div className="text-[11px] text-muted">{fmtTime(o.start)}–{fmtTime(o.end)}</div>
                      </button>
                    );
                  })}
                  {d === today() && <div className="pointer-events-none absolute inset-x-0 h-0.5 bg-danger" style={{ top: ((Date.now() - parseISODate(d).getTime()) / 3600e3) * 48 }} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === "agenda" && (
        <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto">
          {days.filter((d) => onDay(d).length || tasksOn(d).length).map((d) => (
            <section key={d}>
              <h2 className="mb-1 text-[13px] font-semibold text-muted">{parseISODate(d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>
              {onDay(d).map((o) => <button key={o.key} onClick={() => setOpen(o.event)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover"><span className={cx("size-2 rounded-full", `dot-${o.event.color}`)} /><span className="w-28 text-[12.5px] text-muted">{o.event.allDay ? "All day" : `${fmtTime(o.start)}–${fmtTime(o.end)}`}</span><span>{o.event.title}</span></button>)}
              {tasksOn(d).map((t) => <button key={t.id} onClick={() => setOpenTask(t)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover"><CheckSquare size={13} className="text-muted" /><span className="w-28 text-[12.5px] text-muted">Task due</span><span>{t.title}</span></button>)}
            </section>
          ))}
          {!days.some((d) => onDay(d).length || tasksOn(d).length) && <div className="py-10 text-center text-muted">Nothing scheduled in the next 30 days.</div>}
        </div>
      )}
      {open && <EventModal ev={open} onClose={() => setOpen(null)} />}
      {openTask && <TaskDetail task={openTask} onClose={() => setOpenTask(null)} />}
    </div>
  );
}
