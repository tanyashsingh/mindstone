/** Chart and timeline views for databases. */
import { useEffect, useRef, useState } from "react";
import type { ChartKind, Database, DatabaseView as View, DbRecord, Property } from "@/data/types";
import * as repo from "@/data/repo";
import { chartData, recordTitle, type QueryContext } from "@/lib/dbquery";
import { EmptyState } from "@/components/ui";
import { addDays, cx, fmtDate, parseISODate, toISODate } from "@/lib/util";

export const OPTION_HEX: Record<string, string> = {
  gray: "#8a8a85", brown: "#8c5a3c", orange: "#d9730d", yellow: "#cba00a", green: "#2f8a57", blue: "#337ecc", purple: "#9065b0", pink: "#c14c8a", red: "#d1453b",
};
const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// ---- Chart ---------------------------------------------------------------------------
export function ChartView({ database, view, records, ctx, updateView }: { database: Database; view: View; records: DbRecord[]; ctx?: QueryContext; updateView: (p: Partial<View>) => void }) {
  const group = database.properties.find((x) => x.id === view.groupBy);
  const groupable = database.properties.filter((p) => ["select", "status", "checkbox", "multiSelect"].includes(p.type));
  const numeric = database.properties.filter((p) => ["number", "currency", "percent", "progress", "rating", "formula", "rollup"].includes(p.type));
  const chart = { kind: "bar" as ChartKind, metric: "count" as const, ...view.chart };
  const setChart = (p: Partial<NonNullable<View["chart"]>>) => updateView({ chart: { ...chart, ...p } });
  const vp = numeric.find((p) => p.id === chart.valueProperty);
  const points = group ? chartData(database, records, { groupBy: group.id, chart }, ctx) : [];
  const metricLabel = chart.metric === "count" || !vp ? "Records" : `${chart.metric === "sum" ? "Sum" : "Average"} of ${vp.name}`;
  const title = group ? `${metricLabel} by ${group.name}` : "";

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <label className="flex items-center gap-1">Group by
          <select className="input h-7 w-36" aria-label="Chart group" value={view.groupBy ?? ""} onChange={(e) => updateView({ groupBy: e.target.value || undefined })}>
            <option value="">Choose…</option>{groupable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label className="flex items-center gap-1">Chart
          <select className="input h-7 w-32" aria-label="Chart type" value={chart.kind} onChange={(e) => setChart({ kind: e.target.value as ChartKind })}>
            <option value="bar">Bars</option><option value="hbar">Horizontal bars</option><option value="line">Line</option><option value="pie">Pie</option><option value="donut">Donut</option>
          </select></label>
        <label className="flex items-center gap-1">Show
          <select className="input h-7 w-28" aria-label="Chart value" value={chart.metric} onChange={(e) => setChart({ metric: e.target.value as "count", valueProperty: chart.valueProperty ?? numeric[0]?.id })}>
            <option value="count">Count</option><option value="sum" disabled={!numeric.length}>Sum</option><option value="avg" disabled={!numeric.length}>Average</option>
          </select></label>
        {chart.metric !== "count" && (
          <select className="input h-7 w-36" aria-label="Chart property" value={chart.valueProperty ?? ""} onChange={(e) => setChart({ valueProperty: e.target.value })}>
            {numeric.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      {!group ? <EmptyState title="Charts group records by a Select, Status or Checkbox property" body={groupable.length ? "Choose one in “Group by”." : "Add one of those properties first."} />
        : !records.length ? <EmptyState title="No records to chart" />
          : <figure aria-label={title} data-testid="chart" data-kind={chart.kind}>
            <figcaption className="mb-2 text-[13px] text-muted">{title}</figcaption>
            <Chart kind={chart.kind} points={points} />
            <table className="sr-only"><caption>{title}</caption><tbody>{points.map((p) => <tr key={p.key}><th>{p.label}</th><td>{p.value}</td></tr>)}</tbody></table>
          </figure>}
    </div>
  );
}

function Chart({ kind, points }: { kind: ChartKind; points: { key: string; label: string; color: string; value: number }[] }) {
  const max = Math.max(1e-9, ...points.map((p) => p.value));
  const total = points.reduce((a, p) => a + Math.max(0, p.value), 0);
  if (kind === "hbar") {
    return (
      <div className="space-y-2">
        {points.map((g) => (
          <div key={g.key} className="flex items-center gap-3 text-[13px]" data-testid="chart-mark" data-label={g.label} data-value={g.value}>
            <span className="w-32 truncate text-right text-muted">{g.label}</span>
            <div className="h-5 flex-1"><div className="h-full rounded-sm" style={{ background: OPTION_HEX[g.color] ?? OPTION_HEX.gray, width: `${(Math.max(0, g.value) / max) * 100}%`, minWidth: g.value ? 2 : 0 }} /></div>
            <span className="w-14 tabular-nums">{fmtNum(g.value)}</span>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "pie" || kind === "donut") {
    const R = 80, r = kind === "donut" ? 46 : 0;
    let a0 = -Math.PI / 2;
    const arcs = points.filter((p) => p.value > 0).map((p) => {
      const a1 = a0 + (p.value / (total || 1)) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const pt = (rad: number, a: number) => `${100 + rad * Math.cos(a)} ${100 + rad * Math.sin(a)}`;
      const full = points.filter((x) => x.value > 0).length === 1;
      const d = full
        ? `M ${pt(R, 0)} A ${R} ${R} 0 1 1 ${pt(R, Math.PI)} A ${R} ${R} 0 1 1 ${pt(R, 0)} Z${r ? ` M ${pt(r, 0)} A ${r} ${r} 0 1 0 ${pt(r, Math.PI)} A ${r} ${r} 0 1 0 ${pt(r, 0)} Z` : ""}`
        : r ? `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z` : `M 100 100 L ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} Z`;
      a0 = a1;
      return { p, d };
    });
    return (
      <div className="flex flex-wrap items-center gap-6">
        <svg viewBox="0 0 200 200" width={220} height={220} role="img" aria-hidden>
          {arcs.map(({ p, d }) => <path key={p.key} d={d} fill={OPTION_HEX[p.color] ?? OPTION_HEX.gray} fillRule="evenodd" stroke="var(--surface, #fff)" strokeWidth={1.5} data-testid="chart-mark" data-label={p.label} data-value={p.value}><title>{`${p.label}: ${fmtNum(p.value)}`}</title></path>)}
          {kind === "donut" && <text x="100" y="106" textAnchor="middle" className="fill-current text-[18px] font-semibold">{fmtNum(total)}</text>}
        </svg>
        <ul className="space-y-1 text-[13px]">
          {points.map((p) => <li key={p.key} className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: OPTION_HEX[p.color] ?? OPTION_HEX.gray }} />{p.label}<span className="tabular-nums text-muted">{fmtNum(p.value)}{total ? ` · ${Math.round((p.value / total) * 100)}%` : ""}</span></li>)}
        </ul>
      </div>
    );
  }
  // Vertical bars and line share axes.
  const W = Math.max(320, points.length * 72), H = 220, pad = { l: 40, b: 46, t: 12, r: 12 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const step = iw / Math.max(1, points.length);
  const y = (v: number) => pad.t + ih - (Math.max(0, v) / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-hidden className="text-muted">
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.15} /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-current text-[10px]">{fmtNum(t)}</text></g>)}
        {kind === "bar" && points.map((p, i) => (
          <rect key={p.key} x={pad.l + i * step + step * 0.18} width={step * 0.64} y={y(p.value)} height={pad.t + ih - y(p.value)} rx={2} fill={OPTION_HEX[p.color] ?? OPTION_HEX.gray} data-testid="chart-mark" data-label={p.label} data-value={p.value}><title>{`${p.label}: ${fmtNum(p.value)}`}</title></rect>
        ))}
        {kind === "line" && <>
          <polyline fill="none" stroke="var(--accent, #1f2a44)" strokeWidth={2} points={points.map((p, i) => `${pad.l + i * step + step / 2},${y(p.value)}`).join(" ")} />
          {points.map((p, i) => <circle key={p.key} cx={pad.l + i * step + step / 2} cy={y(p.value)} r={4} fill="var(--accent, #1f2a44)" data-testid="chart-mark" data-label={p.label} data-value={p.value}><title>{`${p.label}: ${fmtNum(p.value)}`}</title></circle>)}
        </>}
        {points.map((p, i) => <text key={p.key} x={pad.l + i * step + step / 2} y={H - pad.b + 16} textAnchor="middle" className="fill-current text-[11px]">{p.label.length > 12 ? `${p.label.slice(0, 11)}…` : p.label}</text>)}
        {points.map((p, i) => kind === "bar" && <text key={`v${p.key}`} x={pad.l + i * step + step / 2} y={y(p.value) - 4} textAnchor="middle" className="fill-current text-[10px]">{fmtNum(p.value)}</text>)}
      </svg>
    </div>
  );
}

// ---- Timeline ------------------------------------------------------------------------
const ZOOM = { day: 40, week: 18, month: 6 } as const;

function recordSpan(r: DbRecord, p: Property): { start?: string; end?: string } {
  const v = r.values[p.id];
  if (p.type === "dateRange") return (v as { start?: string; end?: string }) ?? {};
  if (p.type === "createdTime" || p.type === "editedTime") return { start: toISODate(new Date(p.type === "createdTime" ? r.createdAt : r.updatedAt)) };
  return typeof v === "string" ? { start: v.slice(0, 10) } : {};
}
const dayDiff = (a: string, b: string) => Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 864e5);

export function TimelineView({ database, view, records, onOpen, updateView }: { database: Database; view: View; records: DbRecord[]; onOpen: (r: DbRecord) => void; updateView: (p: Partial<View>) => void }) {
  const dp = database.properties.find((p) => p.id === view.dateProperty) ?? database.properties.find((p) => p.type === "dateRange" || p.type === "date");
  const zoom = view.timelineZoom ?? "day";
  const dayW = ZOOM[zoom];
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "start" | "end"; x0: number; delta: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const scroller = useRef<HTMLDivElement>(null);
  const editable = !!dp && (dp.type === "date" || dp.type === "dateRange");

  const items = dp ? records.map((r) => ({ r, ...recordSpan(r, dp) })).filter((x) => x.start) : [];
  const today = toISODate(new Date());
  const starts = items.map((x) => x.start!).concat(today).sort();
  const ends = items.map((x) => x.end ?? x.start!).concat(today).sort();
  const first = addDays(starts[0]!, -7);
  const days = Math.max(zoom === "month" ? 180 : zoom === "week" ? 120 : 60, dayDiff(first, ends[ends.length - 1]!) + 21);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, delta: Math.round((e.clientX - d.x0) / dayW) } : d));
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || !dp || d.delta === 0) return;
      const it = items.find((x) => x.r.id === d.id);
      if (!it) return;
      if (dp.type === "date") return void repo.updateRecord(d.id, dp.id, addDays(it.start!, d.delta));
      let s = it.start!, en = it.end ?? it.start!;
      if (d.mode !== "end") s = addDays(s, d.delta);
      if (d.mode !== "start") en = addDays(en, d.delta);
      if (en < s) [s, en] = d.mode === "start" ? [en, en] : [s, s];
      void repo.updateRecord(d.id, dp.id, { start: s, end: en });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up, { once: true });
    return () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
  }, [drag?.id, drag?.mode, dayW]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // start scrolled near today
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, dayDiff(first, today) * dayW - 240);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dp) return <EmptyState title="Add a Date or Date range property to use the timeline" />;
  if (!items.length) return <EmptyState title="No dated records" body={`Give records a ${dp.name} to place them on the timeline.`} />;

  // Header ticks: days, weeks or months
  const ticks: { at: number; label: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = parseISODate(addDays(first, i));
    if (zoom === "day") ticks.push({ at: i, label: String(d.getDate()) });
    else if (zoom === "week" && d.getDay() === 1) ticks.push({ at: i, label: fmtDate(toISODate(d)) });
    else if (zoom === "month" && d.getDate() === 1) ticks.push({ at: i, label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }) });
  }
  const todayAt = dayDiff(first, today);

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-[12.5px]">
        <span className="text-faint">Zoom</span>
        {(["day", "week", "month"] as const).map((z) => <button key={z} className={cx("btn h-7", zoom === z && "bg-active")} aria-pressed={zoom === z} onClick={() => updateView({ timelineZoom: z })}>{z[0]!.toUpperCase() + z.slice(1)}</button>)}
        <span className="ml-2 text-faint">by {dp.name}{editable ? " · drag bars to move; drag their ends to change dates" : ""}</span>
      </div>
      <div ref={scroller} className="overflow-x-auto rounded-md border border-line" data-testid="timeline">
        <div className="relative" style={{ width: days * dayW + 200 }}>
          <div className="flex h-7 border-b border-line text-[11px] text-faint">
            <div className="sticky left-0 z-10 w-[200px] shrink-0 bg-surface" />
            <div className="relative flex-1">{ticks.map((t) => <span key={t.at} className="absolute top-1.5 border-l border-line pl-1" style={{ left: t.at * dayW }}>{t.label}</span>)}</div>
          </div>
          <div className="pointer-events-none absolute bottom-0 top-7 z-[1] w-0.5 bg-danger/70" style={{ left: 200 + todayAt * dayW + dayW / 2 }} title="Today" data-testid="today-line" />
          {items.map(({ r, start, end }) => {
            const d = drag?.id === r.id ? drag : null;
            let s = dayDiff(first, start!), e = Math.max(s, dayDiff(first, end ?? start!));
            if (d) { if (d.mode !== "end") s += d.delta; if (d.mode !== "start") e += d.delta; if (e < s) e = s; }
            const title = recordTitle(database, r);
            return (
              <div key={r.id} className="flex h-9 items-center border-b border-line">
                <button className="sticky left-0 z-10 w-[200px] shrink-0 truncate bg-surface px-2 text-left text-[13px]" onClick={() => onOpen(r)}>{title}</button>
                <div className="relative h-full flex-1">
                  <div role="button" tabIndex={0} aria-label={`${title}: ${start}${end && end !== start ? ` to ${end}` : ""}`} data-testid="timeline-bar"
                    className={cx("group absolute top-2 h-5 select-none rounded bg-accent/80 text-[11px] text-on-accent", editable ? "cursor-grab" : "cursor-pointer", d && "cursor-grabbing ring-2 ring-accent")}
                    style={{ left: s * dayW, width: (e - s + 1) * dayW }}
                    onDoubleClick={() => onOpen(r)}
                    onKeyDown={(ev) => { if (ev.key === "Enter") onOpen(r); }}
                    onPointerDown={(ev) => { if (!editable || ev.button !== 0) return; ev.preventDefault(); setDrag({ id: r.id, mode: "move", x0: ev.clientX, delta: 0 }); }}>
                    <span className="block truncate px-1.5 leading-5">{title}</span>
                    {dp.type === "dateRange" && <>
                      <span aria-label="Change start" data-testid="bar-start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l bg-black/20 opacity-0 group-hover:opacity-100"
                        onPointerDown={(ev) => { ev.stopPropagation(); ev.preventDefault(); setDrag({ id: r.id, mode: "start", x0: ev.clientX, delta: 0 }); }} />
                      <span aria-label="Change end" data-testid="bar-end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-black/20 opacity-0 group-hover:opacity-100"
                        onPointerDown={(ev) => { ev.stopPropagation(); ev.preventDefault(); setDrag({ id: r.id, mode: "end", x0: ev.clientX, delta: 0 }); }} />
                    </>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
