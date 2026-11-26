import type { Database, DbRecord, FilterGroup, FilterRule, Property, SortRule } from "@/data/types";
import { runFormula, type FValue } from "./formula";

/** Context for computing derived values (relations, rollups) across databases. */
export interface QueryContext {
  databases: Map<string, Database>;
  records: Map<string, DbRecord[]>; // by databaseId
}

export function titleProp(db: Database): Property | undefined {
  return db.properties.find((p) => p.type === "title");
}

export function recordTitle(db: Database, r: DbRecord): string {
  const t = titleProp(db);
  return t ? String(r.values[t.id] ?? "") || "Untitled" : "Untitled";
}

/** Raw or computed value of a property for a record. */
export function cellValue(db: Database, r: DbRecord, p: Property, ctx?: QueryContext, depth = 0): FValue {
  switch (p.type) {
    case "createdTime": return r.createdAt;
    case "editedTime": return r.updatedAt;
    case "uniqueId": return `${p.prefix ?? ""}${r.seq}`;
    case "formula": {
      if (!p.formula || depth > 4) return null;
      const byName = new Map(db.properties.map((x) => [x.name.toLowerCase(), x]));
      const res = runFormula(p.formula, (name) => {
        const target = byName.get(name.toLowerCase());
        if (!target || target.id === p.id) return null;
        return cellValue(db, r, target, ctx, depth + 1);
      });
      return res.error ? `#ERR ${res.error}` : res.value;
    }
    case "rollup": {
      if (!p.rollup || !ctx) return null;
      const rel = db.properties.find((x) => x.id === p.rollup!.relationPropertyId);
      if (!rel?.relationDatabaseId) return null;
      const targetDb = ctx.databases.get(rel.relationDatabaseId);
      if (!targetDb) return null;
      const ids = new Set((r.values[rel.id] as string[] | undefined) ?? []);
      const linked = (ctx.records.get(targetDb.id) ?? []).filter((x) => ids.has(x.id) && !x.deletedAt);
      const tp = targetDb.properties.find((x) => x.id === p.rollup!.targetPropertyId);
      const vals = tp ? linked.map((x) => cellValue(targetDb, x, tp, ctx, depth + 1)) : [];
      const nums = vals.map(Number).filter((n) => !Number.isNaN(n));
      switch (p.rollup.fn) {
        case "count": return linked.length;
        case "sum": return nums.reduce((a, b) => a + b, 0);
        case "avg": return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        case "min": return nums.length ? Math.min(...nums) : null;
        case "max": return nums.length ? Math.max(...nums) : null;
        case "percentChecked": return linked.length ? Math.round((vals.filter((v) => v === true).length / linked.length) * 1000) / 10 : null;
        case "earliest": case "latest": {
          const dates = (tp ? linked.map((x) => x.values[tp.id]) : []).map((v) => (v && typeof v === "object" ? (v as { start?: string }).start : v)).filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)).map((v) => v.slice(0, 10)).sort();
          return dates.length ? (p.rollup.fn === "earliest" ? dates[0]! : dates[dates.length - 1]!) : null;
        }
        default: return vals;
      }
    }
    case "relation": {
      const ids = (r.values[p.id] as string[] | undefined) ?? [];
      if (!ctx || !p.relationDatabaseId) return ids;
      const tdb = ctx.databases.get(p.relationDatabaseId);
      const recs = ctx.records.get(p.relationDatabaseId) ?? [];
      return tdb ? ids.map((id) => { const x = recs.find((rr) => rr.id === id); return x ? recordTitle(tdb, x) : ""; }).filter(Boolean) : ids;
    }
    case "select":
    case "status": {
      const v = r.values[p.id];
      return p.options?.find((o) => o.id === v)?.name ?? null;
    }
    case "multiSelect": {
      const v = (r.values[p.id] as string[] | undefined) ?? [];
      return v.map((id) => p.options?.find((o) => o.id === id)?.name ?? "").filter(Boolean);
    }
    case "dateRange": {
      const v = r.values[p.id] as { start?: string; end?: string } | undefined;
      return v?.start ?? null;
    }
    case "files": return ((r.values[p.id] as unknown[]) ?? []).length;
    default: {
      const v = r.values[p.id];
      if (v === undefined) return null;
      return v as FValue;
    }
  }
}

function isEmpty(v: FValue): boolean {
  return v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function matchRule(db: Database, r: DbRecord, rule: FilterRule, ctx?: QueryContext): boolean {
  const p = db.properties.find((x) => x.id === rule.propertyId);
  if (!p) return true;
  const v = cellValue(db, r, p, ctx);
  const target = rule.value;
  const s = (x: unknown) => (Array.isArray(x) ? x.join(",") : String(x ?? "")).toLowerCase();
  const n = (x: unknown) => Number(x);
  // Select-like values are compared by option name, but filter values may be stored as option ids.
  const optName = (x: unknown) => p.options?.find((o) => o.id === x)?.name ?? x;
  switch (rule.op) {
    case "isEmpty": return isEmpty(v);
    case "isNotEmpty": return !isEmpty(v);
    case "checked": return v === true;
    case "unchecked": return v !== true;
    case "eq": return Array.isArray(v) ? v.map(s).includes(s(optName(target))) : s(v) === s(optName(target));
    case "neq": return Array.isArray(v) ? !v.map(s).includes(s(optName(target))) : s(v) !== s(optName(target));
    case "contains": return s(v).includes(s(optName(target)));
    case "notContains": return !s(v).includes(s(optName(target)));
    case "gt": return typeof v === "string" && Number.isNaN(n(v)) ? v > s(target) : n(v) > n(target);
    case "lt": return typeof v === "string" && Number.isNaN(n(v)) ? v < s(target) : n(v) < n(target);
    case "gte": return typeof v === "string" && Number.isNaN(n(v)) ? v >= s(target) : n(v) >= n(target);
    case "lte": return typeof v === "string" && Number.isNaN(n(v)) ? v <= s(target) : n(v) <= n(target);
  }
}

export function matchFilter(db: Database, r: DbRecord, g: FilterGroup, ctx?: QueryContext): boolean {
  if (g.children.length === 0) return true;
  const test = (c: FilterRule | FilterGroup) => (c.kind === "group" ? matchFilter(db, r, c, ctx) : matchRule(db, r, c, ctx));
  return g.mode === "and" ? g.children.every(test) : g.children.some(test);
}

export function compareValues(a: FValue, b: FValue): number {
  if (isEmpty(a) && isEmpty(b)) return 0;
  if (isEmpty(a)) return 1; // empties last
  if (isEmpty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function sortRecords(db: Database, recs: DbRecord[], sorts: SortRule[], ctx?: QueryContext): DbRecord[] {
  if (!sorts.length) return [...recs].sort((a, b) => a.sortKey - b.sortKey);
  const props = sorts.map((s) => ({ s, p: db.properties.find((x) => x.id === s.propertyId) })).filter((x) => x.p);
  return [...recs].sort((a, b) => {
    for (const { s, p } of props) {
      const c = compareValues(cellValue(db, a, p!, ctx), cellValue(db, b, p!, ctx));
      if (c !== 0) return s.dir === "asc" ? c : -c;
    }
    return a.sortKey - b.sortKey;
  });
}

export function searchRecords(db: Database, recs: DbRecord[], q: string, ctx?: QueryContext): DbRecord[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return recs;
  return recs.filter((r) => db.properties.some((p) => {
    const v = cellValue(db, r, p, ctx);
    return (Array.isArray(v) ? v.join(" ") : String(v ?? "")).toLowerCase().includes(needle);
  }));
}

export interface Group { key: string; label: string; color: string; records: DbRecord[] }

/** Group by a select/status/checkbox/multiSelect property. Includes empty option groups so boards show all columns. */
export function groupRecords(db: Database, recs: DbRecord[], propertyId: string | undefined): Group[] {
  const p = db.properties.find((x) => x.id === propertyId);
  if (!p) return [{ key: "all", label: "All", color: "gray", records: recs }];
  if (p.type === "checkbox") {
    return [
      { key: "true", label: "Checked", color: "green", records: recs.filter((r) => r.values[p.id] === true) },
      { key: "false", label: "Unchecked", color: "gray", records: recs.filter((r) => r.values[p.id] !== true) },
    ];
  }
  const groups: Group[] = (p.options ?? []).map((o) => ({ key: o.id, label: o.name, color: o.color, records: [] }));
  const none: Group = { key: "", label: `No ${p.name}`, color: "gray", records: [] };
  for (const r of recs) {
    const v = r.values[p.id];
    const keys = Array.isArray(v) ? (v as string[]) : v ? [String(v)] : [];
    const targets = keys.map((k) => groups.find((g) => g.key === k)).filter(Boolean) as Group[];
    if (targets.length === 0) none.records.push(r);
    for (const g of targets) g.records.push(r);
  }
  return [none, ...groups].filter((g) => g.key !== "" || g.records.length > 0);
}

export function queryView(db: Database, recs: DbRecord[], viewId: string, ctx?: QueryContext): DbRecord[] {
  const view = db.views.find((v) => v.id === viewId) ?? db.views[0];
  const live = recs.filter((r) => !r.deletedAt);
  if (!view) return live;
  const filtered = live.filter((r) => matchFilter(db, r, view.filter, ctx));
  return sortRecords(db, searchRecords(db, filtered, view.search ?? "", ctx), view.sorts, ctx);
}

/** Display string for any cell. */
export function displayValue(db: Database, r: DbRecord, p: Property, ctx?: QueryContext): string {
  const v = cellValue(db, r, p, ctx);
  if (v === null || v === undefined) return "";
  if (p.type === "createdTime" || p.type === "editedTime") return new Date(Number(v)).toLocaleString();
  if (p.type === "checkbox") return v ? "✓" : "";
  if (p.type === "currency") return new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency ?? "USD" }).format(Number(v));
  if (p.type === "percent") return `${Number(v)}%`;
  if (p.type === "rating") return "★".repeat(Number(v) || 0);
  if (p.type === "dateRange") {
    const d = r.values[p.id] as { start?: string; end?: string } | undefined;
    return d?.start ? `${d.start}${d.end ? ` → ${d.end}` : ""}` : "";
  }
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number" && !Number.isInteger(v)) return String(Math.round(v * 1000) / 1000);
  return String(v);
}

export interface ChartPoint { key: string; label: string; color: string; value: number }
/** Values for a chart view: one point per group, counting records or summing/averaging a number property. */
export function chartData(db: Database, recs: DbRecord[], view: { groupBy?: string; chart?: { metric: "count" | "sum" | "avg"; valueProperty?: string } }, ctx?: QueryContext): ChartPoint[] {
  const metric = view.chart?.metric ?? "count";
  const vp = db.properties.find((p) => p.id === view.chart?.valueProperty);
  return groupRecords(db, recs, view.groupBy).map((g) => {
    let value = g.records.length;
    if (metric !== "count") {
      const nums = vp ? g.records.map((r) => Number(cellValue(db, r, vp, ctx))).filter((n) => Number.isFinite(n)) : [];
      const sum = nums.reduce((a, b) => a + b, 0);
      value = metric === "sum" ? sum : nums.length ? sum / nums.length : 0;
    }
    return { key: g.key, label: g.label, color: g.color, value: Math.round(value * 100) / 100 };
  });
}
