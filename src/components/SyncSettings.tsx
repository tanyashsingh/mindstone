/** Settings → Synchronization: set up folder or server sync, show status, sync now, stop. */
import { useEffect, useState } from "react";
import { Copy, FolderSync, Loader2, RefreshCw, Server, Unplug } from "lucide-react";
import { setUpSync, stopSync, syncCode, syncNow, useSync } from "@/sync/service";
import { useApp } from "@/store/app";
import { relTime } from "@/lib/util";
import { confirmDialog, copyText } from "./ui";

export function SyncSettings() {
  const { config, busy, lastSync, lastError, lastResult } = useSync();
  const [kind, setKind] = useState<"server" | "folder">(window.rea ? "folder" : "server");
  const [address, setAddress] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => { void window.rea?.sync.folder().then(setFolder); }, []);

  if (config) {
    const code = syncCode(config);
    return (
      <div className="space-y-3 text-ui" role="region" aria-label="Sync status">
        <p><b>Sync is on</b> for this device, through {config.kind === "folder" ? <>the folder <span className="font-mono text-meta">{folder ?? "…"}</span></> : <>the server <span className="font-mono text-meta">{config.url}</span></>}. Changes are encrypted on this device before they leave it.</p>
        <p className="text-muted" data-testid="sync-status">{busy ? "Syncing…" : lastError ? <span className="text-danger">Last sync failed: {lastError}</span> : lastSync ? `Last synced ${relTime(lastSync)} · ${lastResult}` : "Not synced yet."}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => void syncNow()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now</button>
          <button className="btn text-danger" onClick={async () => { if (await confirmDialog("Stop syncing on this device?", "Your data stays on this device. Other devices keep syncing with each other.")) await stopSync(); }}><Unplug size={14} /> Stop syncing</button>
        </div>
        {code && (
          <div className="rounded-md bg-sunken p-3">
            <div className="mb-1 text-meta text-muted">To add another device, enter this sync code and your sync passphrase there (Settings → Synchronization → Sync server):</div>
            <div className="flex items-center gap-2 font-mono text-meta"><span className="min-w-0 flex-1 break-all" data-testid="sync-code">{code}</span><button className="icon-btn" aria-label="Copy sync code" onClick={() => void copyText(code, "Sync code copied")}><Copy size={14} /></button></div>
          </div>
        )}
        <p className="text-meta text-faint">Sync runs every minute while Mindstone is open. If the same item was changed on two devices, the later change wins; a page's other version is kept in its page history.</p>
      </div>
    );
  }

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setWorking(true);
    try {
      const r = kind === "server" ? await setUpSync({ kind, address, passphrase: pass }) : await setUpSync({ kind, passphrase: pass });
      useApp.getState().toast(r.joined ? "Joined the sync space; your data is arriving" : "Sync is set up. Add your other devices with the same passphrase.", "success");
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    finally { setWorking(false); }
  };

  return (
    <form className="space-y-3 text-ui" onSubmit={go} aria-label="Set up sync">
      <p className="text-muted">Keep this device in step with your others. Everything is encrypted with your sync passphrase before it leaves the device, so the folder or server only stores scrambled data.</p>
      <div className="flex gap-2" role="radiogroup" aria-label="Sync through">
        {window.rea && <button type="button" role="radio" aria-checked={kind === "folder"} className={kind === "folder" ? "btn bg-active" : "btn"} onClick={() => setKind("folder")}><FolderSync size={14} /> A folder</button>}
        <button type="button" role="radio" aria-checked={kind === "server"} className={kind === "server" ? "btn bg-active" : "btn"} onClick={() => setKind("server")}><Server size={14} /> A sync server</button>
      </div>
      {kind === "folder" ? (
        <div className="flex items-center gap-2">
          <button type="button" className="btn-outline" onClick={async () => setFolder(await window.rea!.sync.chooseFolder())}>Choose folder…</button>
          <span className="min-w-0 truncate font-mono text-meta text-muted" data-testid="sync-folder">{folder ?? "No folder chosen. Pick one that OneDrive, Dropbox or a USB drive keeps in step."}</span>
        </div>
      ) : (
        <label className="grid gap-1">Server address, or a sync code from another device
          <input className="input" aria-label="Sync server" placeholder="https://sync.example.com  or  https://sync.example.com#code" value={address} onChange={(e) => setAddress(e.target.value)} />
          <span className="text-meta text-faint">Run your own with <code>node server/sync-server.mjs</code> (see SYNC.md). Use https for phones.</span>
        </label>
      )}
      <label className="grid gap-1">Sync passphrase
        <input type="password" className="input" aria-label="Sync passphrase" placeholder="The same on every device (at least 10 characters)" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
      </label>
      {err && <p className="text-danger" role="alert">{err}</p>}
      <button className="btn-primary" disabled={working || !pass || (kind === "server" ? !address : !folder)}>{working ? <Loader2 size={14} className="animate-spin" /> : null} Turn on sync</button>
    </form>
  );
}
