import { expect, test, type Page } from "@playwright/test";
import { boot, idb, main, nav, noCrash } from "./helpers";

/** Draws lines of text on a white canvas in the page and returns it as PNG or JPEG bytes. */
async function textImage(page: Page, lines: string[], type: "image/png" | "image/jpeg"): Promise<{ bytes: Buffer; w: number; h: number }> {
  const r = await page.evaluate(async ({ lines, type }) => {
    const c = document.createElement("canvas");
    c.width = 1400; c.height = 120 + lines.length * 90;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#111"; g.font = "56px Arial, sans-serif";
    lines.forEach((l, i) => g.fillText(l, 60, 110 + i * 90));
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), type, 0.95));
    return { data: Array.from(new Uint8Array(await blob.arrayBuffer())), w: c.width, h: c.height };
  }, { lines, type });
  return { bytes: Buffer.from(r.data), w: r.w, h: r.h };
}

/** A one-page PDF whose only content is a JPEG image (like a scan): no text layer. */
function imagePdf(jpeg: Buffer, w: number, h: number): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (b: Buffer | string) => { const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b; parts.push(buf); len += buf.length; };
  const obj = (n: number, body: (Buffer | string)[]) => { offsets[n] = len; push(`${n} 0 obj\n`); body.forEach(push); push("\nendobj\n"); };
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

test("recognises text in an uploaded image and a scanned PDF, offline, and search finds it", async ({ page }) => {
  test.setTimeout(150_000);
  const offline: string[] = [];
  page.on("request", (r) => { if (!/^(http:\/\/localhost|blob:|data:)/.test(r.url())) offline.push(r.url()); });
  await boot(page);
  await nav(page, "Files");

  const png = await textImage(page, ["Quarterly invoice 4821", "approved by finance"], "image/png");
  const jpg = await textImage(page, ["Warehouse inventory list", "pallets ninety seven"], "image/jpeg");
  await main(page).locator('input[type="file"]').setInputFiles([
    { name: "receipt.png", mimeType: "image/png", buffer: png.bytes },
    { name: "scan.pdf", mimeType: "application/pdf", buffer: imagePdf(jpg.bytes, jpg.w, jpg.h) },
  ]);

  // Both get recognised automatically
  const rowOf = (name: string) => main(page).locator("div.group", { hasText: name });
  await expect(rowOf("receipt.png").getByText("Searchable (OCR)")).toBeVisible({ timeout: 90_000 });
  await expect(rowOf("scan.pdf").getByText("Searchable (OCR)")).toBeVisible({ timeout: 90_000 });
  const atts = await idb<{ name: string; text?: string; ocr?: string }>(page, "attachments");
  expect(atts.find((a) => a.name === "receipt.png")?.text).toMatch(/invoice\s+4821/i);
  expect(atts.find((a) => a.name === "scan.pdf")?.text).toMatch(/inventory/i);

  // Search finds words from both
  await page.keyboard.press("Control+k");
  await page.keyboard.type("invoice 4821");
  await expect(page.getByRole("dialog").getByText("receipt.png")).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("warehouse pallets");
  await expect(page.getByRole("dialog").getByText("scan.pdf")).toBeVisible();
  await page.keyboard.press("Escape");

  // Manual re-run shows progress and finishes
  await rowOf("receipt.png").getByRole("button", { name: "Recognise again" }).click();
  await expect(page.getByText("Recognised text in receipt.png")).toBeVisible({ timeout: 60_000 });

  expect(offline).toEqual([]); // no CDN or other network use
  await noCrash(page);
});

test("automatic recognition can be turned off, and then runs on request", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Storage" }).click();
  await page.getByRole("switch", { name: "Automatic text recognition" }).click();
  await nav(page, "Files");
  const png = await textImage(page, ["Meeting room booked"], "image/png");
  await main(page).locator('input[type="file"]').setInputFiles([{ name: "note.png", mimeType: "image/png", buffer: png.bytes }]);
  const row = main(page).locator("div.group", { hasText: "note.png" });
  await expect(row.getByRole("button", { name: "Recognise text" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await idb<{ name: string; ocr?: string }>(page, "attachments")).find((a) => a.name === "note.png")?.ocr).toBeUndefined();
  await row.getByRole("button", { name: "Recognise text" }).click();
  await expect(row.getByText("Searchable (OCR)")).toBeVisible({ timeout: 60_000 });
  expect((await idb<{ name: string; text?: string }>(page, "attachments")).find((a) => a.name === "note.png")?.text).toMatch(/meeting room/i);
});
