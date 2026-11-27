import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LayoutTemplate, Copy, Trash2, Pencil } from "lucide-react";
import { db, patch } from "@/data/db";
import * as repo from "@/data/repo";
import { BUILT_IN_TEMPLATES, TEMPLATE_FORMULAS, type BuiltInTemplate } from "@/data/templates";
import type { Template } from "@/data/types";
import { markdownToDoc } from "@/data/portability";
import { useApp } from "@/store/app";
import { promptDialog, confirmDialog } from "@/components/ui";
import { reassignIds } from "@/lib/doc";
import { cx, uid } from "@/lib/util";

export async function applyBuiltIn(ws: string, t: BuiltInTemplate, parentId: string | null = null) {
  const content = markdownToDoc(t.markdown);
  const page = await repo.createPage(ws, parentId, { title: t.name, icon: t.icon, content });
  if (t.database) {
    const props = t.database.props.map(([name, type, opts]) => {
      const p = repo.newProperty(name, type, TEMPLATE_FORMULAS[`${t.id}:${name}`] ? { formula: TEMPLATE_FORMULAS[`${t.id}:${name}`] } : {});
      if (opts) p.options = opts.map((o, i) => ({ id: uid(), name: o, color: repo.OPTION_COLORS[(i + 3) % repo.OPTION_COLORS.length]! }));
      return p;
    });
    const { page: dbPage, database } = await repo.createDatabase(ws, page.id, t.database.name, props);
    const group = props.find((p) => p.type === "status" || p.type === "select");
    const date = props.find((p) => p.type === "date" || p.type === "dateRange");
    const views = [database.views[0]!, ...(t.database.views ?? []).map((v) => repo.newView(v, v[0]!.toUpperCase() + v.slice(1), { groupBy: group?.id, dateProperty: date?.id }))];
    await repo.updateDatabase(database.id, { views });
    await repo.savePageContent(page.id, { ...content, content: [...(content.content ?? []), { type: "pageEmbed", attrs: { pageId: dbPage.id } }] });
  }
  return page;
}

export async function applyCustom(ws: string, t: Template, parentId: string | null = null) {
  return repo.createPage(ws, parentId, { title: t.name, icon: t.icon, content: reassignIds(t.content, uid) });
}

export default function Templates() {
  const ws = useApp((s) => s.workspaceId)!;
  const open = useApp((s) => s.open);
  const [cat, setCat] = useState("All");
  const custom = useLiveQuery(() => db().templates.where("workspaceId").equals(ws).toArray(), [ws]);
  const cats = ["All", ...new Set(BUILT_IN_TEMPLATES.map((t) => t.category)), "Custom"];
  const builtins = BUILT_IN_TEMPLATES.filter((t) => cat === "All" || t.category === cat);
  const use = async (fn: () => Promise<{ id: string }>) => { const p = await fn(); open({ kind: "page", id: p.id }); };

  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <div className="mb-2 flex items-center gap-3"><LayoutTemplate size={22} className="text-muted" /><h1 className="text-[26px] font-bold tracking-tight">Templates</h1></div>
      <p className="mb-5 text-ui text-muted">Start from a template, or save any page as a template from its ••• menu.</p>
      <div className="mb-4 flex flex-wrap gap-1">{cats.map((c) => <button key={c} className={cx("btn h-7", cat === c && "bg-active")} onClick={() => setCat(c)}>{c}</button>)}</div>
      {(cat === "All" || cat === "Custom") && custom && custom.length > 0 && (
        <>
          <h2 className="label mb-2">Your templates</h2>
          <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {custom.map((t) => (
              <div key={t.id} className="panel group p-4">
                <div className="mb-1 flex items-center gap-2"><span className="text-[20px]">{t.icon}</span><span className="flex-1 font-medium">{t.name}</span>
                  <button className="icon-btn size-6 opacity-0 group-hover:opacity-100" aria-label="Rename" onClick={async () => { const n = await promptDialog("Rename template", t.name); if (n) await patch(db().templates, t.id, { name: n }); }}><Pencil size={13} /></button>
                  <button className="icon-btn size-6 opacity-0 group-hover:opacity-100" aria-label="Duplicate" onClick={() => db().templates.add({ ...t, id: uid(), name: `${t.name} (copy)`, createdAt: Date.now() })}><Copy size={13} /></button>
                  <button className="icon-btn size-6 opacity-0 group-hover:opacity-100" aria-label="Delete" onClick={async () => { if (await confirmDialog(`Delete template “${t.name}”?`)) await db().templates.delete(t.id); }}><Trash2 size={13} /></button>
                </div>
                <div className="mb-3 text-meta text-muted">{t.description}</div>
                <button className="btn-outline" onClick={() => use(() => applyCustom(ws, t))}>Use template</button>
              </div>
            ))}
          </div>
        </>
      )}
      {cat !== "Custom" && (
        <>
          <h2 className="label mb-2">Built-in</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {builtins.map((t) => (
              <div key={t.id} className="panel flex flex-col p-4">
                <div className="mb-1 flex items-center gap-2"><span className="text-[20px]">{t.icon}</span><span className="font-medium">{t.name}</span></div>
                <div className="mb-3 flex-1 text-meta text-muted">{t.description}{t.database && <span className="text-faint"> Includes a “{t.database.name}” database.</span>}</div>
                <button className="btn-outline self-start" onClick={() => use(() => applyBuiltIn(ws, t))}>Use template</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
