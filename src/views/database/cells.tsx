import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Trash2, EyeOff, ArrowUp, ArrowDown, Plus } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { Database, DbRecord, Property, PropertyType, SelectOption } from "@/data/types";
import { cellValue, displayValue, recordTitle, type QueryContext } from "@/lib/dbquery";
import { FORMULA_FUNCTIONS, runFormula } from "@/lib/formula";
import { Chip, MenuItem, MenuSep, Popover, confirmDialog, useAnchor } from "@/components/ui";
import { cx, uid } from "@/lib/util";

export const PROPERTY_TYPES: { type: PropertyType; label: string }[] = [
  { type: "text", label: "Text" }, { type: "number", label: "Number" }, { type: "currency", label: "Currency" }, { type: "percent", label: "Percent" },
  { type: "select", label: "Select" }, { type: "multiSelect", label: "Multi-select" }, { type: "status", label: "Status" }, { type: "checkbox", label: "Checkbox" },
  { type: "date", label: "Date" }, { type: "dateRange", label: "Date range" }, { type: "email", label: "Email" }, { type: "phone", label: "Phone" },
  { type: "url", label: "URL" }, { type: "person", label: "Person" }, { type: "files", label: "Files" }, { type: "relation", label: "Relation" },
  { type: "rollup", label: "Rollup" }, { type: "formula", label: "Formula" }, { type: "rating", label: "Rating" }, { type: "progress", label: "Progress" },
  { type: "createdTime", label: "Created time" }, { type: "editedTime", label: "Last edited" }, { type: "uniqueId", label: "Unique ID" },
];
export const READONLY: PropertyType[] = ["formula", "rollup", "createdTime", "editedTime", "uniqueId"];

export function useQueryContext(database: Database | undefined): QueryContext | undefined {
  return useLiveQuery(async () => {
    if (!database) return undefined;
    const relIds = new Set(database.properties.filter((p) => p.type === "relation" && p.relationDatabaseId).map((p) => p.relationDatabaseId!));
    const dbs = await db().databases.bulkGet([...relIds]);
    const ctx: QueryContext = { databases: new Map(), records: new Map() };
    for (const d of dbs) if (d) { ctx.databases.set(d.id, d); ctx.records.set(d.id, await db().records.where("databaseId").equals(d.id).toArray()); }
    return ctx;
  }, [database?.properties]);
}

/** Read-only rendering of a cell. */
export function CellDisplay({ database, record, prop, ctx }: { database: Database; record: DbRecord; prop: Property; ctx?: QueryContext }) {
  const raw = record.values[prop.id];
  switch (prop.type) {
    case "checkbox": return <span className={cx("inline-flex size-4 items-center justify-center rounded border", raw ? "border-accent bg-accent text-white" : "border-line-strong")}>{raw ? <Check size={12} /> : null}</span>;
    case "select": case "status": {
      const o = prop.options?.find((x) => x.id === raw);
      return o ? <Chip color={o.color}>{o.name}</Chip> : null;
    }
    case "multiSelect": return <span className="flex flex-wrap gap-1">{((raw as string[]) ?? []).map((id) => prop.options?.find((o) => o.id === id)).filter(Boolean).map((o) => <Chip key={o!.id} color={o!.color}>{o!.name}</Chip>)}</span>;
    case "url": return typeof raw === "string" && /^https?:\/\//.test(raw) ? <a className="truncate text-accent underline" href={raw} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{raw}</a> : <span>{String(raw ?? "")}</span>;
    case "email": return raw ? <a className="text-accent underline" href={`mailto:${String(raw)}`} onClick={(e) => e.stopPropagation()}>{String(raw)}</a> : null;
    case "progress": { const v = Math.max(0, Math.min(100, Number(raw) || 0)); return <span className="flex w-full items-center gap-2"><span className="h-1.5 flex-1 rounded bg-active"><span className="block h-full rounded bg-accent" style={{ width: `${v}%` }} /></span><span className="text-[12px] text-muted">{v}%</span></span>; }
    case "relation": return <span className="flex flex-wrap gap-1">{(cellValue(database, record, prop, ctx) as string[]).map((t, i) => <Chip key={i}>↗ {t}</Chip>)}</span>;
    case "formula": { const v = displayValue(database, record, prop, ctx); return <span className={v.startsWith("#ERR") ? "text-danger" : ""}>{v}</span>; }
    default: return <span className="truncate">{displayValue(database, record, prop, ctx)}</span>;
  }
}

function OptionPicker({ prop, database, value, multi, onChange }: { prop: Property; database: Database; value: string[]; multi: boolean; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const opts = (prop.options ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const create = async () => {
    const o: SelectOption = { id: uid(), name: q.trim(), color: repo.OPTION_COLORS[(prop.options?.length ?? 0) % repo.OPTION_COLORS.length]! };
    await repo.updateDatabase(database.id, { properties: database.properties.map((p) => (p.id === prop.id ? { ...p, options: [...(p.options ?? []), o] } : p)) });
    onChange(multi ? [...value, o.id] : [o.id]);
    setQ("");
  };
  return (
    <div className="w-60">
      <input autoFocus className="input mb-1 h-7" placeholder="Search or create option" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim() && !opts.length) void create(); }} />
      <div className="max-h-56 overflow-y-auto">
        {opts.map((o) => (
          <button key={o.id} className="menu-item" onClick={() => onChange(multi ? (value.includes(o.id) ? value.filter((v) => v !== o.id) : [...value, o.id]) : value[0] === o.id ? [] : [o.id])}>
            <Chip color={o.color}>{o.name}</Chip><span className="flex-1" />{value.includes(o.id) && <Check size={14} />}
          </button>
        ))}
        {q.trim() && !prop.options?.some((o) => o.name.toLowerCase() === q.trim().toLowerCase()) && <button className="menu-item" onClick={create}><Plus size={14} /> Create “{q.trim()}”</button>}
      </div>
    </div>
  );
}

function RelationPicker({ prop, value, onChange }: { prop: Property; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const target = useLiveQuery(async () => {
    if (!prop.relationDatabaseId) return null;
    const d = await db().databases.get(prop.relationDatabaseId);
    if (!d) return null;
    return { d, recs: (await db().records.where("databaseId").equals(d.id).toArray()).filter((r) => !r.deletedAt) };
  }, [prop.relationDatabaseId]);
  if (!target) return <div className="w-56 p-2 text-[13px] text-muted">Choose a related database in the property menu first.</div>;
  const list = target.recs.filter((r) => recordTitle(target.d, r).toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <div className="w-64">
      <input autoFocus className="input mb-1 h-7" placeholder={`Search ${target.d.name}`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-56 overflow-y-auto">
        {list.map((r) => <button key={r.id} className="menu-item" onClick={() => onChange(value.includes(r.id) ? value.filter((x) => x !== r.id) : [...value, r.id])}><span className="flex-1 truncate">{recordTitle(target.d, r)}</span>{value.includes(r.id) && <Check size={14} />}</button>)}
      </div>
    </div>
  );
}

/** Inline editor for a cell. Commits on blur / Enter. */
export function CellEditor({ database, record, prop, onDone }: { database: Database; record: DbRecord; prop: Property; onDone: () => void }) {
  const raw = record.values[prop.id];
  const [v, setV] = useState<string>(raw === undefined || raw === null ? "" : String(raw));
  const commit = (value: unknown) => { void repo.updateRecord(record.id, prop.id, value); };
  const key = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLElement).blur(); } if (e.key === "Escape") onDone(); };
  switch (prop.type) {
    case "select": case "status": case "multiSelect": {
      const val = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
      return <OptionPicker prop={prop} database={database} value={val} multi={prop.type === "multiSelect"} onChange={(n) => { commit(prop.type === "multiSelect" ? n : n[0] ?? null); if (prop.type !== "multiSelect") onDone(); }} />;
    }
    case "relation": return <RelationPicker prop={prop} value={(raw as string[]) ?? []} onChange={(n) => commit(n)} />;
    case "checkbox": return null; // toggled directly by the caller
    case "date": return <input autoFocus type="date" className="input" defaultValue={String(raw ?? "")} onBlur={(e) => { commit(e.target.value || null); onDone(); }} onKeyDown={key} />;
    case "dateRange": {
      const d = (raw as { start?: string; end?: string }) ?? {};
      return (
        <div className="flex w-72 items-center gap-1 p-1">
          <input autoFocus type="date" className="input" defaultValue={d.start ?? ""} onChange={(e) => commit({ ...d, start: e.target.value })} />
          <span>→</span>
          <input type="date" className="input" defaultValue={d.end ?? ""} onChange={(e) => commit({ ...((record.values[prop.id] as object) ?? {}), end: e.target.value })} />
        </div>
      );
    }
    case "rating": return <div className="flex gap-0.5 p-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} className="text-[18px]" onClick={() => { commit(n === raw ? 0 : n); onDone(); }}>{n <= (Number(raw) || 0) ? "★" : "☆"}</button>)}</div>;
    case "number": case "currency": case "percent": case "progress":
      return <input autoFocus type="number" className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { commit(v === "" ? null : Number(v)); onDone(); }} onKeyDown={key} />;
    case "files": return <div className="w-56 p-2 text-[13px] text-muted">Attach files from the Files view; this cell counts linked files.</div>;
    default:
      return <textarea autoFocus rows={prop.type === "text" ? 3 : 1} className="textarea min-w-56" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (prop.type === "email" && v && !/^[^@\s]+@[^@\s]+$/.test(v)) return onDone();
          if (prop.type === "url" && v && !/^https?:\/\//i.test(v)) { commit(`https://${v}`); return onDone(); }
          commit(v); onDone();
        }} onKeyDown={key} />;
  }
}

/** Header menu for a property: rename, change type, configure, sort, hide, delete. */
export function PropertyMenu({ database, prop, anchor, onClose, onSort, onHide }: {
  database: Database; prop: Property; anchor: DOMRect | { x: number; y: number } | null; onClose: () => void; onSort: (dir: "asc" | "desc") => void; onHide: () => void;
}) {
  const allDbs = useLiveQuery(() => db().databases.where("workspaceId").equals(database.workspaceId).toArray(), [database.workspaceId]);
  const update = (patch: Partial<Property>) => repo.updateDatabase(database.id, { properties: database.properties.map((p) => (p.id === prop.id ? { ...p, ...patch } : p)) });
  const [formula, setFormula] = useState(prop.formula ?? "");
  const preview = formula ? runFormula(formula, () => null) : null;
  const relations = database.properties.filter((p) => p.type === "relation");
  const typeMenu = useAnchor();
  return (
    <Popover anchor={anchor} onClose={onClose} className="w-72">
      <div className="p-1"><input className="input h-7" defaultValue={prop.name} onBlur={(e) => e.target.value.trim() && update({ name: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></div>
      {prop.type !== "title" && <MenuItem onClick={typeMenu.openAt} shortcut={PROPERTY_TYPES.find((t) => t.type === prop.type)?.label}>Type</MenuItem>}
      <Popover anchor={typeMenu.anchor} onClose={typeMenu.close} className="max-h-80 w-48 overflow-y-auto">
        {PROPERTY_TYPES.map((t) => <MenuItem key={t.type} onClick={() => { const np = repo.newProperty(prop.name, t.type); void update({ type: t.type, options: prop.options ?? np.options }); typeMenu.close(); }}>{t.label}</MenuItem>)}
      </Popover>
      {prop.type === "formula" && (
        <div className="p-1">
          <div className="label mb-1">Formula</div>
          <textarea className="textarea font-mono text-[12px]" rows={3} value={formula} onChange={(e) => setFormula(e.target.value)} placeholder='prop("Price") * prop("Qty")' />
          {preview?.error && <div className="mt-1 text-[12px] text-danger">{preview.error}</div>}
          <div className="mt-1 text-[11px] text-faint">Functions: {FORMULA_FUNCTIONS.join(", ")}</div>
          <button className="btn-primary mt-1.5" onClick={() => update({ formula })}>Save formula</button>
        </div>
      )}
      {prop.type === "relation" && (
        <div className="p-1">
          <div className="label mb-1">Related database</div>
          <select className="input" value={prop.relationDatabaseId ?? ""} onChange={(e) => update({ relationDatabaseId: e.target.value || undefined })}>
            <option value="">Choose…</option>
            {allDbs?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}
      {prop.type === "rollup" && (
        <div className="space-y-1 p-1">
          <select className="input" value={prop.rollup?.relationPropertyId ?? ""} onChange={(e) => update({ rollup: { relationPropertyId: e.target.value, targetPropertyId: prop.rollup?.targetPropertyId ?? "", fn: prop.rollup?.fn ?? "count" } })}>
            <option value="">Relation property…</option>{relations.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {(() => {
            const rel = relations.find((r) => r.id === prop.rollup?.relationPropertyId);
            const target = allDbs?.find((d) => d.id === rel?.relationDatabaseId);
            return target && (
              <>
                <select className="input" value={prop.rollup?.targetPropertyId ?? ""} onChange={(e) => update({ rollup: { ...prop.rollup!, targetPropertyId: e.target.value } })}>
                  <option value="">Property…</option>{target.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="input" value={prop.rollup?.fn ?? "count"} onChange={(e) => update({ rollup: { ...prop.rollup!, fn: e.target.value as "count" } })}>
                  {["count", "sum", "avg", "min", "max", "showOriginal"].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </>
            );
          })()}
        </div>
      )}
      {prop.type === "currency" && <div className="p-1"><input className="input h-7" defaultValue={prop.currency ?? "USD"} onBlur={(e) => update({ currency: e.target.value.toUpperCase().slice(0, 3) })} aria-label="Currency code" /></div>}
      {prop.type === "uniqueId" && <div className="p-1"><input className="input h-7" placeholder="Prefix, e.g. TASK-" defaultValue={prop.prefix ?? ""} onBlur={(e) => update({ prefix: e.target.value })} /></div>}
      {(prop.type === "select" || prop.type === "multiSelect" || prop.type === "status") && (
        <div className="max-h-44 overflow-y-auto p-1">
          <div className="label mb-1">Options</div>
          {prop.options?.map((o) => (
            <div key={o.id} className="flex items-center gap-1 py-0.5">
              <button className={cx("size-4 shrink-0 rounded", `dot-${o.color}`)} title="Change colour" onClick={() => update({ options: prop.options!.map((x) => x.id === o.id ? { ...x, color: repo.OPTION_COLORS[(repo.OPTION_COLORS.indexOf(x.color as never) + 1) % repo.OPTION_COLORS.length]! } : x) })} />
              <input className="input h-6" defaultValue={o.name} onBlur={(e) => update({ options: prop.options!.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)) })} />
              <button className="icon-btn size-6" aria-label="Delete option" onClick={() => update({ options: prop.options!.filter((x) => x.id !== o.id) })}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <MenuSep />
      <MenuItem icon={<ArrowUp />} onClick={() => { onSort("asc"); onClose(); }}>Sort ascending</MenuItem>
      <MenuItem icon={<ArrowDown />} onClick={() => { onSort("desc"); onClose(); }}>Sort descending</MenuItem>
      {prop.type !== "title" && <MenuItem icon={<EyeOff />} onClick={() => { onHide(); onClose(); }}>Hide in view</MenuItem>}
      {prop.type !== "title" && <MenuItem icon={<Trash2 />} danger onClick={async () => {
        onClose();
        if (await confirmDialog(`Delete property “${prop.name}”?`, "Its values are removed from every record. This cannot be undone.", { danger: true })) {
          await repo.updateDatabase(database.id, { properties: database.properties.filter((p) => p.id !== prop.id), views: database.views.map((v) => ({ ...v, sorts: v.sorts.filter((s) => s.propertyId !== prop.id) })) });
        }
      }}>Delete property</MenuItem>}
    </Popover>
  );
}
