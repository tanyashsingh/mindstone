import { expect, test } from "@playwright/test";
import path from "node:path";
import { boot, idb, noCrash } from "./helpers";

const ARTICLE = `<!doctype html><html><head><title>How bees navigate</title></head><body>
  <header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
  <aside>Subscribe to our newsletter! ADVERT-TEXT</aside>
  <article>
    <h1>How bees navigate</h1>
    <p>Honeybees use the sun as a compass, correcting for its movement through the day. KEYWORD-POLARIS</p>
    <p>They also read polarised light patterns in the sky, which stay visible even when clouds hide the sun.</p>
    <p>Read the <a href="/research/waggle">waggle dance study</a>. <img src="/img/bee.png" alt="A bee"></p>
    <script>window.evil = 1</script><form><input value="secret"></form>
  </article>
  <footer>Copyright FOOTER-TEXT</footer>
</body></html>`;

test("the extension's page reader picks the article, a selection or the page, and cleans it", async ({ page }) => {
  await page.route("https://bees.example/**", (r) => r.fulfill({ contentType: "text/html", body: ARTICLE }));
  await page.goto("https://bees.example/story");
  await page.addScriptTag({ path: path.join(process.cwd(), "clipper", "extract.js") });
  const article = await page.evaluate(() => (window as unknown as { mindstoneExtract: (k: string) => { html: string; text: string; title: string; url: string; kind: string } }).mindstoneExtract("article"));
  expect(article).toMatchObject({ url: "https://bees.example/story", title: "How bees navigate", kind: "article" });
  expect(article.text).toContain("KEYWORD-POLARIS");
  for (const junk of ["ADVERT-TEXT", "FOOTER-TEXT", "<script", "<form", "secret", "Home"]) expect(article.html).not.toContain(junk);
  expect(article.html).toContain('href="https://bees.example/research/waggle"'); // links made absolute
  expect(article.html).toContain('src="https://bees.example/img/bee.png"');

  const none = await page.evaluate(() => (window as unknown as { mindstoneExtract: (k: string) => { error?: string } }).mindstoneExtract("selection"));
  expect(none.error).toMatch(/Select some text/);
  await page.evaluate(() => { const p = document.querySelectorAll("article p")[1]!; const r = document.createRange(); r.selectNodeContents(p); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); });
  const sel = await page.evaluate(() => (window as unknown as { mindstoneExtract: (k: string) => { text: string; kind: string } }).mindstoneExtract("selection"));
  expect(sel.kind).toBe("selection");
  expect(sel.text).toMatch(/^They also read polarised light/);
  expect(sel.text).not.toContain("POLARIS");

  const whole = await page.evaluate(() => (window as unknown as { mindstoneExtract: (k: string) => { text: string; html: string } }).mindstoneExtract("page"));
  expect(whole.text).toContain("KEYWORD-POLARIS");
  expect(whole.html).not.toContain("<script");
});

test("a received clip becomes a searchable page under Web clips", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const { saveClip } = await import(/* @vite-ignore */ String("/src/lib/clips.ts"));
    await saveClip({ url: "https://bees.example/story", title: "How bees navigate", html: "<h1>How bees navigate</h1><p>Sun compass KEYWORD-POLARIS</p><img src='x' onerror='window.pwned=1'>", text: "", kind: "article" });
  });
  await expect(page.getByText("Clipped “How bees navigate”")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined(); // sanitised
  const pages = await idb<{ id: string; title: string; parentId: string | null; text: string; tags: string[] }>(page, "pages");
  const parent = pages.find((p) => p.title === "Web clips")!;
  const clip = pages.find((p) => p.title === "How bees navigate")!;
  expect(clip.parentId).toBe(parent.id);
  expect(clip.text).toContain("KEYWORD-POLARIS");
  expect(clip.tags).toContain("clip");
  await page.getByRole("button", { name: "Open", exact: true }).click(); // from the toast
  await expect(page.locator(".rea-editor")).toContainText("Article clipped from bees.example");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("polaris");
  await expect(page.getByRole("dialog").getByRole("option").first()).toContainText("How bees navigate");
  await page.keyboard.press("Escape");
  await noCrash(page);
});
