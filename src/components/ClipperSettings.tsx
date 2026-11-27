/** Settings → Integrations: the web clipper (desktop app) and calendar subscriptions. */
import { useEffect, useState } from "react";
import { Copy, FolderOpen, RefreshCw } from "lucide-react";
import { Toggle, copyText } from "./ui";

export function ClipperSettings() {
  const [st, setSt] = useState<ClipperState | null>(null);
  useEffect(() => { void window.rea?.clipper.state().then(setSt); }, []);
  if (!window.rea) return <p className="text-ui text-muted">The web clipper saves pages from Chrome or Edge into the desktop app. Install Mindstone for Windows to use it.</p>;
  if (!st) return null;
  return (
    <div className="space-y-3 text-ui" role="region" aria-label="Web clipper">
      <div className="flex items-start gap-3">
        <div className="flex-1"><div className="font-medium">Web clipper</div><p className="text-muted">Lets the Mindstone browser extension save a page, a selection or a simplified article here. It listens only on this computer (127.0.0.1, port {st.port}) and needs the pairing code below.</p></div>
        <Toggle checked={st.enabled} onChange={async (v) => setSt(await window.rea!.clipper.set(v))} label="Web clipper" />
      </div>
      {st.error && <p className="text-danger" role="alert">{st.error}</p>}
      {st.enabled && <>
        <div className="flex items-center gap-2 rounded-md bg-sunken p-2.5">
          <span className="text-muted">Pairing code</span>
          <span className="flex-1 font-mono tracking-wide" data-testid="clipper-code">{st.token}</span>
          <button className="icon-btn" aria-label="Copy pairing code" onClick={() => void copyText(st.token, "Pairing code copied")}><Copy size={14} /></button>
          <button className="btn h-7" title="Make a new code; the extension must be paired again" onClick={async () => setSt(await window.rea!.clipper.newCode())}><RefreshCw size={13} /> New code</button>
        </div>
        <ol className="ml-5 list-decimal space-y-0.5 text-muted">
          <li>In Chrome or Edge, open <span className="font-mono">chrome://extensions</span> (or <span className="font-mono">edge://extensions</span>) and turn on Developer mode.</li>
          <li>Choose “Load unpacked” and pick the extension folder: <button className="text-accent underline" onClick={() => void window.rea!.clipper.openFolder()}><FolderOpen size={12} className="mr-0.5 inline" />open it</button>.</li>
          <li>Click the Mindstone icon in the toolbar, open Pairing, paste the code and choose Save and test.</li>
        </ol>
      </>}
    </div>
  );
}
