import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, Pause, Play, Square, X, Loader2 } from "lucide-react";
import { MicError, startRecording, type Recording } from "./recorder";
import { fmtClock, transcribe, warmUp, type Transcript } from "./transcribe";
import { useSettings } from "@/store/settings";
import { cx } from "@/lib/util";

/** Five-bar live level meter. */
export function LevelMeter({ rec }: { rec: Recording | null }) {
  const [lvl, setLvl] = useState(0);
  useEffect(() => {
    if (!rec) return;
    let raf = 0;
    const tick = () => { setLvl(rec.level()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rec]);
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden="true">
      {[0.2, 0.45, 0.7, 0.45, 0.2].map((w, i) => (
        <span key={i} className="w-[3px] rounded-full bg-accent transition-[height] duration-75" style={{ height: `${Math.max(3, Math.min(16, lvl * 16 * (0.6 + w)))}px` }} />
      ))}
    </span>
  );
}

export function useTimer(rec: Recording | null) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [rec]);
  return rec ? rec.elapsed() : 0;
}

/**
 * Floating dictation control. Records, then transcribes locally and hands the text to onText.
 * Esc cancels; the dictation shortcut or Stop finishes.
 */
export function DictationPill({ onText, onClose }: { onText: (text: string) => void; onClose: () => void }) {
  const voice = useSettings((s) => s.s.voice);
  const [rec, setRec] = useState<Recording | null>(null);
  const [phase, setPhase] = useState<"starting" | "recording" | "paused" | "transcribing">("starting");
  const [err, setErr] = useState("");
  const recRef = useRef<Recording | null>(null);
  const seconds = useTimer(rec);

  useEffect(() => {
    warmUp();
    let alive = true;
    startRecording().then((r) => { if (!alive) return r.cancel(); recRef.current = r; setRec(r); setPhase("recording"); })
      .catch((e) => setErr(e instanceof MicError ? e.message : String(e)));
    return () => { alive = false; recRef.current?.cancel(); };
  }, []);

  const finish = async () => {
    const r = recRef.current;
    if (!r) return onClose();
    recRef.current = null;
    setPhase("transcribing");
    try {
      const blob = await r.stop();
      const t: Transcript = await transcribe(blob, { language: voice.language || null });
      if (t.text) onText(t.text);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); recRef.current?.cancel(); recRef.current = null; onClose(); }
      if (e.key === "Enter" && phase === "recording") { e.preventDefault(); void finish(); }
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  });
  useEffect(() => {
    const done = () => void finish();
    addEventListener("cairn:dictate-stop", done);
    return () => removeEventListener("cairn:dictate-stop", done);
  });

  return createPortal(
    <div className="fixed bottom-10 left-1/2 z-50 -translate-x-1/2" role="dialog" aria-label="Dictation">
      <div className="menu anim-in flex items-center gap-3 px-3 py-2">
        {err ? (
          <>
            <span className="max-w-[420px] text-ui text-danger">{err}</span>
            <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
          </>
        ) : phase === "transcribing" ? (
          <span className="flex items-center gap-2 text-ui text-muted"><Loader2 size={15} className="animate-spin" /> Transcribing on this computer…</span>
        ) : (
          <>
            <span className={cx("flex size-7 items-center justify-center rounded-full", phase === "recording" ? "bg-danger/15 text-danger" : "bg-sunken text-muted")}><Mic size={15} /></span>
            <LevelMeter rec={phase === "recording" ? rec : null} />
            <span className="w-10 text-ui tabular-nums text-muted">{fmtClock(seconds)}</span>
            {phase === "paused"
              ? <button className="icon-btn" aria-label="Resume" onClick={() => { rec?.resume(); setPhase("recording"); }}><Play size={15} /></button>
              : <button className="icon-btn" aria-label="Pause" disabled={!rec} onClick={() => { rec?.pause(); setPhase("paused"); }}><Pause size={15} /></button>}
            <button className="btn-primary h-7" disabled={!rec} onClick={() => void finish()}><Square size={12} /> Insert text</button>
            <button className="icon-btn" aria-label="Cancel dictation" onClick={() => { recRef.current?.cancel(); recRef.current = null; onClose(); }}><X size={15} /></button>
          </>
        )}
      </div>
      {!err && phase !== "transcribing" && <div className="mt-1 text-center text-caption text-faint">Enter to insert · Esc to cancel · audio stays on this device</div>}
    </div>,
    document.body,
  );
}
