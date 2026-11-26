/* global chrome, mindstoneExtract */
const $ = (id) => document.getElementById(id);
const status = (msg, cls = "") => { $("status").textContent = msg; $("status").className = cls; };

async function settings() {
  const s = await chrome.storage.local.get({ code: "", port: "43117" });
  return { code: String(s.code).trim(), port: Number(s.port) || 43117 };
}

async function call(path, body) {
  const { code, port } = await settings();
  if (!code) { $("setup").open = true; throw new Error("Enter the pairing code from Mindstone first."); }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${code}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error("Mindstone isn't reachable. Open the desktop app and turn on the web clipper in Settings → Integrations."); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("The pairing code doesn't match. Copy it again from Mindstone.");
  if (!res.ok) throw new Error(data.error || `Mindstone answered ${res.status}`);
  return data;
}

async function clip(kind) {
  status("Clipping…");
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Only web pages can be clipped.");
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: mindstoneExtract, args: [kind] });
    if (!result || result.error) throw new Error(result?.error || "Couldn't read this page.");
    await call("/clip", result);
    status("Saved to Mindstone ✓", "ok");
    setTimeout(() => window.close(), 900);
  } catch (e) {
    status(e.message, "err");
  } finally {
    for (const b of document.querySelectorAll("button")) b.disabled = false;
  }
}

$("article").onclick = () => clip("article");
$("selection").onclick = () => clip("selection");
$("page").onclick = () => clip("page");
$("save").onclick = async () => {
  await chrome.storage.local.set({ code: $("code").value.trim(), port: $("port").value.trim() || "43117" });
  try { await call("/ping"); status("Connected to Mindstone ✓", "ok"); } catch (e) { status(e.message, "err"); }
};
settings().then((s) => { $("code").value = s.code; $("port").value = String(s.port); if (!s.code) $("setup").open = true; });
