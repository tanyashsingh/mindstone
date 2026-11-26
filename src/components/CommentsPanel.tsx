/** Right-panel tab: comment threads on the page's text, page-level comments, and pending suggestions. */
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, CheckCheck, RotateCcw, Trash2, X } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { Comment, Page } from "@/data/types";
import { liveEditors, removeCommentMarks, resolveSuggestions, suggestionsIn, takePendingThread } from "@/editor/review";
import { confirmDialog } from "./ui";
import { cx, relTime, uid } from "@/lib/util";

const threadOf = (c: Comment) => c.threadId ?? c.id;

export function CommentsPanel({ page }: { page: Page }) {
  const comments = useLiveQuery(() => db().comments.where("pageId").equals(page.id).sortBy("createdAt"), [page.id], []);
  const [focus, setFocus] = useState<string | null>(takePendingThread);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const on = (e: Event) => { takePendingThread(); setFocus(String((e as CustomEvent).detail)); };
    addEventListener("cairn:focus-thread", on);
    return () => removeEventListener("cairn:focus-thread", on);
  }, []);
  useEffect(() => { if (focus) document.getElementById(`thread-${focus}`)?.scrollIntoView({ block: "nearest" }); }, [focus, comments.length]);

  const roots = comments.filter((c) => !c.parentId);
  const replies = (t: string) => comments.filter((c) => c.parentId && threadOf(c) === t);
  const open = roots.filter((r) => !r.resolved);
  const visible = showResolved ? roots : roots.filter((r) => !r.resolved || threadOf(r) === focus); // a focused thread shows even when resolved
  const suggestions = suggestionsIn(page.content);
  const editor = liveEditors.get(page.id);

  const deleteThread = async (root: Comment) => {
    if (!(await confirmDialog("Delete this comment thread?", "The comment and its replies are deleted. This cannot be undone.", { danger: true, confirmLabel: "Delete" }))) return;
    await db().comments.where("threadId").equals(threadOf(root)).delete();
    await db().comments.delete(root.id);
    const ed = liveEditors.get(page.id);
    if (ed) removeCommentMarks(ed, threadOf(root));
  };

  return (
    <div>
      {suggestions.length > 0 && (
        <section className="mb-4" aria-label="Suggestions">
          <div className="mb-1.5 flex items-center gap-1">
            <span className="label flex-1">Suggestions ({suggestions.length})</span>
            <button className="btn h-6 px-1.5 text-[12px]" disabled={!editor} onClick={() => editor && resolveSuggestions(editor, null, true)}><CheckCheck size={13} /> Accept all</button>
            <button className="btn h-6 px-1.5 text-[12px]" disabled={!editor} onClick={() => editor && resolveSuggestions(editor, null, false)}><X size={13} /> Reject all</button>
          </div>
          {suggestions.map((s) => (
            <div key={`${s.kind}:${s.id}`} className="mb-1.5 rounded-md border border-line bg-elev p-2" data-testid="suggestion">
              <div className="mb-1 text-[11.5px] text-faint">{s.author} {s.kind === "insertion" ? "added" : "removed"} · {relTime(s.at)}</div>
              <div className={cx("line-clamp-3", s.kind === "insertion" ? "sugg-ins" : "sugg-del")}>{s.text}</div>
              <div className="mt-1.5 flex gap-1">
                <button className="btn h-6 px-1.5 text-[12px]" aria-label={`Accept: ${s.text}`} disabled={!editor} onClick={() => editor && resolveSuggestions(editor, s.id, true)}><Check size={13} /> Accept</button>
                <button className="btn h-6 px-1.5 text-[12px]" aria-label={`Reject: ${s.text}`} disabled={!editor} onClick={() => editor && resolveSuggestions(editor, s.id, false)}><X size={13} /> Reject</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="mb-2 flex items-center text-[11.5px] text-faint">
        <span className="flex-1">{open.length} open · stored on this device. Select text and press Ctrl+Alt+M to comment on it.</span>
      </div>
      {roots.length > open.length && (
        <label className="mb-2 flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved ({roots.length - open.length})</label>
      )}
      {visible.map((root) => {
        const t = threadOf(root);
        return (
          <div key={root.id} id={`thread-${t}`} data-testid="comment-thread" className={cx("mb-2 rounded-md border bg-elev p-2", focus === t ? "border-accent" : "border-line", root.resolved && "opacity-60")}
            onClick={() => { setFocus(t); if (root.anchorText) window.dispatchEvent(new CustomEvent("cairn:scroll-thread", { detail: t })); }}>
            {root.anchorText && <div className="mb-1 line-clamp-2 border-l-2 border-accent/40 pl-1.5 text-[12px] italic text-muted">{root.anchorText}</div>}
            {[root, ...replies(t)].map((c) => (
              <div key={c.id} className={cx(c.parentId && "mt-1.5 border-t border-line pt-1.5")}>
                <div className="flex text-[11.5px] text-faint"><span className="flex-1">{c.author} · {relTime(c.createdAt)}</span>
                  {c.parentId && <button className="hover:text-danger" aria-label="Delete reply" onClick={(e) => { e.stopPropagation(); void db().comments.delete(c.id); }}><X size={12} /></button>}
                </div>
                <div className="whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <ReplyBox onSend={(body) => db().comments.add({ id: uid(), pageId: page.id, threadId: t, parentId: root.id, anchorText: "", body, author: "You", resolved: 0, createdAt: Date.now() })} />
              <button className="icon-btn size-7" aria-label={root.resolved ? "Reopen thread" : "Resolve thread"} title={root.resolved ? "Reopen" : "Resolve"}
                onClick={() => { if (!root.resolved && focus === t) setFocus(null); void db().comments.update(root.id, { resolved: root.resolved ? 0 : 1 }); }}>{root.resolved ? <RotateCcw size={14} /> : <Check size={14} />}</button>
              <button className="icon-btn size-7 hover:text-danger" aria-label="Delete thread" title="Delete thread" onClick={() => void deleteThread(root)}><Trash2 size={14} /></button>
            </div>
          </div>
        );
      })}
      {visible.length === 0 && <div className="mb-3 text-faint">No comments yet.</div>}

      <form className="mt-3" onSubmit={async (e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        const id = uid();
        await db().comments.add({ id, pageId: page.id, threadId: id, parentId: null, anchorText: "", body: draft.trim(), author: "You", resolved: 0, createdAt: Date.now() });
        setDraft("");
      }}>
        <textarea className="textarea" rows={2} aria-label="Comment on this page" placeholder="Comment on the whole page" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
        <button className="btn-primary mt-1">Comment</button>
      </form>
      <SuggestToggle page={page} />
    </div>
  );
}

function ReplyBox({ onSend }: { onSend: (body: string) => unknown }) {
  const [v, setV] = useState("");
  return (
    <input className="input h-7 flex-1 text-[12.5px]" aria-label="Reply" placeholder="Reply…" value={v} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { void onSend(v.trim()); setV(""); } }} />
  );
}

function SuggestToggle({ page }: { page: Page }) {
  return (
    <label className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-[12.5px]">
      <input type="checkbox" checked={!!page.suggesting} disabled={!!page.locked} onChange={(e) => void repo.updatePageMeta(page.id, { suggesting: e.target.checked ? 1 : 0 })} />
      Suggest edits: typing and deleting become suggestions others can accept or reject
    </label>
  );
}
