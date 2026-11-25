/**
 * Plain-text extraction from attachments, for search and AI retrieval.
 * - Word (.docx): a minimal ZIP reader (STORE + DEFLATE via the platform's DecompressionStream)
 *   reads word/document.xml and keeps paragraph breaks. No dependency.
 * - PDF: Mozilla pdf.js, loaded only when a PDF is processed.
 * - Text-like files are read directly; HTML is reduced to its text.
 * Extracted text is data: it is indexed and quoted to AI models as untrusted content, never executed.
 */

export const MAX_EXTRACTED_CHARS = 1_000_000;
const MAX_PDF_PAGES = 500;

export type ExtractKind = "pdf" | "docx" | "text" | "html" | null;

export function extractKind(name: string, mime: string): ExtractKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (ext === "html" || ext === "htm" || mime === "text/html") return "html";
  if (/^text\//.test(mime) || ["md", "markdown", "txt", "csv", "json", "tsv", "log"].includes(ext)) return "text";
  return null;
}

// ---- ZIP reading ------------------------------------------------------------------

interface ZipEntry { name: string; method: number; compressedSize: number; offset: number }

function listZip(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End-of-central-directory record: scan back over a possible comment (max 64 KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt ZIP directory");
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    out.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readZipEntry(buf: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error("Corrupt ZIP entry");
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error(`Unsupported ZIP compression method ${e.method}`);
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text of a .docx: paragraphs, line breaks and tabs kept; tables read row by row. */
export async function docxToText(bytes: Uint8Array): Promise<string> {
  const entry = listZip(bytes).find((e) => e.name === "word/document.xml");
  if (!entry) throw new Error("No word/document.xml: not a Word document");
  const xml = new TextDecoder().decode(await readZipEntry(bytes, entry));
  const text = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function htmlToText(html: string): string {
  return decodeXmlEntities(
    html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n").trim();
}

/** Text of a PDF via pdf.js (lazy-loaded). Scanned PDFs without a text layer yield "". */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  }
  const task = pdfjs.getDocument({ data: bytes, enableXfa: false, stopAtErrors: false });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    let total = 0;
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES) && total < MAX_EXTRACTED_CHARS; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) { parts.push(line); total += line.length; line = ""; }
      }
      if (line) parts.push(line);
      parts.push("");
      page.cleanup();
    }
    return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await task.destroy(); // frees the document and its worker resources
  }
}

/** Extract text from a file, or null when the type is not supported. Throws on corrupt input. */
export async function extractText(name: string, mime: string, blob: Blob): Promise<string | null> {
  const kind = extractKind(name, mime);
  if (!kind) return null;
  let text: string;
  if (kind === "text") text = await blob.slice(0, MAX_EXTRACTED_CHARS * 2).text();
  else if (kind === "html") text = htmlToText(await blob.slice(0, MAX_EXTRACTED_CHARS * 4).text());
  else {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    text = kind === "pdf" ? await pdfToText(bytes) : await docxToText(bytes);
  }
  return text.slice(0, MAX_EXTRACTED_CHARS);
}
