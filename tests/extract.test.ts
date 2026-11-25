import { deflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeXmlEntities, docxToText, extractKind, extractText, htmlToText } from "@/lib/extract";
import { crc32 } from "@/lib/zip";
import { db, useDatabase } from "@/data/db";
import * as repo from "@/data/repo";
import { SearchIndex } from "@/data/search";

/** Builds a ZIP with the given entries, each either stored (0) or deflated (8). */
function zip(entries: { name: string; text: string; method: 0 | 8 }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = enc.encode(e.text), data = e.method === 8 ? deflateRawSync(raw) : Buffer.from(raw), name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.method, 8); lh.writeUInt32LE(crc32(raw), 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.method, 10); ch.writeUInt32LE(crc32(raw), 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, data); centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cen = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cen.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cen, end]));
}

const DOC_XML = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Revenue &amp; costs</w:t><w:tab/><w:t>&#8364;12k</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;

describe("document text extraction", () => {
  it("classifies supported files", () => {
    expect(extractKind("a.PDF", "")).toBe("pdf");
    expect(extractKind("a.docx", "application/octet-stream")).toBe("docx");
    expect(extractKind("a.md", "")).toBe("text");
    expect(extractKind("a.html", "text/html")).toBe("html");
    expect(extractKind("a.png", "image/png")).toBe(null);
    expect(extractKind("a.doc", "application/msword")).toBe(null); // legacy binary .doc is not supported
  });

  it.each([0, 8] as const)("reads Word documents (ZIP method %i)", async (method) => {
    const bytes = zip([{ name: "[Content_Types].xml", text: "<Types/>", method }, { name: "word/document.xml", text: DOC_XML, method }]);
    const text = await docxToText(bytes);
    expect(text).toContain("Quarterly report");
    expect(text).toContain("Revenue & costs\t€12k");
    expect(text).toMatch(/Region\s+North/);
  });

  it("rejects files that are not Word documents", async () => {
    await expect(docxToText(zip([{ name: "other.xml", text: "<x/>", method: 0 }]))).rejects.toThrow(/not a Word document/);
    await expect(docxToText(new TextEncoder().encode("plain text"))).rejects.toThrow(/Not a ZIP/);
  });

  it("decodes entities and strips HTML safely", () => {
    expect(decodeXmlEntities("&lt;b&gt; &#x41;&#66; &bogus;")).toBe("<b> AB &bogus;");
    expect(htmlToText("<p>Hello</p><script>alert(1)</script><style>p{}</style><p>World &amp; co</p>")).toBe("Hello\nWorld & co");
  });

  it("extracts text from text-like blobs and returns null for unsupported types", async () => {
    expect(await extractText("n.md", "text/markdown", new Blob(["# Title\nbody"]))).toBe("# Title\nbody");
    expect(await extractText("p.png", "image/png", new Blob([new Uint8Array([1, 2])]))).toBe(null);
  });
});

describe("attachments become searchable", () => {
  beforeEach(() => { useDatabase(`extract-${Date.now()}-${Math.random()}`); });

  it("stores extracted Word text and indexes it for search", async () => {
    const ws = await repo.createWorkspace("W");
    const bytes = zip([{ name: "word/document.xml", text: DOC_XML, method: 8 }]);
    const file = new File([bytes as BlobPart], "Q3.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const a = await repo.addAttachment(ws.id, null, file);
    await repo.extractAttachmentText(a.id); // the upload also starts this in the background; awaiting makes the test deterministic
    const stored = await db().attachments.get(a.id);
    expect(stored?.textStatus).toBe("ok");
    expect(stored?.text).toContain("Revenue & costs");
    const idx = new SearchIndex();
    await idx.build(ws.id);
    const hit = idx.search("revenue")[0];
    expect(hit?.kind).toBe("attachment");
    expect(hit?.title).toBe("Q3.docx");
  });

  it("records corrupt files as unreadable instead of throwing", async () => {
    const ws = await repo.createWorkspace("W");
    const a = await repo.addAttachment(ws.id, null, new File(["not a zip"], "broken.docx"));
    await repo.extractAttachmentText(a.id);
    expect((await db().attachments.get(a.id))?.textStatus).toBe("error");
  });
});
