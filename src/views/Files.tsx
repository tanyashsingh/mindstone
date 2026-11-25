import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Paperclip, Upload, Download, Trash2, FileText, Image as ImageIcon, Film, Music, Eye } from "lucide-react";
import { db } from "@/data/db";
import * as repo from "@/data/repo";
import type { Attachment } from "@/data/types";
import { useApp } from "@/store/app";
import { EmptyState, Modal, confirmDialog } from "@/components/ui";
import { cx, downloadBlob, fmtBytes, relTime } from "@/lib/util";

const icon = (m: string) => m.startsWith("image/") ? <ImageIcon size={16} /> : m.startsWith("video/") ? <Film size={16} /> : m.startsWith("audio/") ? <Music size={16} /> : <FileText size={16} />;

function Preview({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const url = useMemo(() => URL.createObjectURL(a.blob), [a]);
  const [text, setText] = useState<string | null>(null);
  const isText = /^text\/|json|csv|markdown/.test(a.mime) || /\.(md|txt|csv|json)$/i.test(a.name);
  if (isText && text === null) void a.blob.slice(0, 200_000).text().then(setText);
  return (
    <Modal open onClose={() => { URL.revokeObjectURL(url); onClose(); }} title={a.name} width={820}
      footer={<button className="btn-primary" onClick={() => downloadBlob(a.blob, a.name)}><Download size={14} /> Save as…</button>}>
      {a.mime.startsWith("image/") && <img src={url} alt={a.name} className="mx-auto max-h-[60vh]" />}
      {a.mime.startsWith("video/") && <video src={url} controls className="max-h-[60vh] w-full" />}
      {a.mime.startsWith("audio/") && <audio src={url} controls className="w-full" />}
      {a.mime === "application/pdf" && <object data={url} type="application/pdf" className="h-[60vh] w-full"><p>PDF preview is unavailable here. Use Save as.</p></object>}
      {!isText && a.text && a.mime !== "application/pdf" && <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-sunken p-3 text-[12.5px]">{a.text.slice(0, 200_000)}</pre>}
      {isText && <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-sunken p-3 font-mono text-[12px]">{text ?? "Loading…"}</pre>}
      {!isText && !a.text && !/^(image|video|audio)\//.test(a.mime) && a.mime !== "application/pdf" && <p className="text-[13px] text-muted">No preview for {a.mime}. Use Save as to open it in another app. Cairn never runs attachments.</p>}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px] text-muted"><div>Type<br /><b className="text-fg">{a.mime}</b></div><div>Size<br /><b className="text-fg">{fmtBytes(a.size)}</b></div><div>Added<br /><b className="text-fg">{new Date(a.createdAt).toLocaleString()}</b></div></dl>
    </Modal>
  );
}

export default function Files() {
  const ws = useApp((s) => s.workspaceId)!;
  const open = useApp((s) => s.open);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const files = useLiveQuery(() => db().attachments.where("workspaceId").equals(ws).reverse().sortBy("createdAt"), [ws]);
  const pages = useLiveQuery(async () => new Map((await repo.livePages(ws)).map((p) => [p.id, p.title || "Untitled"])), [ws]);
  const list = (files ?? []).filter((f) => (!q || f.name.toLowerCase().includes(q.toLowerCase())) && (!kind || f.mime.startsWith(kind)));
  const total = (files ?? []).reduce((a, f) => a + f.size, 0);
  const [quota, setQuota] = useState<{ usage?: number; quota?: number } | null>(null);
  if (quota === null && navigator.storage?.estimate) void navigator.storage.estimate().then(setQuota);

  const upload = async (fs: File[]) => {
    for (const f of fs) {
      try { await repo.addAttachment(ws, null, f); } catch (e) { useApp.getState().toast(`${f.name}: ${e instanceof Error ? e.message : e}`, "error"); }
    }
  };

  return (
    <div className={cx("mx-auto min-h-full max-w-5xl px-10 py-10", drag && "bg-accent-soft")}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void upload([...e.dataTransfer.files]); }}>
      <div className="mb-2 flex items-center gap-3">
        <Paperclip size={22} className="text-muted" /><h1 className="text-[26px] font-bold tracking-tight">Files</h1><span className="flex-1" />
        <button className="btn-primary" onClick={() => input.current?.click()}><Upload size={14} /> Upload</button>
        <input ref={input} type="file" multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      <p className="mb-5 text-[13px] text-muted">
        {files?.length ?? 0} files · {fmtBytes(total)} in this workspace{quota?.usage !== undefined && quota.quota ? ` · ${fmtBytes(quota.usage)} of ${fmtBytes(quota.quota)} browser storage used` : ""}. Drop files anywhere here. Max 100 MB each; executables are blocked.
      </p>
      <div className="mb-3 flex gap-2">
        <input className="input w-64" placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-40" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="File type"><option value="">All types</option><option value="image/">Images</option><option value="application/pdf">PDF</option><option value="video/">Video</option><option value="audio/">Audio</option><option value="text/">Text</option></select>
      </div>
      {list.length === 0 ? <EmptyState icon={<Paperclip />} title="No files" body="Upload files here or drop them into any page." /> : (
        <div className="divide-y divide-line rounded-md border border-line">
          {list.map((f) => (
            <div key={f.id} className="group flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="text-muted">{icon(f.mime)}</span>
              <button className="flex-1 truncate text-left hover:underline" onClick={() => setPreview(f)}>{f.name}</button>
              {f.pageId && <button className="max-w-40 truncate text-[12px] text-accent" onClick={() => open({ kind: "page", id: f.pageId! })}>↗ {pages?.get(f.pageId) ?? "page"}</button>}
              {f.textStatus === "ok" && <span className="chip c-green" title="Text extracted: found by search and AI">Searchable</span>}
              {f.textStatus === "empty" && <span className="chip c-gray" title="No text layer (e.g. a scanned PDF)">No text</span>}
              {f.textStatus === "error" && <span className="chip c-red" title="The file could not be read">Unreadable</span>}
              <span className="w-20 text-right text-faint">{fmtBytes(f.size)}</span>
              <span className="w-20 text-right text-faint">{relTime(f.createdAt)}</span>
              <button className="icon-btn" aria-label="Preview" onClick={() => setPreview(f)}><Eye size={14} /></button>
              <button className="icon-btn" aria-label="Download" onClick={() => downloadBlob(f.blob, f.name)}><Download size={14} /></button>
              <button className="icon-btn" aria-label="Delete" onClick={async () => { if (await confirmDialog(`Delete “${f.name}”?`, "Pages that embed it will show it as missing. This cannot be undone.", { danger: true })) await db().attachments.delete(f.id); }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {preview && <Preview a={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
