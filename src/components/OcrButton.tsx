/** "Recognise text" action and status for an image or PDF attachment. */
import { Loader2, ScanText } from "lucide-react";
import type { Attachment } from "@/data/types";
import { canRecognize, recognizeAttachment } from "@/lib/ocrAttach";
import { useOcrProgress } from "@/lib/ocr";
import { useApp } from "@/store/app";

export function OcrButton({ a, compact }: { a: Attachment; compact?: boolean }) {
  const p = useOcrProgress((s) => s.busy[a.id]);
  if (!canRecognize(a)) return null;
  if (p !== undefined) {
    return <span className="chip c-blue" role="progressbar" aria-label={`Recognising text in ${a.name}`} aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}><Loader2 size={11} className="mr-1 animate-spin" />Reading text {Math.round(p * 100)}%</span>;
  }
  const done = a.ocr === "done";
  return (
    <button className={compact ? "btn h-6 px-1.5 text-meta" : "btn h-6"} title={done ? "Run text recognition again" : "Recognise text in this file on this computer, so search and AI can use it"}
      onClick={async () => {
        try {
          const n = await recognizeAttachment(a.id);
          useApp.getState().toast(n ? `Recognised text in ${a.name}` : `No text found in ${a.name}`, n ? "success" : "info");
        } catch (e) { useApp.getState().toast(`Text recognition failed: ${e instanceof Error ? e.message : String(e)}`, "error"); }
      }}>
      <ScanText size={13} /> {done ? "Recognise again" : "Recognise text"}
    </button>
  );
}
