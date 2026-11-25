import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Sparkles, Plus, Send, Square, Trash2, ListChecks, Database as DbIcon, Copy } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { AiConversation, AiMessage, Citation } from "@/data/types";
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { activeProvider, chat, requiresCloudConsent } from "@/ai/client";
import { PROVIDER_LABELS } from "@/ai/providers";
import { SYSTEM_PROMPT, contextBlock, indexWorkspace, retrieve } from "@/ai/rag";
import { confirmDialog, EmptyState } from "@/components/ui";
import { cx, relTime, uid } from "@/lib/util";

type Scope = "general" | "page" | "workspace";

function Markdown({ text, citations }: { text: string; citations: Citation[] }) {
  const open = useApp((s) => s.open);
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  return (
    <div>
      <div className="rea-editor !pb-0 !text-[14px]" dangerouslySetInnerHTML={{ __html: html }} />
      {citations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">{citations.map((c, i) => <button key={i} className="chip c-blue" title={c.snippet} onClick={() => open({ kind: "page", id: c.pageId })}>[{i + 1}] {c.title}</button>)}</div>
      )}
    </div>
  );
}

/** Lines that look like action items: "- [ ] x", "- x", "1. x". */
export function extractActionItems(text: string): string[] {
  return text.split("\n").map((l) => l.match(/^\s*(?:[-*]\s*\[\s?\]\s*|[-*]\s+|\d+\.\s+)(.+)$/)?.[1]?.trim()).filter((x): x is string => !!x && x.length > 2 && x.length < 200);
}

export function AiChat({ compact = false, pageId }: { compact?: boolean; pageId?: string }) {
  const ws = useApp((s) => s.workspaceId)!;
  const [convId, setConvId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>(pageId ? "page" : "workspace");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const convs = useLiveQuery(() => db().aiConversations.where("workspaceId").equals(ws).reverse().sortBy("updatedAt"), [ws]);
  const messages = useLiveQuery(() => (convId ? db().aiMessages.where("conversationId").equals(convId).sortBy("createdAt") : Promise.resolve([] as AiMessage[])), [convId]);
  const usage = useLiveQuery(async () => {
    const all = await db().aiMessages.toArray();
    return all.reduce((a, m) => ({ i: a.i + m.inputTokens, o: a.o + m.outputTokens }), { i: 0, o: 0 });
  }, [messages]);
  const p = activeProvider();
  useEffect(() => { void bottom.current?.scrollIntoView({ block: "end" }); }, [messages, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr("");
    if (!p) return setErr("No AI provider is enabled. Open Settings → AI providers.");
    if (requiresCloudConsent()) return setErr(`Cloud AI is off. Allow it in Settings → AI to send content to ${PROVIDER_LABELS[p.id]}, or choose a local model.`);
    let context = "", citations: Citation[] = [];
    if (scope === "page" && pageId) {
      const page = await repo.getPage(pageId);
      if (page) { context = contextBlock([{ pageId: page.id, title: page.title || "Untitled", text: page.text.slice(0, 24000), score: 1 }]).text; citations = [{ pageId: page.id, title: page.title || "Untitled", snippet: page.text.slice(0, 160) }]; }
    } else if (scope === "workspace") {
      const chunks = await retrieve(ws, text);
      ({ text: context, citations } = contextBlock(chunks));
    }
    if (context && !p.isLocal && useSettingsConfirm()) {
      const ok = await confirmDialog(`Send workspace content to ${PROVIDER_LABELS[p.id]}?`, `${citations.length} source excerpt(s) (${context.length.toLocaleString()} characters) from your workspace will be sent with your question. Turn this prompt off in Settings → AI.`);
      if (!ok) return;
    }
    let cid = convId;
    if (!cid) {
      const c: AiConversation = { id: uid(), workspaceId: ws, title: text.slice(0, 60), pageId: pageId ?? null, createdAt: Date.now(), updatedAt: Date.now() };
      await db().aiConversations.add(c);
      cid = c.id;
      setConvId(cid);
    }
    const history = (messages ?? []).filter((m) => m.role !== "system").slice(-12).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    await db().aiMessages.add({ id: uid(), conversationId: cid, role: "user", content: text, provider: p.id, model: p.cfg.model, citations: [], inputTokens: 0, outputTokens: 0, createdAt: Date.now() });
    setInput(""); setBusy(true); setStreaming("");
    abort.current = new AbortController();
    try {
      const res = await chat(SYSTEM_PROMPT, [...history, { role: "user", content: context ? `${context}\n\nQuestion: ${text}` : text }], (t) => setStreaming((s) => s + t), abort.current.signal);
      await db().aiMessages.add({ id: uid(), conversationId: cid, role: "assistant", content: res.text, provider: res.provider, model: res.servedBy || res.model, citations, inputTokens: res.inputTokens, outputTokens: res.outputTokens, createdAt: Date.now() });
      await db().aiConversations.update(cid, { updatedAt: Date.now() });
      await repo.logActivity(ws, "ai", cid, "asked", text.slice(0, 80));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); setStreaming(""); }
  };

  const toTasks = async (m: AiMessage) => {
    const items = extractActionItems(m.content);
    if (!items.length) return useApp.getState().toast("No list items found in this reply", "error");
    if (!(await confirmDialog(`Create ${items.length} tasks?`, items.map((i) => `• ${i}`).join("\n")))) return;
    for (const title of items) await repo.createTask(ws, { title, description: "Created from REA Intelligence" });
    useApp.getState().toast(`${items.length} tasks created`, "success");
  };
  const toPage = async (m: AiMessage) => {
    const { markdownToDoc } = await import("@/data/portability");
    const page = await repo.createPage(ws, pageId ?? null, { title: `AI: ${m.content.split("\n")[0]!.replace(/^#+\s*/, "").slice(0, 60)}`, icon: "✨", content: markdownToDoc(m.content) });
    useApp.getState().open({ kind: "page", id: page.id });
  };

  return (
    <div className={cx("flex h-full min-h-0", compact && "flex-col")}>
      {!compact && (
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-line p-2">
          <button className="btn-outline mb-2 w-full justify-center" onClick={() => setConvId(null)}><Plus size={14} /> New chat</button>
          {convs?.map((c) => (
            <div key={c.id} className={cx("group flex items-center rounded-md hover:bg-hover", convId === c.id && "bg-active")}>
              <button className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => setConvId(c.id)}><div className="truncate text-[13px]">{c.title}</div><div className="text-[11px] text-faint">{relTime(c.updatedAt)}</div></button>
              <button className="icon-btn mr-1 size-6 opacity-0 group-hover:opacity-100" aria-label="Delete conversation" onClick={async () => { await db().aiMessages.where("conversationId").equals(c.id).delete(); await db().aiConversations.delete(c.id); if (convId === c.id) setConvId(null); }}><Trash2 size={12} /></button>
            </div>
          ))}
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12.5px]">
          <select className="input h-7 w-auto" value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="Context">
            <option value="general">General chat</option>
            {pageId && <option value="page">This page</option>}
            <option value="workspace">Search my workspace</option>
          </select>
          <span className="flex-1 truncate text-faint">{p ? `${PROVIDER_LABELS[p.id]} · ${p.cfg.model}${p.isLocal ? " · stays on this device" : " · sent over the internet"}` : "AI is off"}</span>
          {!compact && usage && <span className="text-faint" title="Token usage reported by providers">{(usage.i + usage.o).toLocaleString()} tokens used</span>}
          {!compact && <button className="btn h-7" title="Build or refresh semantic search embeddings" onClick={async () => {
            try { const n = await indexWorkspace(ws); useApp.getState().toast(n ? `Indexed ${n} pages for semantic search` : "Nothing to index, or embeddings unavailable for this provider", "info"); }
            catch (e) { useApp.getState().toast(e instanceof Error ? e.message : String(e), "error"); }
          }}><DbIcon size={13} /> Index</button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!messages?.length && !streaming && (
            <EmptyState icon={<Sparkles />} title="REA Intelligence" body={p ? "Ask about your notes, draft content, or plan work. With “Search my workspace”, answers cite your pages." : "Connect Claude, OpenAI, Gemini or a local Ollama model in Settings → AI providers. Everything else in REA works without AI."}
              action={!p && <button className="btn-primary" onClick={() => useApp.getState().open({ kind: "settings", sub: "ai" })}>Set up AI</button>} />
          )}
          <div className="mx-auto max-w-3xl space-y-4">
            {messages?.map((m) => (
              <div key={m.id} className={cx("group", m.role === "user" && "flex justify-end")}>
                {m.role === "user" ? <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-accent-soft px-3 py-2 text-[14px]">{m.content}</div> : (
                  <div>
                    <Markdown text={m.content} citations={m.citations} />
                    <div className="mt-1 flex gap-1 text-[11.5px] text-faint opacity-0 group-hover:opacity-100">
                      <span className="mr-2">{m.model} · {m.inputTokens + m.outputTokens} tokens</span>
                      <button className="btn h-6" onClick={() => void navigator.clipboard.writeText(m.content)}><Copy size={12} /> Copy</button>
                      <button className="btn h-6" onClick={() => toPage(m)}><Plus size={12} /> Save as page</button>
                      <button className="btn h-6" onClick={() => toTasks(m)}><ListChecks size={12} /> Create tasks</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {streaming && <Markdown text={streaming} citations={[]} />}
            {busy && !streaming && <div className="skeleton h-4 w-40" />}
            {err && <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
            <div ref={bottom} />
          </div>
        </div>
        <form className="border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea className="textarea max-h-40 min-h-10 flex-1" rows={1} placeholder="Ask REA Intelligence…" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} aria-label="Message" />
            {busy ? <button type="button" className="btn-outline h-10" onClick={() => abort.current?.abort()}><Square size={14} /> Stop</button>
              : <button className="btn-primary h-10" disabled={!input.trim()}><Send size={14} /></button>}
          </div>
          {!compact && <div className="mx-auto mt-1.5 flex max-w-3xl flex-wrap gap-1">
            {["Summarize what I worked on this week", "Which notes look like duplicates?", "Suggest a project plan from my notes", "Turn my meeting notes into action items"].map((s) => <button type="button" key={s} className="btn h-6 text-[12px] text-muted" onClick={() => setInput(s)}>{s}</button>)}
          </div>}
        </form>
      </div>
    </div>
  );
}

function useSettingsConfirm() { return useSettings.getState().s.ai.confirmWorkspaceContext; }

export default function AiView() {
  return <div className="h-full"><AiChat /></div>;
}
