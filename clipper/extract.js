// Runs inside the page being clipped (injected by the popup with chrome.scripting.executeScript).
// Returns { url, title, html, text, kind }. It must be self-contained: it is serialised and run in the page.
/* exported mindstoneExtract */
function mindstoneExtract(kind) {
  const DROP = "script,style,noscript,template,iframe,object,embed,form,input,button,select,textarea,nav,aside,footer,header,svg,canvas,dialog,[hidden],[aria-hidden=true]";
  const clean = (root) => {
    root.querySelectorAll(DROP).forEach((el) => el.remove());
    root.querySelectorAll("*").forEach((el) => {
      for (const a of [...el.attributes]) if (!["href", "src", "alt", "title", "colspan", "rowspan"].includes(a.name)) el.removeAttribute(a.name);
      if (el.hasAttribute("href")) { try { el.setAttribute("href", new URL(el.getAttribute("href"), location.href).href); } catch { el.removeAttribute("href"); } }
      if (el.hasAttribute("src")) { try { el.setAttribute("src", new URL(el.getAttribute("src"), location.href).href); } catch { el.remove(); } }
    });
    return root;
  };
  const textLen = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().length;
  let root;
  if (kind === "selection") {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return { error: "Select some text on the page first." };
    root = document.createElement("div");
    for (let i = 0; i < sel.rangeCount; i++) root.appendChild(sel.getRangeAt(i).cloneContents());
  } else if (kind === "article") {
    // The block with the most paragraph text: <article>, <main>, or the best-scoring container.
    const candidates = [...document.querySelectorAll("article, main, [role=main], .post, .entry-content, .article, #content, .content")];
    if (!candidates.length) candidates.push(...[...document.querySelectorAll("div, section")].filter((d) => d.querySelectorAll(":scope > p").length >= 2));
    const score = (el) => [...el.querySelectorAll("p")].reduce((a, p) => a + textLen(p), 0);
    const best = candidates.sort((a, b) => score(b) - score(a))[0] || document.body;
    root = best.cloneNode(true);
  } else root = document.body.cloneNode(true);
  clean(root);
  const html = root.innerHTML.trim();
  const text = (root.innerText || root.textContent || "").trim();
  if (!text && !root.querySelector("img")) return { error: "Nothing to clip on this page." };
  return { url: location.href, title: document.title || location.hostname, html, text, kind: kind === "selection" || kind === "article" ? kind : "page" };
}
