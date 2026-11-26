/** Calendar → Subscribe: add, refresh and remove read-only calendars by their ICS address. */
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { db } from "@/data/db";
import { addFeed, refreshFeed, removeFeed } from "@/lib/feeds";
import { useApp } from "@/store/app";
import { cx, relTime } from "@/lib/util";
import { Modal, confirmDialog } from "./ui";

const COLORS = ["blue", "green", "purple", "orange", "pink", "red", "yellow", "gray"];

export function FeedsDialog({ onClose }: { onClose: () => void }) {
  const ws = useApp((s) => s.workspaceId)!;
  const feeds = useLiveQuery(() => db().calendarFeeds.where("workspaceId").equals(ws).toArray(), [ws], []);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("blue");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy("new");
    try {
      const f = await addFeed(ws, name, url, color);
      try { const n = await refreshFeed(f.id); useApp.getState().toast(`Subscribed to ${f.name}: ${n} events`, "success"); }
      catch (x) { setErr(`Added, but downloading failed: ${x instanceof Error ? x.message : String(x)}${window.rea ? "" : ". In the browser, only servers that allow it can be read; subscribe in the desktop app and the events reach this device by sync."}`); }
      setName(""); setUrl("");
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    finally { setBusy(null); }
  };

  return (
    <Modal open onClose={onClose} title="Subscribed calendars" width={560}>
      <p className="mb-3 text-[13px] text-muted">Show a Google, Outlook or other calendar next to your tasks, read-only. Paste its private iCalendar address: in Google Calendar, Settings → your calendar → “Secret address in iCal format”; in Outlook, Settings → Calendar → Shared calendars → Publish → ICS link. No sign-in needed; it refreshes every 30 minutes.</p>
      <ul className="mb-4 space-y-1.5" aria-label="Subscribed calendars">
        {feeds.map((f) => (
          <li key={f.id} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-[13px]" data-testid="feed">
            <span className={cx("size-3 shrink-0 rounded-full", `dot-${f.color}`)} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.name}</span>
              <span className={cx("block truncate text-[12px]", f.lastError ? "text-danger" : "text-faint")}>{f.lastError ? `Couldn't refresh: ${f.lastError}` : f.lastFetched ? `${f.eventCount} events · refreshed ${relTime(f.lastFetched)}` : "Not downloaded yet"}</span></span>
            <button className="icon-btn" aria-label={`Refresh ${f.name}`} disabled={busy === f.id} onClick={async () => { setBusy(f.id); try { await refreshFeed(f.id); } catch { /* shown in the row */ } finally { setBusy(null); } }}>{busy === f.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button>
            <button className="icon-btn hover:text-danger" aria-label={`Remove ${f.name}`} onClick={async () => { if (await confirmDialog(`Remove “${f.name}”?`, "Its events disappear from Mindstone. The calendar itself is not affected.")) await removeFeed(f.id); }}><Trash2 size={14} /></button>
          </li>
        ))}
        {feeds.length === 0 && <li className="text-[13px] text-faint">No subscriptions yet.</li>}
      </ul>
      <form className="grid gap-2" onSubmit={add} aria-label="Subscribe to a calendar">
        <input className="input" aria-label="Calendar name" placeholder="Name, e.g. Work" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label="Calendar address" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={c} className={cx("size-5 rounded-full", `dot-${c}`, color === c && "ring-2 ring-fg ring-offset-1")} onClick={() => setColor(c)} />)}
          <span className="flex-1" />
          <button className="btn-primary" disabled={!url.trim() || busy === "new"}>{busy === "new" && <Loader2 size={14} className="animate-spin" />} Subscribe</button>
        </div>
        {err && <p className="text-[12.5px] text-danger" role="alert">{err}</p>}
      </form>
    </Modal>
  );
}
