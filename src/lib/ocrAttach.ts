/** Runs OCR for an attachment (an image, or a PDF with scanned pages) and stores the text for search and AI. */
import { db, patch } from "@/data/db";
import { MAX_EXTRACTED_CHARS } from "./extract";
import { isImage, recognize, scannedPdfPages, useOcrProgress } from "./ocr";
import { useSettings } from "@/store/settings";

export function canRecognize(a: { name: string; mime: string }): boolean {
  return isImage(a.name, a.mime) || a.mime === "application/pdf" || /\.pdf$/i.test(a.name);
}

const running = new Set<string>();

/** Recognises text now. Returns the number of characters found, or null if the file can't be recognised. */
export async function recognizeAttachment(id: string): Promise<number | null> {
  const a = await db().attachments.get(id);
  if (!a || !canRecognize(a) || running.has(id)) return null;
  running.add(id);
  const progress = useOcrProgress.getState();
  progress.set(id, 0);
  try {
    let found = "";
    let base = a.ocr === "done" ? "" : a.text ?? "";
    if (isImage(a.name, a.mime)) {
      found = await recognize([a.blob], (p) => progress.set(id, p));
      base = "";
    } else {
      const { pages } = await scannedPdfPages(new Uint8Array(await a.blob.arrayBuffer()));
      if (pages.length) found = await recognize(pages, (p) => progress.set(id, p));
    }
    const text = [base.trim(), found.trim()].filter(Boolean).join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
    await patch(db().attachments, id, { text, textStatus: text ? "ok" : "empty", ocr: "done" });
    return found.length;
  } catch (e) {
    console.warn("[Mindstone] OCR failed", a.name, e);
    await patch(db().attachments, id, { ocr: "error" });
    throw e;
  } finally {
    running.delete(id);
    progress.set(id, null);
  }
}

/** Called after normal text extraction: recognises images and scanned PDFs when automatic OCR is on. */
export async function autoRecognize(id: string) {
  if (!useSettings.getState().s.ocr.auto || typeof document === "undefined") return;
  const a = await db().attachments.get(id);
  if (!a || a.ocr) return;
  const scanned = isImage(a.name, a.mime) || ((a.mime === "application/pdf" || /\.pdf$/i.test(a.name)) && (a.text ?? "").trim().length < 20 * 1);
  if (scanned) await recognizeAttachment(id).catch(() => {});
}
