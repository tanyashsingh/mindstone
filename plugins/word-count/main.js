// Example Mindstone plugin. Runs in a sandbox; everything goes through the `mindstone` API.
const stats = (text) => {
  const words = (text.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
  return { words, chars: text.length, minutes: Math.max(1, Math.round(words / 230)) };
};

async function showPanel() {
  const page = await mindstone.pages.current();
  if (!page) return mindstone.panel.render("Open a page to see its word count.");
  const s = stats(page.text);
  await mindstone.panel.render(`**${page.title || "Untitled"}**\n\n- ${s.words.toLocaleString()} words\n- ${s.chars.toLocaleString()} characters\n- about ${s.minutes} min to read`, [{ id: "refresh", label: "Refresh" }]);
}

mindstone.panel.onButton("refresh", showPanel);
mindstone.on("pageChanged", showPanel);

mindstone.commands.register("count", "Word count of this page", async () => {
  const page = await mindstone.pages.current();
  if (!page) return mindstone.toast("Open a page first");
  const s = stats(page.text);
  await mindstone.toast(`${s.words} words, about ${s.minutes} min to read`);
});

mindstone.slash.register("insert-count", "Word count", async () => {
  const page = await mindstone.pages.current();
  return page ? `*Word count: ${stats(page.text).words}*` : "";
});

mindstone.commands.register("longest", "List my longest pages", async () => {
  const pages = await mindstone.pages.list();
  const full = await Promise.all(pages.slice(0, 200).map((p) => mindstone.pages.get(p.id)));
  const top = full.filter(Boolean).map((p) => ({ title: p.title || "Untitled", words: stats(p.text).words })).sort((a, b) => b.words - a.words).slice(0, 10);
  const id = await mindstone.pages.create("Longest pages", top.map((t, i) => `${i + 1}. ${t.title}: ${t.words} words`).join("\n"));
  await mindstone.toast(`Saved a list of ${top.length} pages`);
  return id;
});

void showPanel();
