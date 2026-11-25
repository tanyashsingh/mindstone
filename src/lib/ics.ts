import type { CalendarEvent, Recurrence } from "@/data/types";

/** Minimal RFC 5545 import/export covering VEVENT with DTSTART/DTEND/SUMMARY/DESCRIPTION/RRULE. */

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const unesc = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

function utcStamp(ms: number) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function dateStamp(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) { parts.push(rest.slice(0, 74)); rest = " " + rest.slice(74); }
  parts.push(rest);
  return parts.join("\r\n");
}

export function toICS(events: CalendarEvent[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//REA//Workspace//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@rea.local`, `DTSTAMP:${utcStamp(e.updatedAt)}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(e.start)}`, `DTEND;VALUE=DATE:${dateStamp(e.end + 86400000)}`);
    } else lines.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`);
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
    if (e.calendar) lines.push(`CATEGORIES:${esc(e.calendar)}`);
    if (e.recurrence) {
      let r = `RRULE:FREQ=${e.recurrence.freq.toUpperCase()};INTERVAL=${e.recurrence.interval}`;
      if (e.recurrence.until) r += `;UNTIL=${e.recurrence.until.replace(/-/g, "")}`;
      lines.push(r);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

function parseStamp(v: string, params: string): { ms: number; allDay: boolean } {
  if (/VALUE=DATE/i.test(params) || /^\d{8}$/.test(v)) {
    return { ms: new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8))).getTime(), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return { ms: NaN, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  const args = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  // TZID-qualified local times are treated as local time on this machine (documented limitation).
  return { ms: z ? Date.UTC(...args) : new Date(...args).getTime(), allDay: false };
}

export type ParsedEvent = Pick<CalendarEvent, "title" | "notes" | "start" | "end" | "allDay" | "recurrence" | "calendar">;

export function parseICS(text: string): ParsedEvent[] {
  const raw = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: ParsedEvent[] = [];
  let cur: Partial<ParsedEvent> | null = null;
  for (const line of raw) {
    if (line === "BEGIN:VEVENT") { cur = { notes: "", recurrence: null, calendar: "Imported", allDay: 0 }; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.start !== undefined && !Number.isNaN(cur.start)) {
        const end = cur.end ?? cur.start + (cur.allDay ? 0 : 3600e3);
        out.push({ title: cur.title || "Untitled event", notes: cur.notes ?? "", start: cur.start, end, allDay: cur.allDay ?? 0, recurrence: cur.recurrence ?? null, calendar: cur.calendar ?? "Imported" });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const [name = "", ...params] = line.slice(0, idx).split(";");
    const value = line.slice(idx + 1);
    const p = params.join(";");
    switch (name.toUpperCase()) {
      case "SUMMARY": cur.title = unesc(value).slice(0, 500); break;
      case "DESCRIPTION": cur.notes = unesc(value).slice(0, 20000); break;
      case "CATEGORIES": cur.calendar = unesc(value).split(",")[0] || "Imported"; break;
      case "DTSTART": { const r = parseStamp(value, p); cur.start = r.ms; cur.allDay = r.allDay ? 1 : 0; break; }
      case "DTEND": { const r = parseStamp(value, p); cur.end = r.allDay ? r.ms - 86400000 : r.ms; break; }
      case "RRULE": {
        const kv = Object.fromEntries(value.split(";").map((x) => x.split("=") as [string, string]));
        const freq = (kv.FREQ ?? "").toLowerCase();
        if (["daily", "weekly", "monthly", "yearly"].includes(freq)) {
          const until = kv.UNTIL ? `${kv.UNTIL.slice(0, 4)}-${kv.UNTIL.slice(4, 6)}-${kv.UNTIL.slice(6, 8)}` : undefined;
          cur.recurrence = { freq: freq as NonNullable<Recurrence>["freq"], interval: Number(kv.INTERVAL ?? 1) || 1, ...(until ? { until } : {}) };
        }
        break;
      }
    }
  }
  return out;
}
