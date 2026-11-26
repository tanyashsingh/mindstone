import { expect, test, type Page } from "@playwright/test";
import { boot, idb, main, noCrash } from "./helpers";

type PageRow = { id: string; title: string; parentId: string | null; text: string; tags: string[]; content: unknown; createdAt: number };

/** A Notion-style export: an outer .zip holding the real export .zip, built with the app's own ZIP writer. */
async function notionZip(page: Page): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async () => {
    const { makeZip } = await import(/* @vite-ignore */ String("/src/lib/zip.ts"));
    const enc = (x: string) => new TextEncoder().encode(x);
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const id = "0123456789abcdef0123456789abcdef", id2 = "fedcba9876543210fedcba9876543210";
    const inner = makeZip([
      { path: `Travel ${id}.md`, data: enc(`# Travel\n\nPlans for the year. See [Lisbon](Travel%20${id}/Lisbon%20${id2}.md).\n\n![map](Travel%20${id}/map.png)`) },
      { path: `Travel ${id}/Lisbon ${id2}.md`, data: enc("# Lisbon\n\nVisit the CASTELO-77 in spring.") },
      { path: `Travel ${id}/map.png`, data: png },
      { path: `Travel ${id}/Budget ${id2}.csv`, data: enc("Item,Cost\nHotel,400\nFlights,250") },
      { path: `Travel ${id}/Budget ${id2}_all.csv`, data: enc("Item,Cost\nHotel,400\nFlights,250") },
    ]);
    const outer = makeZip([{ path: "Export-Part-1.zip", data: new Uint8Array(await inner.arrayBuffer()) }]);
    return [...new Uint8Array(await outer.arrayBuffer())];
  }));
}

async function importVia(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.keyboard.press("Control+,");
  await main(page).getByRole("button", { name: "Import & export" }).click();
  await main(page).locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles(files);
}

test("Notion export .zip: nested pages, page-and-folder pairs, links, images and databases", async ({ page }) => {
  await boot(page);
  const zip = await notionZip(page);
  await importVia(page, [{ name: "Notion Export.zip", mimeType: "application/zip", buffer: zip }]);
  await expect(page.getByText(/^Imported [0-9]+ pages/).first()).toBeVisible({ timeout: 20_000 });

  const pages = await idb<PageRow>(page, "pages");
  const travel = pages.filter((p) => p.title === "Travel");
  expect(travel).toHaveLength(1); // the .md and its folder became one page
  const lisbon = pages.find((p) => p.title === "Lisbon")!;
  expect(lisbon.parentId).toBe(travel[0]!.id);
  expect(lisbon.text).toContain("CASTELO-77");
  expect(travel[0]!.text).toContain("[[Lisbon]]"); // the Notion link became a wiki link
  expect(JSON.stringify(travel[0]!.content)).toContain('"attachment"'); // the image is shown in place
  const links = await idb<{ fromPageId: string; toPageId: string }>(page, "links");
  expect(links.some((l) => l.fromPageId === travel[0]!.id && l.toPageId === lisbon.id)).toBe(true);
  const dbs = await idb<{ name: string }>(page, "databases");
  expect(dbs.map((d) => d.name)).toEqual(["Budget"]); // the duplicate _all.csv was skipped
  await noCrash(page);
});

test("Evernote .enex: notes with tags, dates, checklists and images", async ({ page }) => {
  await boot(page);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const hash = await page.evaluate(async (b) => { const { md5 } = await import(/* @vite-ignore */ String("/src/data/importers.ts")); return md5(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))); }, png);
  const enex = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export>
  <note><title>Garden log</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><en-note><div>Planted TULIP-31 bulbs.</div><div><en-todo checked="true"/>Water them</div><div><en-todo checked="false"/>Add mulch</div><en-media hash="${hash}" type="image/png"/></en-note>]]></content>
    <created>20240315T081500Z</created><updated>20240316T090000Z</updated>
    <tag>Garden</tag><tag>Spring jobs</tag>
    <resource><data encoding="base64">${png}</data><mime>image/png</mime><resource-attributes><file-name>bed.png</file-name></resource-attributes></resource>
  </note>
  <note><title>Second note</title><content><![CDATA[<en-note><p>Hello</p></en-note>]]></content><created>20240101T000000Z</created></note>
</en-export>`;
  await importVia(page, [{ name: "Home notebook.enex", mimeType: "application/xml", buffer: Buffer.from(enex) }]);
  await expect(page.getByText(/^Imported [0-9]+ pages/).first()).toBeVisible({ timeout: 20_000 });
  const pages = await idb<PageRow>(page, "pages");
  const nb = pages.find((p) => p.title === "Home notebook")!;
  const note = pages.find((p) => p.title === "Garden log")!;
  expect(note.parentId).toBe(nb.id);
  expect(note.text).toContain("TULIP-31");
  expect(note.tags).toEqual(expect.arrayContaining(["garden", "spring-jobs"]));
  expect(new Date(note.createdAt).toISOString()).toBe("2024-03-15T08:15:00.000Z");
  const json = JSON.stringify(note.content);
  expect(json).toContain('"taskItem"');
  expect(json).toMatch(/"checked":true[\s\S]*Water them|Water them[\s\S]*"checked":true/);
  expect(json).toContain('"attachment"');
  const atts = await idb<{ name: string; pageId: string }>(page, "attachments");
  expect(atts.find((a) => a.name === "bed.png")?.pageId).toBe(note.id);
  expect(pages.some((p) => p.title === "Second note")).toBe(true);
});

test("Todoist CSV: project, priorities, labels, sections, subtasks, dates and repeats", async ({ page }) => {
  await boot(page);
  const csv = [
    "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE",
    "section,Errands,,,,,,,,",
    "task,Buy paint @hardware,Satin white,4,1,me,,2026-12-05,en,",
    "task,Check colours,,1,2,me,,,en,",
    "note,Bring the swatch,,,,,,,,",
    "task,Take out recycling,,2,1,me,,every monday,en,",
  ].join("\n");
  await importVia(page, [{ name: "Home Projects.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/^Imported [0-9]+ pages/).first()).toBeVisible({ timeout: 20_000 });
  const projects = await idb<{ id: string; name: string }>(page, "projects");
  const proj = projects.find((p) => p.name === "Home Projects")!;
  const tasks = await idb<{ id: string; title: string; projectId: string; priority: string; tags: string[]; dueDate: string | null; parentTaskId: string | null; description: string; recurrence: unknown }>(page, "tasks");
  const paint = tasks.find((t) => t.title === "Buy paint")!;
  expect(paint).toMatchObject({ projectId: proj.id, priority: "urgent", dueDate: "2026-12-05", description: "Satin white" });
  expect(paint.tags.sort()).toEqual(["errands", "hardware"]);
  const sub = tasks.find((t) => t.title === "Check colours")!;
  expect(sub.parentTaskId).toBe(paint.id);
  expect(sub.description).toContain("Bring the swatch");
  expect(tasks.find((t) => t.title === "Take out recycling")!.recurrence).toEqual({ freq: "weekly", interval: 1, byDay: ["MO"] });
  expect((await idb(page, "databases")).length).toBe(0); // not imported as a plain table
});

test("a Markdown folder (Obsidian, Apple Notes or Bear export) keeps its images", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+,");
  await main(page).getByRole("button", { name: "Import & export" }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.evaluate(async (pngB64) => {
    const { importFiles } = await import(/* @vite-ignore */ String("/src/data/portability.ts"));
    const { useApp } = await import(/* @vite-ignore */ String("/src/store/app.ts"));
    const mk = (path: string, data: BlobPart, type: string) => { const f = new File([data], path.split("/").pop()!, { type }); Object.defineProperty(f, "webkitRelativePath", { value: path }); return f; };
    const png = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0));
    await importFiles(useApp.getState().workspaceId as string, [
      mk("Notes/Recipes/Pancakes.md", "# Pancakes\n\nMix FLOUR-88 and milk.\n\n![[photo.png]]\n\n![](../attachments/side.png)", "text/markdown"),
      mk("Notes/Recipes/photo.png", png, "image/png"),
      mk("Notes/attachments/side.png", png, "image/png"),
      mk("Notes/attachments/unused.png", png, "image/png"),
    ]);
  }, png.toString("base64"));
  const pages = await idb<PageRow>(page, "pages");
  const pancakes = pages.find((p) => p.title === "Pancakes")!;
  expect(pancakes.text).toContain("FLOUR-88");
  expect((JSON.stringify(pancakes.content).match(/"attachment"/g) ?? []).length).toBe(2);
  expect(pages.find((p) => p.title === "Recipes")!.id).toBe(pancakes.parentId);
  expect(pages.some((p) => p.title === "Imported files")).toBe(true); // the unused image is kept and findable
});
