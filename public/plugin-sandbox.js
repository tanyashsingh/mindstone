// Runs inside the plugin sandbox. Receives the plugin's code from Mindstone, gives it the `mindstone` API (which
// forwards every call to Mindstone over postMessage) and runs it. Nothing here can reach Mindstone's page directly.
(() => {
  const host = window.parent;
  let seq = 0;
  const pending = new Map();
  const handlers = { command: new Map(), slash: new Map(), panel: new Map() };
  const listeners = new Map();
  const post = (m) => host.postMessage(m, "*");
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const callId = ++seq;
    pending.set(callId, { resolve, reject });
    post({ type: "call", callId, method, args });
  });
  const register = (kind, id, label, fn) => {
    if (typeof id !== "string" || typeof fn !== "function") throw new Error("register(id, label, handler)");
    handlers[kind].set(id, fn);
    post({ type: "register", kind, id, label: String(label ?? id).slice(0, 80) });
  };

  const mindstone = Object.freeze({
    commands: Object.freeze({ register: (id, label, fn) => register("command", id, label, fn) }),
    slash: Object.freeze({ register: (id, title, fn) => register("slash", id, title, fn) }),
    panel: Object.freeze({
      /** Shows Markdown in the plugin's panel; buttons call handlers registered with panel.onButton. */
      render: (markdown, buttons = []) => call("panel.render", String(markdown), buttons.map((b) => ({ id: String(b.id), label: String(b.label) }))),
      onButton: (id, fn) => handlers.panel.set(String(id), fn),
    }),
    pages: Object.freeze({
      current: () => call("pages.current"),
      get: (id) => call("pages.get", id),
      list: () => call("pages.list"),
      search: (q) => call("pages.search", q),
      create: (title, markdown) => call("pages.create", title, markdown),
      append: (id, markdown) => call("pages.append", id, markdown),
    }),
    tasks: Object.freeze({
      list: () => call("tasks.list"),
      create: (task) => call("tasks.create", task),
    }),
    toast: (text) => call("toast", String(text)),
    on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); },
  });

  window.addEventListener("message", async (e) => {
    if (e.source !== host) return;
    const m = e.data || {};
    if (m.type === "init") {
      self.mindstone = mindstone;
      // A module, so plugins can use top-level await. Modules are always strict.
      const url = URL.createObjectURL(new Blob([`${m.code}\n//# sourceURL=plugin:${m.id}`], { type: "text/javascript" }));
      const s = document.createElement("script");
      s.type = "module";
      s.src = url;
      s.onload = () => post({ type: "ready" });
      s.onerror = () => post({ type: "error", message: "The plugin's code could not be loaded" });
      document.body.appendChild(s);
    } else if (m.type === "result") {
      const p = pending.get(m.callId);
      if (!p) return;
      pending.delete(m.callId);
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error));
    } else if (m.type === "invoke") {
      const fn = handlers[m.kind]?.get(m.id);
      try {
        if (!fn) throw new Error(`No handler for ${m.kind} ${m.id}`);
        const value = await fn(m.context);
        post({ type: "return", callId: m.callId, ok: true, value: value === undefined ? null : value });
      } catch (err) { post({ type: "return", callId: m.callId, ok: false, error: String(err && err.message || err) }); }
    } else if (m.type === "event") {
      for (const fn of listeners.get(m.name) || []) { try { fn(m.data); } catch { /* a listener's own error */ } }
    }
  });
  window.addEventListener("error", (e) => post({ type: "error", message: String(e.message) }));
  post({ type: "loaded" });
})();
