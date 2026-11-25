import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Network } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import { useApp } from "@/store/app";
import { cx } from "@/lib/util";

interface N { id: string; label: string; kind: "page" | "database" | "tag"; x: number; y: number; vx: number; vy: number; deg: number }
interface E { a: number; b: number; kind: "wiki" | "mention" | "embed" | "child" | "tag" }
const EDGE_COLOR: Record<E["kind"], string> = { wiki: "#4f5bd5", mention: "#4f5bd5", embed: "#2f8a57", child: "#9b9b97", tag: "#d9730d" };

/** Force-directed layout with grid-bucketed repulsion (≈O(n) per step), so thousands of nodes stay interactive. */
function step(nodes: N[], edges: E[], alpha: number) {
  const cell = 80;
  const grid = new Map<string, number[]>();
  nodes.forEach((n, i) => { const k = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  nodes.forEach((n, i) => {
    const gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        if (j <= i) continue;
        const m = nodes[j]!;
        let ddx = n.x - m.x, ddy = n.y - m.y;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 0.01) { ddx = Math.random() - 0.5; ddy = Math.random() - 0.5; d2 = 0.5; }
        const f = (900 / d2) * alpha;
        n.vx += ddx * f; n.vy += ddy * f; m.vx -= ddx * f; m.vy -= ddy * f;
      }
    }
    n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha; // gravity
  });
  for (const e of edges) {
    const a = nodes[e.a]!, b = nodes[e.b]!;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - 60) / d) * 0.06 * alpha;
    a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
  }
  for (const n of nodes) { n.vx *= 0.6; n.vy *= 0.6; n.x += Math.max(-30, Math.min(30, n.vx)); n.y += Math.max(-30, Math.min(30, n.vy)); }
  // Keep the layout centred on the origin (the viewport centre).
  if (nodes.length) {
    const cx = nodes.reduce((a, n) => a + n.x, 0) / nodes.length, cy = nodes.reduce((a, n) => a + n.y, 0) / nodes.length;
    for (const n of nodes) { n.x -= cx; n.y -= cy; }
  }
}

export default function Graph({ focusId }: { focusId?: string }) {
  const ws = useApp((s) => s.workspaceId)!;
  const open = useApp((s) => s.open);
  const [local, setLocal] = useState(!!focusId);
  const [depth, setDepth] = useState(1);
  const [showTags, setShowTags] = useState(false);
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [filter, setFilter] = useState("");
  const [hover, setHover] = useState<N | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const raw = useLiveQuery(async () => ({ pages: await repo.livePages(ws), links: await db().links.where("workspaceId").equals(ws).toArray() }), [ws]);

  const graph = useMemo(() => {
    if (!raw) return null;
    const ids = new Map<string, number>();
    const nodes: N[] = [];
    const add = (id: string, label: string, kind: N["kind"]) => {
      if (!ids.has(id)) { ids.set(id, nodes.length); nodes.push({ id, label, kind, x: (Math.random() - 0.5) * 600, y: (Math.random() - 0.5) * 600, vx: 0, vy: 0, deg: 0 }); }
      return ids.get(id)!;
    };
    for (const p of raw.pages) add(p.id, `${p.icon ? p.icon + " " : ""}${p.title || "Untitled"}`, p.kind);
    const edges: E[] = [];
    for (const l of raw.links) if (ids.has(l.fromPageId) && ids.has(l.toPageId)) edges.push({ a: ids.get(l.fromPageId)!, b: ids.get(l.toPageId)!, kind: l.kind });
    if (showHierarchy) for (const p of raw.pages) if (p.parentId && ids.has(p.parentId)) edges.push({ a: ids.get(p.parentId)!, b: ids.get(p.id)!, kind: "child" });
    if (showTags) for (const p of raw.pages) for (const t of p.tags) edges.push({ a: ids.get(p.id)!, b: add(`tag:${t}`, `#${t}`, "tag"), kind: "tag" });
    for (const e of edges) { nodes[e.a]!.deg++; nodes[e.b]!.deg++; }
    // Local graph: BFS from focus
    let keep = new Set(nodes.map((_, i) => i));
    if (local && focusId && ids.has(focusId)) {
      keep = new Set([ids.get(focusId)!]);
      for (let d = 0; d < depth; d++) for (const e of edges) { if (keep.has(e.a)) keep.add(e.b); else if (keep.has(e.b)) keep.add(e.a); }
    }
    if (orphansOnly) keep = new Set([...keep].filter((i) => nodes[i]!.deg === 0 || (nodes[i]!.kind !== "tag" && !edges.some((e) => e.kind !== "child" && (e.a === i || e.b === i)))));
    if (filter) keep = new Set([...keep].filter((i) => nodes[i]!.label.toLowerCase().includes(filter.toLowerCase())));
    const remap = new Map<number, number>();
    const fn: N[] = [];
    [...keep].forEach((i) => { remap.set(i, fn.length); fn.push(nodes[i]!); });
    const fe = edges.filter((e) => remap.has(e.a) && remap.has(e.b)).map((e) => ({ ...e, a: remap.get(e.a)!, b: remap.get(e.b)! }));
    const orphanCount = nodes.filter((n, i) => n.kind !== "tag" && !edges.some((e) => e.kind !== "child" && (e.a === i || e.b === i))).length;
    return { nodes: fn, edges: fe, orphanCount };
  }, [raw, local, focusId, depth, showTags, showHierarchy, orphansOnly, filter]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !graph) return;
    const ctx = c.getContext("2d")!;
    let alpha = 1, frame = 0, raf = 0;
    const dark = document.documentElement.classList.contains("dark");
    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const { width, height } = c.getBoundingClientRect();
      if (c.width !== width * dpr) { c.width = width * dpr; c.height = height * dpr; }
      if (alpha > 0.02) { step(graph.nodes, graph.edges, alpha); alpha *= 0.985; }
      const v = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2 + v.x, height / 2 + v.y);
      ctx.scale(v.k, v.k);
      ctx.lineWidth = 1 / v.k;
      for (const e of graph.edges) {
        const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
        ctx.strokeStyle = EDGE_COLOR[e.kind] + (e.kind === "child" ? "55" : "99");
        ctx.setLineDash(e.kind === "child" ? [3 / v.k, 3 / v.k] : []);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of graph.nodes) {
        const r = 3 + Math.min(9, Math.sqrt(n.deg) * 1.6);
        ctx.fillStyle = n.id === focusId ? getComputedStyle(document.documentElement).getPropertyValue("--accent") : n.kind === "tag" ? "#d9730d" : n.kind === "database" ? "#2f8a57" : n.deg === 0 ? "#c14c8a" : dark ? "#b8b8b4" : "#5a5a56";
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        if (v.k > 0.7 || n === hover || n.deg > 4) {
          ctx.fillStyle = dark ? "#e6e6e3" : "#1f1f1e";
          ctx.font = `${11 / Math.max(0.8, v.k)}px Segoe UI, system-ui`;
          ctx.fillText(n.label.slice(0, 40), n.x + r + 3, n.y + 4);
        }
      }
      frame++;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graph, hover, focusId]);

  const toWorld = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect(), v = view.current;
    return { x: (e.clientX - r.left - r.width / 2 - v.x) / v.k, y: (e.clientY - r.top - r.height / 2 - v.y) / v.k };
  };
  const hit = (e: React.MouseEvent) => {
    const p = toWorld(e);
    return graph?.nodes.find((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < (10 / view.current.k) ** 2 + 36) ?? null;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-2.5 text-[13px]">
        <Network size={18} className="text-muted" /><h1 className="font-semibold">Knowledge graph</h1>
        <span className="text-faint">{graph?.nodes.length ?? 0} nodes · {graph?.edges.length ?? 0} links · {graph?.orphanCount ?? 0} orphans</span>
        <span className="flex-1" />
        <input className="input h-7 w-44" placeholder="Filter nodes" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {focusId && <label className="flex items-center gap-1.5"><input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} /> Local</label>}
        {local && <select className="input h-7 w-24" value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Depth">{[1, 2, 3].map((d) => <option key={d} value={d}>Depth {d}</option>)}</select>}
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showHierarchy} onChange={(e) => setShowHierarchy(e.target.checked)} /> Hierarchy</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} /> Tags</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={orphansOnly} onChange={(e) => setOrphansOnly(e.target.checked)} /> Orphans only</label>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas ref={canvas} className={cx("h-full w-full", hover ? "cursor-pointer" : "cursor-grab")} aria-label="Knowledge graph canvas. Use the filter box to find pages."
          onWheel={(e) => { const v = view.current; v.k = Math.max(0.15, Math.min(4, v.k * (e.deltaY < 0 ? 1.1 : 0.9))); }}
          onMouseMove={(e) => { if (e.buttons === 1) { view.current.x += e.movementX; view.current.y += e.movementY; } else setHover(hit(e)); }}
          onClick={(e) => { const n = hit(e); if (!n) return; if (n.kind === "tag") open({ kind: "search", sub: n.label }); else open({ kind: "page", id: n.id }, { newTab: e.ctrlKey }); }} />
        <div className="pointer-events-none absolute bottom-3 left-4 flex gap-4 text-[11.5px] text-muted">
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-[#4f5bd5] align-middle" />link</span>
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-[#2f8a57] align-middle" />embed</span>
          <span><span className="mr-1 inline-block h-0.5 w-4 border-t border-dashed border-[#9b9b97] align-middle" />sub-page</span>
          <span><span className="mr-1 inline-block size-2 rounded-full bg-[#c14c8a] align-middle" />orphan</span>
          <span><span className="mr-1 inline-block size-2 rounded-full bg-[#2f8a57] align-middle" />database</span>
        </div>
        {hover && <div className="pointer-events-none absolute right-4 top-3 rounded-md bg-elev px-2 py-1 text-[12px] shadow">{hover.label} · {hover.deg} connections</div>}
      </div>
    </div>
  );
}
