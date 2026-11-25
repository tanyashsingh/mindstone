import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Table2, Columns3, List as ListIcon, LayoutGrid, CalendarDays, GanttChart, BarChart3, Plus, Filter, ArrowUpDown, Search, Eye, Download, Upload, Trash2, X, MoreHorizontal, Copy, ChevronDown,
} from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { Database, DatabaseView as View, DbRecord, FilterGroup, FilterOp, FilterRule, Property, ViewType } from "@/data/types";
import { groupRecords, queryView, recordTitle, type QueryContext } from "@/lib/dbquery";
import { CellDisplay, CellEditor, PropertyMenu, PROPERTY_TYPES, READONLY, useQueryContext } from "./cells";
import { Chip, EmptyState, MenuItem, MenuSep, Modal, Popover, Skeleton, useAnchor, confirmDialog, promptDialog } from "@/components/ui";
import { databaseToCSV, databaseToJSON, importCSV } from "@/data/portability";
import { useApp } from "@/store/app";
import { cx, downloadBlob, parseISODate, safeFileName, startOfWeek, toISODate, addDays, fmtDate } from "@/lib/util";

const VIEW_ICONS: Record<ViewType, React.ReactNode> = {
  table: <Table2 size={14} />, board: <Columns3 size={14} />, list: <ListIcon size={14} />, gallery: <LayoutGrid size={14} />,
  calendar: <CalendarDays size={14} />, timeline: <GanttChart size={14} />, chart: <BarChart3 size={14} />,
};

const OPS: { op: FilterOp; label: string; noValue?: boolean }[] = [
  { op: "contains", label: "contains" }, { op: "notContains", label: "does not contain" }, { op: "eq", label: "is" }, { op: "neq", label: "is not" },
  { op: "gt", label: ">" }, { op: "lt", label: "<" }, { op: "gte", label: "≥" }, { op: "lte", label: "≤" },
  { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true },
  { op: "checked", label: "is checked", noValue: true }, { op: "unchecked", label: "is unchecked", noValue: true },
];

function FilterGroupEditor({ database, group, onChange, depth = 0 }: { database: Database; group: FilterGroup; onChange: (g: FilterGroup) => void; depth?: number }) {
  const set = (i: number, c: FilterRule | FilterGroup) => onChange({ ...group, children: group.children.map((x, j) => (j === i ? c : x)) });
  const remove = (i: number) => onChange({ ...group, children: group.children.filter((_, j) => j !== i) });
  return (
    <div className={cx("space-y-1.5", depth > 0 && "rounded-md border border-line bg-sunken p-2")}>
      {group.children.map((c, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="w-12 pt-1.5 text-right text-[12px] text-faint">{i === 0 ? "Where" : (
            <button className="underline" onClick={() => onChange({ ...group, mode: group.mode === "and" ? "or" : "and" })}>{group.mode}</button>
          )}</span>
          {c.kind === "group" ? (
            <div className="flex-1"><FilterGroupEditor database={database} group={c} depth={depth + 1} onChange={(g) => set(i, g)} /></div>
          ) : (
            <div className="flex flex-1 items-center gap-1">
              <select className="input h-7 w-36" value={c.propertyId} onChange={(e) => set(i, { ...c, propertyId: e.target.value })}>
                {database.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="input h-7 w-36" value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as FilterOp })}>
                {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>
              {!OPS.find((o) => o.op === c.op)?.noValue && (() => {
                const p = database.properties.find((x) => x.id === c.propertyId);
                return p?.options ? (
                  <select className="input h-7 flex-1" value={String(c.value ?? "")} onChange={(e) => set(i, { ...c, value: e.target.value })}>
                    <option value="" />{p.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                ) : <input className="input h-7 flex-1" type={p?.type === "date" ? "date" : "text"} value={String(c.value ?? "")} onChange={(e) => set(i, { ...c, value: e.target.value })} />;
              })()}
            </div>
          )}
          <button className="icon-btn" aria-label="Remove filter" onClick={() => remove(i)}><X size={13} /></button>
        </div>
      ))}
      <div className="flex gap-1 pl-14">
        <button className="btn h-6 text-muted" onClick={() => onChange({ ...group, children: [...group.children, { kind: "rule", propertyId: database.properties[0]!.id, op: "contains", value: "" }] })}><Plus size={12} /> Add filter</button>
        {depth < 2 && <button className="btn h-6 text-muted" onClick={() => onChange({ ...group, children: [...group.children, { kind: "group", mode: group.mode === "and" ? "or" : "and", children: [] }] })}><Plus size={12} /> Add group</button>}
      </div>
    </div>
  );
}

function countRules(g: FilterGroup): number { return g.children.reduce((n, c) => n + (c.kind === "group" ? countRules(c) : 1), 0); }

export function RecordModal({ database, record, ctx, onClose }: { database: Database; record: DbRecord; ctx?: QueryContext; onClose: () => void }) {
  const live = useLiveQuery(() => db().records.get(record.id), [record.id]) ?? record;
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={recordTitle(database, live)} width={620}
      footer={<>
        <button className="btn-danger mr-auto" onClick={async () => { await repo.deleteRecords([record.id]); onClose(); }}><Trash2 size={14} /> Delete record</button>
        <button className="btn-outline" onClick={async () => {
          const name = await promptDialog("Template name", recordTitle(database, live), "New records created from this template start with these property values.");
          if (!name) return;
          await repo.saveRecordTemplate(database.id, name, live.values);
          useApp.getState().toast(`Saved template “${name}”`, "success");
        }}><Copy size={14} /> Save as template</button>
      </>}>
      <div className="space-y-1">
        {database.properties.map((p) => (
          <div key={p.id} className="flex min-h-8 items-start gap-3">
            <div className="w-36 shrink-0 pt-1.5 text-[13px] text-muted">{p.name}</div>
            <div className="min-w-0 flex-1">
              {editing === p.id ? <CellEditor database={database} record={live} prop={p} onDone={() => setEditing(null)} /> : (
                <button className="flex min-h-8 w-full items-center rounded px-1.5 text-left hover:bg-hover disabled:hover:bg-transparent" disabled={READONLY.includes(p.type)}
                  onClick={() => (p.type === "checkbox" ? void repo.updateRecord(live.id, p.id, !live.values[p.id]) : setEditing(p.id))}>
                  <CellDisplay database={database} record={live} prop={p} ctx={ctx} />
                  {live.values[p.id] === undefined && !READONLY.includes(p.type) && p.type !== "checkbox" && <span className="text-faint">Empty</span>}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const ROW_H = 34;

function TableView({ database, view, records, ctx, onOpen, updateView }: { database: Database; view: View; records: DbRecord[]; ctx?: QueryContext; onOpen: (r: DbRecord) => void; updateView: (p: Partial<View>) => void }) {
  const [editing, setEditing] = useState<{ r: string; p: string; rect: DOMRect } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ prop: Property; rect: DOMRect } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const dragCol = useRef<string | null>(null);
  const addProp = useAnchor();
  const bulk = useAnchor();
  const ordered = useMemo(() => {
    const byId = new Map(database.properties.map((p) => [p.id, p]));
    const seq = [...view.order.filter((id) => byId.has(id)), ...database.properties.map((p) => p.id).filter((id) => !view.order.includes(id))];
    return seq.map((id) => byId.get(id)!).filter((p) => !view.hidden.includes(p.id));
  }, [database.properties, view.order, view.hidden]);
  const width = (p: Property) => p.width ?? (p.type === "title" ? 260 : 170);
  const total = ordered.reduce((a, p) => a + width(p), 40);
  const editRec = records.find((r) => r.id === editing?.r);
  const editProp = database.properties.find((p) => p.id === editing?.p);
  const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const visible = records.slice(visibleStart, visibleStart + 60);

  const setWidth = (id: string, w: number) => repo.updateDatabase(database.id, { properties: database.properties.map((p) => (p.id === id ? { ...p, width: Math.max(80, w) } : p)) });

  return (
    <div>
      {selected.size > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-accent-soft px-2 py-1 text-[13px]">
          <span>{selected.size} selected</span>
          <button className="btn h-6" onClick={bulk.openAt}>Set property…</button>
          <button className="btn h-6" onClick={async () => { for (const id of selected) { const r = records.find((x) => x.id === id); if (r) await repo.addRecord(database.id, structuredClone(r.values)); } setSelected(new Set()); }}><Copy size={13} /> Duplicate</button>
          <button className="btn-danger h-6" onClick={async () => { if (await confirmDialog(`Delete ${selected.size} records?`, "This cannot be undone.", { danger: true })) { await repo.deleteRecords([...selected]); setSelected(new Set()); } }}><Trash2 size={13} /> Delete</button>
          <button className="btn h-6" onClick={() => setSelected(new Set())}>Clear</button>
          <Popover anchor={bulk.anchor} onClose={bulk.close} className="w-56">
            {database.properties.filter((p) => p.type === "select" || p.type === "status" || p.type === "checkbox").map((p) => (
              p.type === "checkbox"
                ? <MenuItem key={p.id} onClick={() => { void repo.bulkUpdateRecords([...selected], p.id, true); bulk.close(); }}>Check “{p.name}”</MenuItem>
                : p.options!.map((o) => <MenuItem key={o.id} onClick={() => { void repo.bulkUpdateRecords([...selected], p.id, o.id); bulk.close(); }}>{p.name}: {o.name}</MenuItem>)
            ))}
          </Popover>
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto rounded-md border border-line" onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)} role="grid" aria-rowcount={records.length}>
        <div style={{ width: total + 120 }}>
          <div className="sticky top-0 z-[1] flex border-b border-line bg-sunken text-[12.5px] text-muted" role="row">
            <div className="flex w-10 shrink-0 items-center justify-center"><input type="checkbox" aria-label="Select all" checked={selected.size > 0 && selected.size === records.length} onChange={(e) => setSelected(e.target.checked ? new Set(records.map((r) => r.id)) : new Set())} /></div>
            {ordered.map((p) => (
              <div key={p.id} role="columnheader" draggable onDragStart={() => (dragCol.current = p.id)} onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const from = dragCol.current;
                  if (!from || from === p.id) return;
                  const ids = ordered.map((x) => x.id).filter((x) => x !== from);
                  ids.splice(ids.indexOf(p.id), 0, from);
                  updateView({ order: ids });
                }}
                className="relative flex h-8 shrink-0 items-center gap-1 border-r border-line px-2 hover:bg-hover" style={{ width: width(p) }}>
                <button className="flex-1 truncate text-left" onClick={(e) => setMenu({ prop: p, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}>{p.name}</button>
                <span className="absolute -right-1 top-0 z-[2] h-full w-2 cursor-col-resize" onMouseDown={(e) => {
                  e.preventDefault();
                  const sx = e.clientX, sw = width(p);
                  const el = e.currentTarget.parentElement!;
                  const move = (ev: MouseEvent) => { el.style.width = `${Math.max(80, sw + ev.clientX - sx)}px`; };
                  const up = (ev: MouseEvent) => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); void setWidth(p.id, sw + ev.clientX - sx); };
                  addEventListener("mousemove", move); addEventListener("mouseup", up);
                }} />
              </div>
            ))}
            <button className="flex h-8 w-24 items-center gap-1 px-2 hover:bg-hover" onClick={addProp.openAt}><Plus size={13} /> Add</button>
          </div>
          <div style={{ height: records.length * ROW_H, position: "relative" }}>
            {visible.map((r, i) => (
              <div key={r.id} role="row" className={cx("group absolute left-0 flex w-full border-b border-line text-[13.5px] hover:bg-hover/50", selected.has(r.id) && "bg-accent-soft")} style={{ top: (visibleStart + i) * ROW_H, height: ROW_H }}>
                <div className="flex w-10 shrink-0 items-center justify-center">
                  <input type="checkbox" aria-label="Select row" className="opacity-0 group-hover:opacity-100 checked:opacity-100" checked={selected.has(r.id)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSelected(s); }} />
                </div>
                {ordered.map((p) => (
                  <div key={p.id} role="gridcell" tabIndex={0} className={cx("flex shrink-0 items-center overflow-hidden border-r border-line px-2", p.type === "title" && "font-medium")} style={{ width: width(p) }}
                    onClick={(e) => {
                      if (READONLY.includes(p.type)) return;
                      if (p.type === "checkbox") return void repo.updateRecord(r.id, p.id, !r.values[p.id]);
                      setEditing({ r: r.id, p: p.id, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLElement).click()}>
                    <CellDisplay database={database} record={r} prop={p} ctx={ctx} />
                    {p.type === "title" && <button className="btn ml-auto h-6 px-1.5 text-[11px] opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); onOpen(r); }}>Open</button>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button className="flex h-8 w-full items-center gap-1.5 px-3 text-[13px] text-faint hover:bg-hover" onClick={() => repo.addRecord(database.id)}><Plus size={14} /> New record</button>
        </div>
      </div>
      <div className="mt-1 px-1 text-[12px] text-faint">{records.length.toLocaleString()} records</div>
      {editing && editRec && editProp && (
        <Popover anchor={editing.rect} onClose={() => setEditing(null)} className="p-1">
          <CellEditor database={database} record={editRec} prop={editProp} onDone={() => setEditing(null)} />
        </Popover>
      )}
      {menu && <PropertyMenu database={database} prop={menu.prop} anchor={menu.rect} onClose={() => setMenu(null)} onSort={(dir) => updateView({ sorts: [{ propertyId: menu.prop.id, dir }] })} onHide={() => updateView({ hidden: [...view.hidden, menu.prop.id] })} />}
      <Popover anchor={addProp.anchor} onClose={addProp.close} className="max-h-80 w-52 overflow-y-auto">
        {PROPERTY_TYPES.map((t) => <MenuItem key={t.type} onClick={async () => { addProp.close(); await repo.updateDatabase(database.id, { properties: [...database.properties, repo.newProperty(t.label, t.type)] }); }}>{t.label}</MenuItem>)}
      </Popover>
    </div>
  );
}

function BoardView({ database, view, records, ctx, onOpen }: { database: Database; view: View; records: DbRecord[]; ctx?: QueryContext; onOpen: (r: DbRecord) => void }) {
  const groupProp = database.properties.find((p) => p.id === view.groupBy);
  if (!groupProp) return <EmptyState title="Choose a property to group by" body="Boards group records by a Select, Status or Checkbox property. Use “Group” in the toolbar." />;
  const groups = groupRecords(database, records, groupProp.id);
  const title = database.properties.find((p) => p.type === "title")!;
  const shown = database.properties.filter((p) => !view.hidden.includes(p.id) && p.id !== title.id && p.id !== groupProp.id).slice(0, 3);
  const move = (id: string, key: string) => {
    const value = groupProp.type === "checkbox" ? key === "true" : groupProp.type === "multiSelect" ? (key ? [key] : []) : key || null;
    void repo.updateRecord(id, groupProp.id, value);
  };
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {groups.map((g) => (
        <div key={g.key} className="w-72 shrink-0 rounded-lg bg-sunken p-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/rea-record"); if (id) move(id, g.key); }}>
          <div className="mb-2 flex items-center gap-2 px-1"><Chip color={g.color}>{g.label}</Chip><span className="text-[12px] text-faint">{g.records.length}</span></div>
          <div className="space-y-1.5">
            {g.records.map((r) => (
              <button key={r.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/rea-record", r.id)} onClick={() => onOpen(r)}
                className="panel block w-full p-2.5 text-left shadow-sm hover:border-line-strong">
                <div className="mb-1 text-[13.5px] font-medium">{recordTitle(database, r)}</div>
                {shown.map((p) => <div key={p.id} className="text-[12px] text-muted"><CellDisplay database={database} record={r} prop={p} ctx={ctx} /></div>)}
              </button>
            ))}
          </div>
          <button className="mt-1.5 flex h-7 w-full items-center gap-1 rounded px-1.5 text-[13px] text-faint hover:bg-hover" onClick={() => repo.addRecord(database.id, g.key ? { [groupProp.id]: groupProp.type === "multiSelect" ? [g.key] : groupProp.type === "checkbox" ? g.key === "true" : g.key } : {})}><Plus size={13} /> New</button>
        </div>
      ))}
    </div>
  );
}

function ListView({ database, view, records, ctx, onOpen }: { database: Database; view: View; records: DbRecord[]; ctx?: QueryContext; onOpen: (r: DbRecord) => void }) {
  const title = database.properties.find((p) => p.type === "title")!;
  const shown = database.properties.filter((p) => !view.hidden.includes(p.id) && p.id !== title.id).slice(0, 4);
  return (
    <div className="divide-y divide-line rounded-md border border-line">
      {records.map((r) => (
        <button key={r.id} onClick={() => onOpen(r)} className="flex w-full items-center gap-4 px-3 py-2 text-left hover:bg-hover">
          <span className="flex-1 truncate font-medium">{recordTitle(database, r)}</span>
          {shown.map((p) => <span key={p.id} className="max-w-40 truncate text-[12.5px] text-muted"><CellDisplay database={database} record={r} prop={p} ctx={ctx} /></span>)}
        </button>
      ))}
      {records.length === 0 && <EmptyState title="No records match" />}
    </div>
  );
}

function GalleryView({ database, view, records, ctx, onOpen }: { database: Database; view: View; records: DbRecord[]; ctx?: QueryContext; onOpen: (r: DbRecord) => void }) {
  const title = database.properties.find((p) => p.type === "title")!;
  const shown = database.properties.filter((p) => !view.hidden.includes(p.id) && p.id !== title.id).slice(0, 4);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {records.map((r) => (
        <button key={r.id} onClick={() => onOpen(r)} className="panel overflow-hidden text-left hover:border-line-strong">
          <div className="h-20 bg-sunken" />
          <div className="p-3">
            <div className="mb-1 font-medium">{recordTitle(database, r)}</div>
            {shown.map((p) => <div key={p.id} className="truncate text-[12px] text-muted"><CellDisplay database={database} record={r} prop={p} ctx={ctx} /></div>)}
          </div>
        </button>
      ))}
    </div>
  );
}

function recordDate(r: DbRecord, p?: Property): { start?: string; end?: string } {
  if (!p) return {};
  const v = r.values[p.id];
  if (p.type === "dateRange") return (v as { start?: string; end?: string }) ?? {};
  if (p.type === "createdTime" || p.type === "editedTime") return { start: toISODate(new Date(p.type === "createdTime" ? r.createdAt : r.updatedAt)) };
  return typeof v === "string" ? { start: v.slice(0, 10) } : {};
}

function CalendarDbView({ database, view, records, onOpen }: { database: Database; view: View; records: DbRecord[]; onOpen: (r: DbRecord) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const dp = database.properties.find((p) => p.id === view.dateProperty) ?? database.properties.find((p) => p.type === "date" || p.type === "dateRange");
  if (!dp) return <EmptyState title="Add a Date property to use the calendar" />;
  const start = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(toISODate(start), i));
  const byDay = new Map<string, DbRecord[]>();
  for (const r of records) { const s = recordDate(r, dp).start; if (s) { if (!byDay.has(s)) byDay.set(s, []); byDay.get(s)!.push(r); } }
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button className="btn-outline" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
        <button className="btn-outline" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
        <button className="btn-outline" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        <span className="font-medium">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <span className="text-[12px] text-faint">by {dp.name}</span>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-md border border-line">
        {days.map((d) => (
          <div key={d} className={cx("min-h-24 border-b border-r border-line p-1", parseISODate(d).getMonth() !== month.getMonth() && "bg-sunken/60")}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/rea-record"); if (id) void repo.updateRecord(id, dp.id, dp.type === "dateRange" ? { start: d } : d); }}>
            <div className="mb-0.5 flex justify-between text-[11px] text-faint"><span>{parseISODate(d).getDate()}</span>
              <button className="opacity-0 hover:opacity-100" aria-label="Add record on this day" onClick={() => repo.addRecord(database.id, { [dp.id]: dp.type === "dateRange" ? { start: d } : d })}><Plus size={11} /></button></div>
            {byDay.get(d)?.map((r) => <button key={r.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/rea-record", r.id)} onClick={() => onOpen(r)} className="mb-0.5 block w-full truncate rounded bg-accent-soft px-1 text-left text-[12px]">{recordTitle(database, r)}</button>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineView({ database, view, records, onOpen }: { database: Database; view: View; records: DbRecord[]; onOpen: (r: DbRecord) => void }) {
  const dp = database.properties.find((p) => p.id === view.dateProperty) ?? database.properties.find((p) => p.type === "dateRange" || p.type === "date");
  if (!dp) return <EmptyState title="Add a Date or Date range property to use the timeline" />;
  const items = records.map((r) => ({ r, ...recordDate(r, dp) })).filter((x) => x.start);
  if (!items.length) return <EmptyState title="No dated records" />;
  const min = items.reduce((a, x) => (x.start! < a ? x.start! : a), items[0]!.start!);
  const first = startOfWeek(parseISODate(min));
  const dayW = 28, days = 84;
  const off = (s: string) => Math.round((parseISODate(s).getTime() - first.getTime()) / 864e5);
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <div style={{ width: days * dayW + 200 }}>
        <div className="flex border-b border-line text-[11px] text-faint">
          <div className="w-[200px] shrink-0" />
          {Array.from({ length: days / 7 }, (_, w) => <div key={w} style={{ width: dayW * 7 }} className="border-l border-line px-1 py-1">{fmtDate(addDays(toISODate(first), w * 7))}</div>)}
        </div>
        {items.map(({ r, start, end }) => {
          const s = off(start!), e = Math.max(s, end ? off(end) : s);
          return (
            <div key={r.id} className="flex h-8 items-center border-b border-line">
              <button className="w-[200px] shrink-0 truncate px-2 text-left text-[13px]" onClick={() => onOpen(r)}>{recordTitle(database, r)}</button>
              <div className="relative h-full flex-1">
                <button onClick={() => onOpen(r)} className="absolute top-1.5 h-5 rounded bg-accent/80 px-1.5 text-left text-[11px] text-white" style={{ left: s * dayW, width: (e - s + 1) * dayW }} title={`${start} → ${end ?? start}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartView({ database, view, records }: { database: Database; view: View; records: DbRecord[] }) {
  const p = database.properties.find((x) => x.id === view.groupBy) ?? database.properties.find((x) => x.type === "select" || x.type === "status");
  if (!p) return <EmptyState title="Charts count records by a Select or Status property" body="Pick one with “Group” in the toolbar." />;
  const groups = groupRecords(database, records, p.id);
  const max = Math.max(1, ...groups.map((g) => g.records.length));
  return (
    <figure className="panel p-4" aria-label={`Records by ${p.name}`}>
      <figcaption className="mb-3 text-[13px] text-muted">Records by {p.name}</figcaption>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.key} className="flex items-center gap-3 text-[13px]">
            <span className="w-32 truncate text-right text-muted">{g.label}</span>
            <div className="h-5 flex-1"><div className={cx("h-full rounded-sm", `dot-${g.color}`)} style={{ width: `${(g.records.length / max) * 100}%`, minWidth: g.records.length ? 2 : 0 }} /></div>
            <span className="w-10 tabular-nums">{g.records.length}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function DatabaseView({ databaseId }: { databaseId: string }) {
  const database = useLiveQuery(() => db().databases.get(databaseId), [databaseId]);
  const records = useLiveQuery(() => db().records.where("databaseId").equals(databaseId).toArray(), [databaseId]);
  const ctx = useQueryContext(database);
  const [viewId, setViewId] = useState<string | null>(null);
  const [open, setOpen] = useState<DbRecord | null>(null);
  const tplMenu = useAnchor(), filterMenu = useAnchor(), sortMenu = useAnchor(), propsMenu = useAnchor(), groupMenu = useAnchor(), moreMenu = useAnchor(), addView = useAnchor();
  const fileInput = useRef<HTMLInputElement>(null);

  const view = database?.views.find((v) => v.id === viewId) ?? database?.views[0];
  const rows = useMemo(() => (database && records && view ? queryView(database, records, view.id, ctx) : []), [database, records, view, ctx]);
  if (!database || !records) return <Skeleton lines={6} />;
  if (!view) return null;

  const updateView = (patch: Partial<View>) => repo.updateDatabase(database.id, { views: database.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) });
  const groupable = database.properties.filter((p) => ["select", "status", "checkbox", "multiSelect"].includes(p.type));

  return (
    <div className="pb-16">
      <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-line pb-1.5">
        {database.views.map((v) => (
          <button key={v.id} className={cx("btn h-7", v.id === view.id && "bg-active")} onClick={() => setViewId(v.id)}
            onDoubleClick={async () => { const n = await promptDialog("Rename view", v.name); if (n) await repo.updateDatabase(database.id, { views: database.views.map((x) => (x.id === v.id ? { ...x, name: n } : x)) }); }}>
            {VIEW_ICONS[v.type]} {v.name}
          </button>
        ))}
        <button className="icon-btn" aria-label="Add view" onClick={addView.openAt}><Plus size={15} /></button>
        <Popover anchor={addView.anchor} onClose={addView.close} className="w-44">
          {(Object.keys(VIEW_ICONS) as ViewType[]).map((t) => (
            <MenuItem key={t} icon={VIEW_ICONS[t]} onClick={async () => {
              addView.close();
              const nv = repo.newView(t, t[0]!.toUpperCase() + t.slice(1), { groupBy: groupable[0]?.id, dateProperty: database.properties.find((p) => p.type === "date" || p.type === "dateRange")?.id });
              await repo.updateDatabase(database.id, { views: [...database.views, nv] });
              setViewId(nv.id);
            }}>{t[0]!.toUpperCase() + t.slice(1)}</MenuItem>
          ))}
        </Popover>
        <span className="flex-1" />
        <label className="flex h-7 items-center gap-1 rounded-md px-2 text-muted focus-within:bg-hover"><Search size={14} /><input className="w-32 bg-transparent text-[13px] outline-none" placeholder="Search" value={view.search ?? ""} onChange={(e) => updateView({ search: e.target.value })} /></label>
        <button className={cx("btn h-7", countRules(view.filter) > 0 && "text-accent")} onClick={filterMenu.openAt}><Filter size={14} /> Filter{countRules(view.filter) ? ` (${countRules(view.filter)})` : ""}</button>
        <button className={cx("btn h-7", view.sorts.length > 0 && "text-accent")} onClick={sortMenu.openAt}><ArrowUpDown size={14} /> Sort</button>
        {(view.type === "board" || view.type === "chart") && <button className="btn h-7" onClick={groupMenu.openAt}>Group</button>}
        <button className="btn h-7" onClick={propsMenu.openAt}><Eye size={14} /> Properties</button>
        <button className="icon-btn" aria-label="More database actions" onClick={moreMenu.openAt}><MoreHorizontal size={15} /></button>
        <span className="flex">
          <button className="btn-primary h-7 rounded-r-none" onClick={async () => { const r = await repo.addRecord(database.id); setOpen(r); }}><Plus size={14} /> New</button>
          <button className="btn-primary h-7 rounded-l-none border-l border-white/25 px-1.5" aria-label="New from template" onClick={tplMenu.openAt}><ChevronDown size={14} /></button>
        </span>
      </div>

      <Popover anchor={tplMenu.anchor} onClose={tplMenu.close} className="w-64" align="end">
        <MenuItem icon={<Plus />} onClick={async () => { tplMenu.close(); setOpen(await repo.addRecord(database.id)); }}>Blank record</MenuItem>
        {(database.templates ?? []).length > 0 && <MenuSep />}
        {(database.templates ?? []).map((t) => (
          <div key={t.id} className="group flex items-center">
            <MenuItem icon={<Copy />} onClick={async () => { tplMenu.close(); setOpen(await repo.addRecordFromTemplate(database.id, t.id)); }}>{t.name}</MenuItem>
            <button className="icon-btn size-6 shrink-0 opacity-0 group-hover:opacity-100" aria-label={`Delete template ${t.name}`} onClick={() => repo.deleteRecordTemplate(database.id, t.id)}><X size={12} /></button>
          </div>
        ))}
        {(database.templates ?? []).length === 0 && <div className="px-2 py-1.5 text-[12px] text-faint">Open a record and choose “Save as template” to add one here.</div>}
      </Popover>
      <Popover anchor={filterMenu.anchor} onClose={filterMenu.close} className="w-[560px] p-2">
        <FilterGroupEditor database={database} group={view.filter} onChange={(filter) => updateView({ filter })} />
      </Popover>
      <Popover anchor={sortMenu.anchor} onClose={sortMenu.close} className="w-80 p-2">
        {view.sorts.map((s, i) => (
          <div key={i} className="mb-1 flex gap-1">
            <select className="input h-7" value={s.propertyId} onChange={(e) => updateView({ sorts: view.sorts.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)) })}>{database.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className="input h-7 w-28" value={s.dir} onChange={(e) => updateView({ sorts: view.sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" } : x)) })}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
            <button className="icon-btn" onClick={() => updateView({ sorts: view.sorts.filter((_, j) => j !== i) })}><X size={13} /></button>
          </div>
        ))}
        <button className="btn h-7 text-muted" onClick={() => updateView({ sorts: [...view.sorts, { propertyId: database.properties[0]!.id, dir: "asc" }] })}><Plus size={13} /> Add sort</button>
      </Popover>
      <Popover anchor={groupMenu.anchor} onClose={groupMenu.close} className="w-52">
        {groupable.length === 0 && <div className="p-2 text-[13px] text-muted">Add a Select, Status or Checkbox property first.</div>}
        {groupable.map((p) => <MenuItem key={p.id} onClick={() => { void updateView({ groupBy: p.id }); groupMenu.close(); }} shortcut={view.groupBy === p.id ? "✓" : undefined}>{p.name}</MenuItem>)}
      </Popover>
      <Popover anchor={propsMenu.anchor} onClose={propsMenu.close} className="w-56">
        {database.properties.map((p) => (
          <label key={p.id} className="menu-item"><input type="checkbox" disabled={p.type === "title"} checked={!view.hidden.includes(p.id)} onChange={(e) => updateView({ hidden: e.target.checked ? view.hidden.filter((h) => h !== p.id) : [...view.hidden, p.id] })} />{p.name}</label>
        ))}
        {view.type === "calendar" || view.type === "timeline" ? (
          <>
            <MenuSep /><div className="label px-2 py-1">Date property</div>
            {database.properties.filter((p) => ["date", "dateRange", "createdTime", "editedTime"].includes(p.type)).map((p) => <MenuItem key={p.id} onClick={() => updateView({ dateProperty: p.id })} shortcut={view.dateProperty === p.id ? "✓" : undefined}>{p.name}</MenuItem>)}
          </>
        ) : null}
      </Popover>
      <Popover anchor={moreMenu.anchor} onClose={moreMenu.close} className="w-56" align="end">
        <MenuItem icon={<Download />} onClick={async () => { moreMenu.close(); downloadBlob(new Blob([await databaseToCSV(database)], { type: "text/csv" }), `${safeFileName(database.name)}.csv`); }}>Export CSV</MenuItem>
        <MenuItem icon={<Download />} onClick={async () => { moreMenu.close(); downloadBlob(new Blob([await databaseToJSON(database)], { type: "application/json" }), `${safeFileName(database.name)}.json`); }}>Export JSON</MenuItem>
        <MenuItem icon={<Upload />} onClick={() => { moreMenu.close(); fileInput.current?.click(); }}>Import CSV as new database</MenuItem>
        <MenuSep />
        <MenuItem icon={<Trash2 />} danger disabled={database.views.length < 2} onClick={async () => { moreMenu.close(); await repo.updateDatabase(database.id, { views: database.views.filter((v) => v.id !== view.id) }); setViewId(null); }}>Delete this view</MenuItem>
      </Popover>
      <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const page = await db().pages.get(database.pageId);
        await importCSV(database.workspaceId, page?.parentId ?? null, f.name.replace(/\.csv$/i, ""), await f.text());
        e.target.value = "";
      }} />

      {view.type === "table" && <TableView database={database} view={view} records={rows} ctx={ctx} onOpen={setOpen} updateView={updateView} />}
      {view.type === "board" && <BoardView database={database} view={view} records={rows} ctx={ctx} onOpen={setOpen} />}
      {view.type === "list" && <ListView database={database} view={view} records={rows} ctx={ctx} onOpen={setOpen} />}
      {view.type === "gallery" && <GalleryView database={database} view={view} records={rows} ctx={ctx} onOpen={setOpen} />}
      {view.type === "calendar" && <CalendarDbView database={database} view={view} records={rows} onOpen={setOpen} />}
      {view.type === "timeline" && <TimelineView database={database} view={view} records={rows} onOpen={setOpen} />}
      {view.type === "chart" && <ChartView database={database} view={view} records={rows} />}
      {open && <RecordModal database={database} record={open} ctx={ctx} onClose={() => setOpen(null)} />}
    </div>
  );
}
