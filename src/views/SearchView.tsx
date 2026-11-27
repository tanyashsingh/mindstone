import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, Bookmark, Trash2 } from "lucide-react";
import { db } from "@/data/db";
import { searchIndex, type SearchHit, type SearchKind } from "@/data/search";
import { ensureSearchIndex } from "@/bootstrap";
import { useApp } from "@/store/app";
import { EmptyState } from "@/components/ui";
import { cx, uid } from "@/lib/util";
import { openHit } from "@/components/CommandPalette";

const KINDS: SearchKind[] = ["page", "database", "record", "task", "project", "event", "attachment", "tag"];

export function Highlight({ text, q }: { text: string; q: string }) {
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (re.test(part) && i % 2 === 1 ? <mark key={i} className="rounded bg-warning/30 text-fg">{part}</mark> : part))}</>;
}

export default function SearchView({ initial = "" }: { initial?: string }) {
  const ws = useApp((s) => s.workspaceId)!;
  const [q, setQ] = useState(initial);
  const [kinds, setKinds] = useState<SearchKind[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [semantic, setSemantic] = useState<{ pageId: string; title: string; text: string }[] | null>(null);
  const saved = useLiveQuery(() => db().savedSearches.where("workspaceId").equals(ws).toArray(), [ws]);
  useEffect(() => { setQ(initial); }, [initial]);
  useEffect(() => {
    let alive = true;
    void ensureSearchIndex(ws).then(() => { if (alive) setHits(searchIndex.search(q, { kinds, limit: 100 })); });
    setSemantic(null);
    return () => { alive = false; };
  }, [q, kinds, ws]);
  return (
    <div className="mx-auto max-w-3xl px-10 py-10">
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-elev px-3">
        <Search size={18} className="text-faint" />
        <input autoFocus className="h-11 flex-1 bg-transparent text-[16px] outline-none" placeholder="Search everything" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {q && <button className="btn" onClick={() => db().savedSearches.add({ id: uid(), workspaceId: ws, name: q, query: q, createdAt: Date.now() })}><Bookmark size={14} /> Save</button>}
      </div>
      <div className="mb-4 flex flex-wrap gap-1">
        {KINDS.map((k) => <button key={k} className={cx("btn h-6 capitalize", kinds.includes(k) && "bg-active text-fg")} onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])}>{k}s</button>)}
        <span className="flex-1" />
        {q && <button className="btn h-6 text-accent" onClick={async () => { const { retrieve } = await import("@/ai/rag"); setSemantic(await retrieve(ws, q, 8)); }}>Semantic search</button>}
      </div>
      {saved && saved.length > 0 && !q && (
        <div className="mb-6"><div className="label mb-1">Saved searches</div>
          {saved.map((s) => <div key={s.id} className="group flex items-center"><button className="menu-item" onClick={() => setQ(s.query)}><Bookmark size={13} /> {s.name}</button><button className="icon-btn opacity-0 group-hover:opacity-100" onClick={() => db().savedSearches.delete(s.id)} aria-label="Delete saved search"><Trash2 size={13} /></button></div>)}
        </div>
      )}
      {semantic && (
        <div className="mb-6"><div className="label mb-1">Closest passages (keyword + embeddings when indexed)</div>
          {semantic.map((s, i) => <button key={i} className="block w-full rounded-md px-2 py-2 text-left hover:bg-hover" onClick={() => useApp.getState().open({ kind: "page", id: s.pageId })}><div className="font-medium">{s.title}</div><div className="line-clamp-2 text-meta text-muted">{s.text}</div></button>)}
        </div>
      )}
      {q && hits.length === 0 && <EmptyState title="No results" body="Search is fuzzy and matches word prefixes. Try fewer words." />}
      <div className="space-y-0.5">
        {hits.map((h) => (
          <button key={h.id} className="block w-full rounded-md px-2 py-2 text-left hover:bg-hover" onClick={() => openHit(h)}>
            <div className="flex items-center gap-2"><span className="chip c-gray capitalize">{h.kind}</span><span className="font-medium"><Highlight text={h.title} q={q} /></span></div>
            {h.snippet && <div className="mt-0.5 line-clamp-2 text-meta text-muted"><Highlight text={h.snippet} q={q} /></div>}
          </button>
        ))}
      </div>
    </div>
  );
}
