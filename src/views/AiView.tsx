import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Sparkles, Plus, Send, Square, Trash2, ListChecks, Database as DbIcon, Copy, CheckSquare, Check, Clock, Wand2, Undo2 } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { AiConversation, AiMessage, Citation } from "@/data/types";
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { activeProvider, chat, requiresCloudConsent } from "@/ai/client";
import { PROVIDER_LABELS } from "@/ai/providers";
import { contextBlock, indexWorkspace, retrieve } from "@/ai/rag";
import { groundedSources, parseTaskProposal, reminderAt, systemPrompt, type ProposedTask } from "@/ai/actions";
import { ACTIONS_PROMPT, applyChanges, databaseContext, pageRefs, planActions, stripActions, tasksContext, undoChanges, type ActionRefs, type Change } from "@/ai/agentActions";
import { confirmDialog, copyText, EmptyState } from "@/components/ui";
import { cx, fmtDate, relTime, uid } from "@/lib/util";
import { PRIORITY } from "./Tasks";

type Scope = "general" | "page" | "workspace" | "tasks";

/** Confirmation card for tasks the assistant proposed. Nothing is created until the user clicks. */
function TaskProposal({ tasks, message }: { tasks: ProposedTask[]; message?: AiMessage }) {
  const ws = useApp((s) => s.workspaceId)!;
  const [busy, setBusy] = useState(false);
  const applied = !!message?.appliedAt;
  const create = async () => {
    setBusy(true);
    try {
      for (const t of tasks) {
        await repo.createTask(ws, { title: t.title, dueDate: t.due, reminderAt: reminderAt(t), priority: t.priority, description: [t.notes, "Created from Mindstone Intelligence"].filter(Boolean).join("\n\n") });
      }
      if (message) await db().aiMessages.update(message.id, { appliedAt: Date.now() });
      useApp.getState().toast(`Created ${tasks.length} task${tasks.length === 1 ? "" : "s"}`, "success", { label: "View", run: () => useApp.getState().open({ kind: "tasks" }) });
    } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 rounded-lg border border-accent/40 bg-accent-soft p-3" role="group" aria-label="Proposed tasks">
      <div className="mb-2 flex items-center gap-2 text-ui font-medium"><CheckSquare size={15} className="text-accent" /> {applied ? "Tasks created" : `Proposed task${tasks.length === 1 ? "" : "s"}: review before creating`}</div>
      <ul className="space-y-1">
        {tasks.map((t, i) => (
          <li key={i} className="flex items-center gap-2 rounded-md bg-elev px-2 py-1.5 text-ui">
            <span className="flex-1">{t.title}</span>
            {t.priority !== "none" && <span className={cx("chip", `c-${PRIORITY[t.priority].color}`)}>{PRIORITY[t.priority].label}</span>}
            {t.due && <span className="text-meta text-muted">{fmtDate(t.due, { weekday: "short", month: "short", day: "numeric" })}</span>}
            {t.time && <span className="flex items-center gap-1 text-meta text-muted"><Clock size={12} />{t.time}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        {applied
          ? <span className="flex items-center gap-1 text-meta text-success"><Check size={14} /> Added to Tasks{tasks.some((t) => t.time) ? ", with reminders at the given times" : ""}.</span>
          : <button className="btn-primary" disabled={busy || !message} onClick={create}>Create {tasks.length} task{tasks.length === 1 ? "" : "s"}</button>}
        {!applied && tasks.some((t) => t.time) && <span className="text-meta text-faint">Tasks with a time get a reminder then.</span>}
      </div>
    </div>
  );
}

/** Review card for changes the assistant proposed: each with before and after; nothing changes until Apply. */
function ActionProposal({ raw, message }: { raw: unknown[]; message: AiMessage }) {
  const [plan, setPlan] = useState<{ changes: Change[]; skipped: number } | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { void planActions(raw, message.actionRefs ?? {}).then(setPlan); }, [raw, message.actionRefs, message.appliedAt, message.undoneAt]);
  if (!plan) return null;
  const applied = !!message.appliedAt && !message.undoneAt;
  const chosen = plan.changes.filter((c) => !off.has(c.key));
  const apply = async () => {
    setBusy(true);
    try {
      const undo = await applyChanges(chosen);
      await db().aiMessages.update(message.id, { appliedAt: Date.now(), undo, undoneAt: undefined });
      useApp.getState().toast(`Applied ${undo.length} change${undo.length === 1 ? "" : "s"}`, "success");
    } catch (e) { useApp.getState().toast(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true);
    try { await undoChanges(message.undo ?? []); await db().aiMessages.update(message.id, { undoneAt: Date.now(), undo: [] }); useApp.getState().toast("Changes undone", "info"); }
    finally { setBusy(false); }
  };
  if (!plan.changes.length && !applied) return <div className="mt-3 rounded-lg border border-line p-2 text-meta text-muted">The assistant proposed changes, but none matched items it was shown or valid values{plan.skipped ? ` (${plan.skipped} ignored)` : ""}.</div>;
  return (
    <div className="mt-3 rounded-lg border border-accent/40 bg-accent-soft p-3" role="group" aria-label="Proposed changes">
      <div className="mb-2 flex items-center gap-2 text-ui font-medium"><Wand2 size={15} className="text-accent" /> {applied ? "Changes applied" : `Proposed change${plan.changes.length === 1 ? "" : "s"}: review before applying`}</div>
      {!applied && <ul className="space-y-1">
        {plan.changes.map((c) => (
          <li key={c.key} className="flex items-start gap-2 rounded-md bg-elev px-2 py-1.5 text-ui" data-testid="proposed-change">
            <input type="checkbox" className="mt-1" aria-label={`Include: ${c.label}`} checked={!off.has(c.key)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(c.key); else n.add(c.key); return n; })} />
            <span className="min-w-0 flex-1"><span className="font-medium">{c.label}</span><span className="block text-meta"><span className="text-muted line-through decoration-danger/60">{c.before}</span> → <span className="text-success">{c.after}</span></span></span>
          </li>
        ))}
      </ul>}
      <div className="mt-2 flex items-center gap-2">
        {applied
          ? <><span className="flex items-center gap-1 text-meta text-success"><Check size={14} /> {message.undo?.length ?? 0} change{message.undo?.length === 1 ? "" : "s"} applied.</span><button className="btn-outline h-7" disabled={busy || !message.undo?.length} onClick={() => void undo()}><Undo2 size={13} /> Undo</button></>
          : <button className="btn-primary" disabled={busy || !chosen.length} onClick={() => void apply()}>Apply {chosen.length} change{chosen.length === 1 ? "" : "s"}</button>}
        {!applied && plan.skipped > 0 && <span className="text-meta text-faint">{plan.skipped} proposal{plan.skipped === 1 ? "" : "s"} ignored: unknown item or invalid value.</span>}
        {message.undoneAt && <span className="text-meta text-faint">Undone.</span>}
      </div>
    </div>
  );
}

function Markdown({ text, citations, message }: { text: string; citations: Citation[]; message?: AiMessage }) {
  const open = useApp((s) => s.open);
  const stripped = stripActions(text);
  const { display, tasks } = parseTaskProposal(stripped.display);
  const html = DOMPurify.sanitize(marked.parse(display, { async: false }) as string);
  // Show sources the reply cites or visibly draws on, so unrelated retrieval results don't look like evidence.
  const used = new Set(groundedSources(display, citations));
  const shown = citations.map((c, i) => ({ c, i })).filter(({ i }) => used.has(i));
  return (
    <div>
      <div className="rea-editor !pb-0 !text-body" dangerouslySetInnerHTML={{ __html: html }} />
      {tasks.length > 0 && <TaskProposal tasks={tasks} message={message} />}
      {stripped.raw && message && <ActionProposal raw={stripped.raw} message={message} />}
      {shown.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">{shown.map(({ c, i }) => <button key={i} className="chip c-blue" title={c.snippet} onClick={() => open(c.pageId ? { kind: "page", id: c.pageId } : { kind: "files" })}>[{i + 1}] {c.attachmentId ? "📎 " : ""}{c.title}</button>)}</div>
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
    let refs: ActionRefs | undefined;
    if (scope === "page" && pageId) {
      const page = await repo.getPage(pageId);
      if (page?.kind === "database" && page.databaseId) {
        const dc = await databaseContext(page.databaseId);
        if (dc) { context = dc.text; refs = dc.refs; citations = [{ pageId: page.id, title: page.title || "Untitled", snippet: "" }]; }
      } else if (page) {
        context = `${contextBlock([{ pageId: page.id, title: page.title || "Untitled", text: page.text.slice(0, 24000), score: 1 }]).text}\nThis page is P1; its tags: ${page.tags.join(", ") || "none"}.`;
        citations = [{ pageId: page.id, title: page.title || "Untitled", snippet: page.text.slice(0, 160) }];
        refs = pageRefs([page.id]);
      }
    } else if (scope === "tasks") {
      ({ text: context, refs } = await tasksContext(ws));
    } else if (scope === "workspace") {
      const chunks = await retrieve(ws, text);
      ({ text: context, citations } = contextBlock(chunks));
      const ids = [...new Set(citations.map((c) => c.pageId).filter(Boolean))];
      if (ids.length) { refs = pageRefs(ids); context += `\nPages you may tag: ${ids.map((id, i) => `P${i + 1} = ${JSON.stringify(citations.find((c) => c.pageId === id)?.title ?? "")}`).join(", ")}.`; }
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
      const system = refs ? `${systemPrompt()}\n\n${ACTIONS_PROMPT}` : systemPrompt();
      const res = await chat(system, [...history, { role: "user", content: context ? `${context}\n\nQuestion: ${text}` : text }], (t) => setStreaming((s) => s + t), abort.current.signal);
      await db().aiMessages.add({ id: uid(), conversationId: cid, role: "assistant", content: res.text, provider: res.provider, model: res.servedBy || res.model, citations, inputTokens: res.inputTokens, outputTokens: res.outputTokens, createdAt: Date.now(), ...(refs ? { actionRefs: refs } : {}) });
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
    for (const title of items) await repo.createTask(ws, { title, description: "Created from Mindstone Intelligence" });
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
              <button className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => setConvId(c.id)}><div className="truncate text-ui">{c.title}</div><div className="text-caption text-faint">{relTime(c.updatedAt)}</div></button>
              <button className="icon-btn mr-1 size-6 opacity-0 group-hover:opacity-100" aria-label="Delete conversation" onClick={async () => { await db().aiMessages.where("conversationId").equals(c.id).delete(); await db().aiConversations.delete(c.id); if (convId === c.id) setConvId(null); }}><Trash2 size={12} /></button>
            </div>
          ))}
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-meta">
          <select className="input h-7 w-auto" value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="Context">
            <option value="general">General chat</option>
            {pageId && <option value="page">This page</option>}
            <option value="workspace">Search my workspace</option>
            <option value="tasks">My tasks</option>
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
            <EmptyState icon={<Sparkles />} title="Mindstone Intelligence" body={p ? "Ask about your notes, draft content, or plan work. With “Search my workspace”, answers cite your pages." : "Connect Claude, OpenAI, Gemini or a local Ollama model in Settings → AI providers. Everything else in Mindstone works without AI."}
              action={!p && <button className="btn-primary" onClick={() => useApp.getState().open({ kind: "settings", sub: "ai" })}>Set up AI</button>} />
          )}
          <div className="mx-auto max-w-3xl space-y-4">
            {messages?.map((m) => (
              <div key={m.id} className={cx("group", m.role === "user" && "flex justify-end")}>
                {m.role === "user" ? <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-accent-soft px-3 py-2 text-body">{m.content}</div> : (
                  <div>
                    <Markdown text={m.content} citations={m.citations} message={m} />
                    <div className="mt-1 flex gap-1 text-caption text-faint opacity-0 group-hover:opacity-100">
                      <span className="mr-2">{m.model} · {m.inputTokens + m.outputTokens} tokens</span>
                      <button className="btn h-6" onClick={() => void copyText(m.content, "Answer copied")}><Copy size={12} /> Copy</button>
                      <button className="btn h-6" onClick={() => toPage(m)}><Plus size={12} /> Save as page</button>
                      <button className="btn h-6" onClick={() => toTasks(m)}><ListChecks size={12} /> Create tasks</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {streaming && <Markdown text={streaming} citations={[]} />}
            {busy && !streaming && <div className="skeleton h-4 w-40" />}
            {err && <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-ui text-danger">{err}</div>}
            <div ref={bottom} />
          </div>
        </div>
        <form className="border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea className="textarea max-h-40 min-h-10 flex-1" rows={1} placeholder="Ask Mindstone Intelligence…" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} aria-label="Message" />
            {busy ? <button type="button" className="btn-outline h-10" onClick={() => abort.current?.abort()}><Square size={14} /> Stop</button>
              : <button className="btn-primary h-10" disabled={!input.trim()} aria-label="Send" title="Send (Enter)"><Send size={14} /></button>}
          </div>
          {!compact && <div className="mx-auto mt-1.5 flex max-w-3xl flex-wrap gap-1">
            {["Summarize what I worked on this week", "Which notes look like duplicates?", "Suggest a project plan from my notes", "Turn my meeting notes into action items"].map((s) => <button type="button" key={s} className="btn h-6 text-meta text-muted" onClick={() => setInput(s)}>{s}</button>)}
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
