/** Right panel → Plugins: each plugin's panel (sanitised Markdown and buttons that call back into the plugin). */
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { invoke, usePlugins } from "@/plugins/host";
import { useApp } from "@/store/app";

export function PluginPanels() {
  const panels = usePlugins((s) => s.panels);
  const plugins = useLiveQuery(() => db().plugins.toArray(), [], []);
  const shown = plugins.filter((p) => p.enabled && panels[p.id]);
  if (!shown.length) return <div className="text-faint">No plugin panels. Plugins you install in Settings → Plugins can show one here.</div>;
  return (
    <div className="space-y-3">
      {shown.map((p) => (
        <section key={p.id} className="rounded-md border border-line bg-elev p-2.5" aria-label={`${p.manifest.name} panel`}>
          <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-faint">{p.manifest.name}</div>
          <div className="rea-editor !pb-0 !text-[13px]" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(panels[p.id]!.markdown, { async: false }) as string, { FORBID_TAGS: ["img", "style", "form"] }) }} />
          {panels[p.id]!.buttons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {panels[p.id]!.buttons.map((b) => <button key={b.id} className="btn h-7" onClick={() => void invoke(p.id, "panel", b.id).catch((e: Error) => useApp.getState().toast(e.message, "error"))}>{b.label}</button>)}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
