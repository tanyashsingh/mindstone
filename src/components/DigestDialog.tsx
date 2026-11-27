/** The daily or weekly digest, with an optional AI-written summary and "Save as page". */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { FileDown, Loader2, Sparkles } from "lucide-react";
import * as repo from "@/data/repo";
import { markdownToDoc } from "@/data/portability";
import { activeProvider, chat, requiresCloudConsent } from "@/ai/client";
import { DIGEST_PROMPT, buildDigest, digestMarkdown, digestTitle, isEmptyDigest, type Digest, type DigestRange } from "@/lib/digest";
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";
import { getSetting, setSetting } from "@/data/repo";
import { toISODate } from "@/lib/util";
import { Modal } from "./ui";

export const useDigest = create<{ range: DigestRange | null; show: (r: DigestRange | null) => void }>((set) => ({ range: null, show: (range) => set({ range }) }));

/** Opens today's digest once a day on start, when Settings → Home asks for it. */
export async function maybeShowDailyDigest(workspaceId: string) {
  if (!useSettings.getState().s.digest.daily) return;
  const key = `digestShown:${workspaceId}`;
  const day = toISODate(new Date());
  if ((await getSetting<string>(key, "")) === day) return;
  await setSetting(key, day);
  useDigest.getState().show("today");
}

export function DigestHost() {
  const { range, show } = useDigest();
  const ws = useApp((s) => s.workspaceId);
  const [d, setD] = useState<Digest | null>(null);
  const [ai, setAi] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setD(null); setAi("");
    if (range && ws) void buildDigest(ws, range).then(setD);
  }, [range, ws]);
  if (!range || !ws) return null;
  const md = d ? digestMarkdown(d) : "";
  const p = activeProvider();

  const writeSummary = async () => {
    if (!d) return;
    setBusy(true); setAi("");
    try {
      const res = await chat("You are Mindstone Intelligence. Be concise and concrete. Use Markdown.", [{ role: "user", content: `${DIGEST_PROMPT}\n\n<summary>\n${md}\n</summary>` }], (t) => setAi((x) => x + t));
      setAi(res.text);
    } catch (e) { useApp.getState().toast(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!d) return;
    const body = ai ? `## Summary\n${ai.trim()}\n\n${md}` : md;
    const page = await repo.createPage(ws, null, { title: digestTitle(d), icon: d.range === "today" ? "🗞️" : "📅", content: markdownToDoc(body) });
    await repo.savePageContent(page.id, markdownToDoc(body));
    show(null);
    useApp.getState().open({ kind: "page", id: page.id });
  };

  return (
    <Modal open onClose={() => show(null)} width={680} title={d ? digestTitle(d) : "Digest"}
      footer={<>
        <div className="mr-auto flex gap-1">
          {(["today", "week"] as const).map((r) => <button key={r} className={r === range ? "btn bg-active" : "btn"} aria-pressed={r === range} onClick={() => show(r)}>{r === "today" ? "Today" : "This week"}</button>)}
        </div>
        {p && <button className="btn-outline" disabled={!d || busy || requiresCloudConsent()} title={requiresCloudConsent() ? "Allow cloud AI in Settings → AI first" : undefined} onClick={() => void writeSummary()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Write summary</button>}
        <button className="btn-primary" disabled={!d} onClick={() => void save()}><FileDown size={14} /> Save as page</button>
      </>}>
      {!d ? <div className="skeleton h-40" /> : (
        <div className="max-h-[60vh] overflow-y-auto pr-1" data-testid="digest">
          {ai && <div className="prose-sm mb-4 rounded-[10px] bg-accent-soft p-3 text-ui" data-testid="digest-ai" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(ai, { async: false }) as string) }} />}
          {isEmptyDigest(d) ? <p className="text-ui text-muted">Nothing to report {range === "today" ? "today" : "this week"} yet: no tasks done or due, no events coming up, and no pages edited.</p>
            : <div className="digest text-ui [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-body [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(md, { async: false }) as string) }} />}
          {!p && <p className="mt-4 text-meta text-faint">Turn on an AI provider to add a written summary. The digest itself never needs AI.</p>}
        </div>
      )}
    </Modal>
  );
}
