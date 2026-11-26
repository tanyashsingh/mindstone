/** Settings → Plugins: install from a folder or .zip (after reviewing permissions), enable, disable, remove. */
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Puzzle, Trash2 } from "lucide-react";
import { db } from "@/data/db";
import { PERMISSIONS, installPlugin, readPlugin, removePlugin, setPluginEnabled, usePlugins, type PluginManifest } from "@/plugins/host";
import { useApp } from "@/store/app";
import { Modal, Toggle, confirmDialog } from "./ui";

export function PluginSettings() {
  const plugins = useLiveQuery(() => db().plugins.toArray(), [], []);
  const errors = usePlugins((s) => s.errors);
  const folder = useRef<HTMLInputElement>(null);
  const zip = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ manifest: PluginManifest; code: string } | null>(null);

  const pick = async (files: File[]) => {
    if (!files.length) return;
    try { setPending(await readPlugin(files)); }
    catch (e) { useApp.getState().toast(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-muted">Plugins add commands, slash items and panels. Each runs in a sealed sandbox with no network and no access to your data beyond the permissions you grant here. Install only plugins you trust.</p>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => folder.current?.click()}><Puzzle size={14} /> Install from folder…</button>
        <button className="btn-outline" onClick={() => zip.current?.click()}>Install from .zip…</button>
      </div>
      <input ref={folder} type="file" multiple hidden aria-label="Plugin folder" {...{ webkitdirectory: "" }} onChange={(e) => { void pick([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <input ref={zip} type="file" hidden accept=".zip" aria-label="Plugin zip" onChange={(e) => { void pick([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <ul className="space-y-1.5" aria-label="Installed plugins">
        {plugins.map((p) => (
          <li key={p.id} className="rounded-md border border-line p-2.5" data-testid="plugin">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1"><span className="font-medium">{p.manifest.name}</span> <span className="text-faint">{p.manifest.version}</span>
                {p.manifest.description && <span className="block text-[12.5px] text-muted">{p.manifest.description}</span>}</span>
              <Toggle checked={p.enabled} onChange={(v) => void setPluginEnabled(p.id, v)} label={`Enable ${p.manifest.name}`} />
              <button className="icon-btn hover:text-danger" aria-label={`Remove ${p.manifest.name}`} onClick={async () => { if (await confirmDialog(`Remove ${p.manifest.name}?`, "Its commands and panel disappear. Your pages are not changed.")) await removePlugin(p.id); }}><Trash2 size={14} /></button>
            </div>
            <div className="mt-1 text-[12px] text-faint">Permissions: {(p.manifest.permissions ?? []).map((x) => PERMISSIONS[x]).join(", ") || "none"}</div>
            {errors[p.id] && <div className="mt-1 text-[12px] text-danger">Error: {errors[p.id]}</div>}
          </li>
        ))}
        {plugins.length === 0 && <li className="text-faint">No plugins installed. An example is in the plugins/word-count folder of the Mindstone source.</li>}
      </ul>
      {pending && (
        <Modal open onClose={() => setPending(null)} title={`Install ${pending.manifest.name}?`} width={460}
          footer={<><button className="btn-outline" onClick={() => setPending(null)}>Cancel</button><button className="btn-primary" onClick={async () => { await installPlugin(pending.manifest, pending.code); setPending(null); useApp.getState().toast(`${pending.manifest.name} installed`, "success"); }}>Install</button></>}>
          <p className="mb-2 text-[13px]">{pending.manifest.description || "No description."}</p>
          <p className="mb-1 text-[13px] font-medium">It asks to:</p>
          <ul className="ml-5 list-disc text-[13px]" aria-label="Requested permissions">
            {(pending.manifest.permissions ?? []).map((x) => <li key={x}>{PERMISSIONS[x]}</li>)}
            {!(pending.manifest.permissions ?? []).length && <li>Nothing beyond showing commands and a panel</li>}
          </ul>
          <p className="mt-2 text-[12px] text-faint">It can never use the network or read anything else.</p>
        </Modal>
      )}
    </div>
  );
}
