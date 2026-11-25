import { useLiveQuery } from "dexie-react-hooks";
import { Trash2, RotateCcw } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import { useApp } from "@/store/app";
import { EmptyState, confirmDialog } from "@/components/ui";
import { relTime } from "@/lib/util";

export default function Trash() {
  const ws = useApp((s) => s.workspaceId)!;
  const pages = useLiveQuery(() => db().pages.where("workspaceId").equals(ws).filter((p) => p.deletedAt > 0).toArray(), [ws]);
  const tasks = useLiveQuery(() => db().tasks.where("workspaceId").equals(ws).filter((t) => t.deletedAt > 0).toArray(), [ws]);
  const ids = new Set(pages?.map((p) => p.id));
  const roots = (pages ?? []).filter((p) => !p.parentId || !ids.has(p.parentId)).sort((a, b) => b.deletedAt - a.deletedAt);
  return (
    <div className="mx-auto max-w-3xl px-10 py-10">
      <div className="mb-2 flex items-center gap-3"><Trash2 size={22} className="text-muted" /><h1 className="flex-1 text-[26px] font-bold tracking-tight">Trash</h1>
        {(roots.length > 0 || (tasks?.length ?? 0) > 0) && <button className="btn-danger" onClick={async () => {
          if (!(await confirmDialog("Empty trash permanently?", `${roots.length} pages (with their sub-pages, history and attachments) and ${tasks?.length ?? 0} tasks will be deleted from this device. This cannot be undone.`, { danger: true, confirmLabel: "Delete permanently" }))) return;
          for (const p of roots) await repo.purgePage(p.id);
          await db().tasks.bulkDelete((tasks ?? []).map((t) => t.id));
        }}>Empty trash</button>}
      </div>
      <p className="mb-5 text-[13px] text-muted">Items stay here until you delete them permanently.</p>
      {roots.length === 0 && !tasks?.length && <EmptyState icon={<Trash2 />} title="Trash is empty" />}
      {roots.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
          <span className="w-5 text-center">{p.icon || "📄"}</span><span className="flex-1 truncate">{p.title || "Untitled"}</span>
          <span className="text-[12px] text-faint">deleted {relTime(p.deletedAt)}</span>
          <button className="btn" onClick={() => repo.restorePage(p.id)}><RotateCcw size={14} /> Restore</button>
          <button className="btn-danger" onClick={async () => { if (await confirmDialog(`Delete “${p.title || "Untitled"}” permanently?`, "This cannot be undone.", { danger: true })) await repo.purgePage(p.id); }}>Delete</button>
        </div>
      ))}
      {(tasks?.length ?? 0) > 0 && <h2 className="label mb-1 mt-6">Tasks</h2>}
      {tasks?.map((t) => (
        <div key={t.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
          <span className="flex-1 truncate">{t.title}</span>
          <button className="btn" onClick={() => db().tasks.update(t.id, { deletedAt: 0 })}><RotateCcw size={14} /> Restore</button>
        </div>
      ))}
    </div>
  );
}
