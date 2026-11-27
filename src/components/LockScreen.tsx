/** Shown on start when encryption is on: unlock with the passphrase, or reset it with the recovery key. */
import { useState } from "react";
import { KeyRound, Loader2, Lock } from "lucide-react";
import { recover, unlock } from "@/data/vault";
import mark from "@/assets/mindstone-mark.png";

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [mode, setMode] = useState<"unlock" | "recover">("unlock");
  const [pass, setPass] = useState("");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (mode === "unlock") await unlock(pass);
      else await recover(code, next);
      onUnlocked();
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); setBusy(false); }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg p-6" role="main" aria-label="Mindstone is locked">
      <form className="panel w-[380px] p-6" onSubmit={go}>
        <img src={mark} alt="" width={56} height={56} className="mb-3" />
        <h1 className="font-display mb-1 text-[24px]">{mode === "unlock" ? "Mindstone is locked" : "Reset your passphrase"}</h1>
        <p className="mb-4 text-ui text-muted">{mode === "unlock" ? "Your workspace is encrypted on this computer. Enter your passphrase to open it." : "Enter the recovery key you saved when you turned on encryption, then choose a new passphrase."}</p>
        {mode === "unlock" ? (
          <input autoFocus type="password" className="input mb-2" aria-label="Passphrase" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
        ) : <>
          <input autoFocus className="input mb-2 font-mono uppercase" aria-label="Recovery key" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
          <input type="password" className="input mb-2" aria-label="New passphrase" placeholder="New passphrase (at least 10 characters)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </>}
        {err && <p className="mb-2 text-ui text-danger" role="alert">{err}</p>}
        <button className="btn-primary w-full justify-center" disabled={busy || (mode === "unlock" ? !pass : !code || !next)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : mode === "unlock" ? <Lock size={14} /> : <KeyRound size={14} />} {mode === "unlock" ? "Unlock" : "Reset and unlock"}
        </button>
        <button type="button" className="btn mt-2 w-full justify-center text-meta text-muted" onClick={() => { setMode(mode === "unlock" ? "recover" : "unlock"); setErr(""); }}>
          {mode === "unlock" ? "Forgot your passphrase? Use your recovery key" : "Back to passphrase"}
        </button>
      </form>
    </div>
  );
}
