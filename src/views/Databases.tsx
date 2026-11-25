import { useLiveQuery } from "dexie-react-hooks";
import { Database as DbIcon, Plus, Table2 } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import { useApp } from "@/store/app";
import { EmptyState } from "@/components/ui";
import { relTime } from "@/lib/util";

export default function Databases() {
  const ws = useApp((s) => s.workspaceId)!;
  const open = useApp((s) => s.open);
  const list = useLiveQuery(async () => {
    const pages = (await repo.livePages(ws)).filter((p) => p.kind === "database");
    return Promise.all(pages.map(async (p) => ({ p, count: p.databaseId ? await db().records.where("databaseId").equals(p.databaseId).count() : 0, d: p.databaseId ? await db().databases.get(p.databaseId) : undefined })));
  }, [ws]);
  return (
    <div className="mx-auto max-w-4xl px-10 py-10">
      <div className="mb-5 flex items-center gap-3"><DbIcon size={22} className="text-muted" /><h1 className="flex-1 text-[26px] font-bold tracking-tight">Databases</h1>
        <button className="btn-primary" onClick={async () => { const { page } = await repo.createDatabase(ws, null); open({ kind: "page", id: page.id }); }}><Plus size={14} /> New database</button></div>
      {list?.length === 0 && <EmptyState icon={<Table2 />} title="No databases yet" body="Databases are collections of records with typed properties and multiple views. You can also import a CSV." />}
      <div className={list?.length ? "divide-y divide-line overflow-hidden rounded-[18px] shadow-[var(--neu-out)]" : "hidden"}>
        {list?.map(({ p, count, d }) => (
          <button key={p.id} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover" onClick={() => open({ kind: "page", id: p.id })}>
            <span className="w-5 text-center">{p.icon || "▦"}</span><span className="flex-1 truncate font-medium">{p.title || "Untitled"}</span>
            <span className="text-[12px] text-faint">{d?.properties.length ?? 0} properties · {count} records · {d?.views.length ?? 0} views</span>
            <span className="w-20 text-right text-[12px] text-faint">{relTime(p.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
