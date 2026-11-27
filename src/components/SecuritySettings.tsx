/** Settings → Security: passphrase protection (encryption at rest), auto-lock, recovery key. */
import { useEffect, useState } from "react";
import { Copy, KeyRound, Lock, ShieldCheck, ShieldOff } from "lucide-react";
import { changePassphrase, disableEncryption, enableEncryption, newRecovery, passphraseProblem, unwrap, vaultMeta, type VaultMeta } from "@/data/vault";
import { lockAndReload } from "@/lib/idleLock";
import { useSettings } from "@/store/settings";
import { useApp } from "@/store/app";
import { Modal, copyText } from "./ui";

function RecoveryKeyBox({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div>
      <p className="mb-2 text-ui">This is your <b>recovery key</b>. It is the only way back in if you forget your passphrase. Write it down or store it in a password manager. It is shown only now.</p>
      <div className="mb-3 flex items-center gap-2 rounded-md bg-sunken p-3 font-mono text-[16px] tracking-wider" data-testid="recovery-key">{code}
        <button className="icon-btn ml-auto" aria-label="Copy recovery key" onClick={() => void copyText(code, "Recovery key copied")}><Copy size={14} /></button></div>
      <label className="mb-3 flex items-center gap-2 text-ui"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery key</label>
      <button className="btn-primary" disabled={!saved} onClick={onDone}>Done</button>
    </div>
  );
}

export function SecuritySettings() {
  const { s, update } = useSettings();
  const [meta, setMeta] = useState<VaultMeta | null | undefined>(undefined);
  const [dialog, setDialog] = useState<null | "enable" | "change" | "recovery" | "disable">(null);
  const refresh = () => void vaultMeta().then(setMeta);
  useEffect(refresh, []);
  if (meta === undefined) return null;
  const on = !!meta;
  return (
    <div className="mt-2 rounded-[12px] border border-line p-3" aria-label="Passphrase protection" role="region">
      <div className="mb-1 flex items-center gap-2 font-medium">{on ? <ShieldCheck size={16} className="text-success" /> : <ShieldOff size={16} className="text-muted" />} Passphrase protection {on ? "is on" : "is off"}</div>
      <p className="mb-3 text-meta text-muted">{on
        ? "Your workspace is encrypted on this computer with AES-256. Mindstone asks for your passphrase when it starts and after the auto-lock time. Ids, links between items, event start times and deletion times stay unencrypted so lookups work."
        : "Encrypts your pages, tasks, databases, files, comments, AI chats and settings on this computer with a key only your passphrase (or a recovery key) can open. Without either, the data can't be recovered: not by you, not by anyone."}</p>
      {!on ? <button className="btn-primary" onClick={() => setDialog("enable")}><Lock size={14} /> Turn on passphrase protection</button> : (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-outline" onClick={() => lockAndReload()}><Lock size={14} /> Lock now</button>
          <button className="btn" onClick={() => setDialog("change")}>Change passphrase</button>
          <button className="btn" onClick={() => setDialog("recovery")}><KeyRound size={14} /> New recovery key</button>
          <label className="ml-auto flex items-center gap-1.5 text-meta">Lock after
            <select className="input h-7 w-28" aria-label="Auto-lock" value={s.security.autoLockMin} onChange={(e) => update((x) => ({ ...x, security: { ...x.security, autoLockMin: Number(e.target.value) } }))}>
              {[0, 5, 15, 30, 60, 240].map((m) => <option key={m} value={m}>{m === 0 ? "Never" : m < 60 ? `${m} min` : `${m / 60} h`} idle</option>)}
            </select></label>
          <button className="btn text-danger" onClick={() => setDialog("disable")}>Turn off</button>
        </div>
      )}
      {dialog && <PassDialog kind={dialog} onClose={() => { setDialog(null); refresh(); }} />}
    </div>
  );
}

function PassDialog({ kind, onClose }: { kind: "enable" | "change" | "recovery" | "disable"; onClose: () => void }) {
  const [a, setA] = useState(""), [b, setB] = useState(""), [c, setC] = useState("");
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const title = { enable: "Turn on passphrase protection", change: "Change passphrase", recovery: "New recovery key", disable: "Turn off passphrase protection" }[kind];
  if (code) return <Modal open onClose={() => {}} title="Save your recovery key" width={480}><RecoveryKeyBox code={code} onDone={onClose} /></Modal>;

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      if (kind === "enable") {
        if (a !== b) throw new Error("The passphrases don't match.");
        setCode(await enableEncryption(a, setProgress));
        clearLeftovers();
        useApp.getState().toast("Passphrase protection is on", "success");
      } else if (kind === "change") {
        if (b !== c) throw new Error("The new passphrases don't match.");
        await changePassphrase(a, b);
        useApp.getState().toast("Passphrase changed", "success");
        onClose();
      } else if (kind === "recovery") {
        setCode(await newRecovery(a));
      } else {
        const meta = await vaultMeta();
        if (meta) await unwrap(meta.pass, a); // confirm it's really you
        await disableEncryption(setProgress);
        useApp.getState().toast("Passphrase protection is off; your data is no longer encrypted", "info");
        onClose();
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setProgress(null); }
    finally { setBusy(false); }
  };
  const problem = kind === "enable" || kind === "change" ? passphraseProblem(kind === "enable" ? a : b) : null;
  const ready = kind === "enable" ? !!a && !!b && ack && !problem : kind === "change" ? !!a && !!b && !!c && !problem : !!a;
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={title} width={480}
      footer={<><button className="btn-outline" disabled={busy} onClick={onClose}>Cancel</button><button className={kind === "disable" ? "btn bg-danger text-white hover:bg-danger" : "btn-primary"} disabled={busy || !ready} onClick={() => void submit()}>{kind === "enable" ? "Encrypt my data" : kind === "disable" ? "Decrypt and turn off" : kind === "recovery" ? "Create new key" : "Change"}</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }} className="grid gap-2">
        {kind === "enable" && <>
          <input autoFocus type="password" className="input" aria-label="New passphrase" placeholder="Passphrase (at least 10 characters)" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" />
          <input type="password" className="input" aria-label="Repeat passphrase" placeholder="Repeat passphrase" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" />
          {a && problem && <p className="text-meta text-warning">{problem}</p>}
          <label className="flex items-start gap-2 text-meta"><input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand that if I lose both my passphrase and my recovery key, my data can't be recovered.</label>
        </>}
        {kind === "change" && <>
          <input autoFocus type="password" className="input" aria-label="Current passphrase" placeholder="Current passphrase" value={a} onChange={(e) => setA(e.target.value)} autoComplete="current-password" />
          <input type="password" className="input" aria-label="New passphrase" placeholder="New passphrase" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" />
          <input type="password" className="input" aria-label="Repeat new passphrase" placeholder="Repeat new passphrase" value={c} onChange={(e) => setC(e.target.value)} autoComplete="new-password" />
          {b && problem && <p className="text-meta text-warning">{problem}</p>}
        </>}
        {(kind === "recovery" || kind === "disable") && <>
          <p className="text-ui text-muted">{kind === "recovery" ? "Your current recovery key will stop working." : "Your data will be decrypted and stored without a passphrase."} Enter your passphrase to continue.</p>
          <input autoFocus type="password" className="input" aria-label="Current passphrase" placeholder="Passphrase" value={a} onChange={(e) => setA(e.target.value)} autoComplete="current-password" />
        </>}
        {progress !== null && <div className="mt-1"><div className="h-1.5 overflow-hidden rounded bg-sunken"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div><p className="mt-1 text-meta text-muted" role="status">{kind === "disable" ? "Decrypting" : "Encrypting"} your data… {Math.round(progress * 100)}%</p></div>}
        {err && <p className="text-ui text-danger" role="alert">{err}</p>}
        <button hidden />
      </form>
    </Modal>
  );
}

/** Removes readable copies kept outside the database (crash-recovery drafts, recent searches). */
function clearLeftovers() {
  for (const k of Object.keys(localStorage)) if (k.startsWith("rea.draft.") || k === "rea.recentSearches") localStorage.removeItem(k);
}
