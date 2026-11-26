/**
 * Offline text recognition (Tesseract.js, English, LSTM engine). The worker, WebAssembly core and language data
 * are served from the app itself (public/ocr, or cairn-asset://ocr/ in the desktop app); nothing goes online.
 * Images are recognised directly; scanned PDF pages are rendered with pdf.js first.
 */
import { create } from "zustand";

export function ocrBase(): string {
  return location.protocol === "file:" ? "cairn-asset://ocr/" : new URL("ocr/", document.baseURI).href;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
export const isImage = (name: string, mime: string) => /^image\/(png|jpeg|webp|bmp|gif|tiff)$/.test(mime) || IMAGE_EXT.test(name);
export const MAX_OCR_PDF_PAGES = 50;

/** Recognition progress per attachment id (0..1), for the UI. */
export const useOcrProgress = create<{ busy: Record<string, number>; set: (id: string, p: number | null) => void }>((set) => ({
  busy: {},
  set: (id, p) => set((s) => {
    const busy = { ...s.busy };
    if (p === null) delete busy[id]; else busy[id] = p;
    return { busy };
  }),
}));

type TWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
let workerP: Promise<TWorker> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let onProgress: ((p: number) => void) | null = null;

async function worker(): Promise<TWorker> {
  clearTimeout(idle);
  if (!workerP) {
    workerP = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      const base = ocrBase();
      return createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: `${base}worker.min.js`,
        corePath: `${base}core`,
        langPath: `${base}lang`,
        gzip: true,
        cacheMethod: "none", // the data is already local
        logger: (m) => { if (m.status === "recognizing text") onProgress?.(m.progress); },
      });
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

function release() {
  clearTimeout(idle);
  idle = setTimeout(async () => { const w = workerP; workerP = null; (await w)?.terminate(); }, 60_000); // free ~100 MB when idle
}

type Source = Blob | HTMLCanvasElement;

/** Recognises text on each image in turn; progress covers all of them. */
export async function recognize(sources: Source[], progress?: (p: number) => void): Promise<string> {
  const w = await worker();
  const out: string[] = [];
  try {
    for (let i = 0; i < sources.length; i++) {
      onProgress = (p) => progress?.((i + p) / sources.length);
      const { data } = await w.recognize(sources[i]!);
      out.push(data.text.trim());
    }
  } finally {
    onProgress = null;
    release();
  }
  progress?.(1);
  return out.filter(Boolean).join("\n\n");
}

/** Renders PDF pages that have (almost) no text layer to canvases, at a resolution that suits OCR. */
export async function scannedPdfPages(bytes: Uint8Array, maxPages = MAX_OCR_PDF_PAGES): Promise<{ pages: HTMLCanvasElement[]; total: number }> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const task = pdfjs.getDocument({ data: bytes.slice(), enableXfa: false, stopAtErrors: false });
  const doc = await task.promise;
  const pages: HTMLCanvasElement[] = [];
  try {
    for (let i = 1; i <= doc.numPages && pages.length < maxPages; i++) {
      const page = await doc.getPage(i);
      const text = (await page.getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join("").trim();
      if (text.length < 20) {
        const vp = page.getViewport({ scale: 1 });
        const scale = Math.min(3, 2000 / Math.max(vp.width, vp.height)); // ~2000 px on the long side
        const v = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(v.width);
        canvas.height = Math.ceil(v.height);
        await page.render({ canvas, viewport: v }).promise;
        pages.push(canvas);
      }
      page.cleanup();
    }
    return { pages, total: doc.numPages };
  } finally {
    await task.destroy();
  }
}
