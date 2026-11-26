import type { CalendarEvent, Recurrence } from "@/data/types";

/** RFC 5545 (iCalendar) import and export of events. */

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
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mindstone//Workspace//EN", "CALSCALE:GREGORIAN"];
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
      if (e.recurrence.count) r += `;COUNT=${e.recurrence.count}`;
      if (e.recurrence.byDay?.length) r += `;BYDAY=${e.recurrence.byDay.join(",")}`;
      lines.push(r);
      for (const x of e.exdates ?? []) lines.push(e.allDay ? `EXDATE;VALUE=DATE:${x.replace(/-/g, "")}` : `EXDATE:${utcStamp(new Date(`${x}T00:00`).getTime() + (e.start - new Date(new Date(e.start).toDateString()).getTime()))}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---- Parsing ----------------------------------------------------------------------------------
/** Windows time zone names used by Outlook and Exchange, mapped to IANA names. */
const WINDOWS_ZONES: Record<string, string> = {
  "UTC": "UTC", "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin", "Romance Standard Time": "Europe/Paris", "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw", "E. Europe Standard Time": "Europe/Chisinau", "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest", "Russian Standard Time": "Europe/Moscow", "Turkey Standard Time": "Europe/Istanbul",
  "Israel Standard Time": "Asia/Jerusalem", "Arabian Standard Time": "Asia/Dubai", "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata", "Nepal Standard Time": "Asia/Kathmandu", "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok", "Singapore Standard Time": "Asia/Singapore", "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul", "AUS Eastern Standard Time": "Australia/Sydney",
  "E. Australia Standard Time": "Australia/Brisbane", "Cen. Australia Standard Time": "Australia/Adelaide", "W. Australia Standard Time": "Australia/Perth",
  "New Zealand Standard Time": "Pacific/Auckland", "Hawaiian Standard Time": "Pacific/Honolulu", "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles", "Mountain Standard Time": "America/Denver", "US Mountain Standard Time": "America/Phoenix",
  "Central Standard Time": "America/Chicago", "Eastern Standard Time": "America/New_York", "Atlantic Standard Time": "America/Halifax",
  "Canada Central Standard Time": "America/Regina", "SA Pacific Standard Time": "America/Bogota", "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires", "South Africa Standard Time": "Africa/Johannesburg", "Egypt Standard Time": "Africa/Cairo",
  "W. Central Africa Standard Time": "Africa/Lagos", "E. Africa Standard Time": "Africa/Nairobi",
};

function zoneOffset(ms: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - ms;
}

/** Instant of a wall-clock time in a named zone, or null if the zone is unknown. */
export function zonedTime(y: number, mo: number, d: number, h: number, mi: number, s: number, tzid: string): number | null {
  const name = tzid.replace(/^"|"$/g, "");
  for (const tz of [name, WINDOWS_ZONES[name], name.split("/").slice(-2).join("/"), name.split("/").slice(-1)[0]]) {
    if (!tz) continue;
    try {
      const guess = Date.UTC(y, mo, d, h, mi, s);
      const off = zoneOffset(guess, tz);
      let t = guess - off;
      const off2 = zoneOffset(t, tz);
      if (off2 !== off) t = guess - off2;
      return t;
    } catch { /* not a zone this system knows */ }
  }
  return null;
}

function parseStamp(v: string, params: string): { ms: number; allDay: boolean } {
  if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(v)) {
    return { ms: new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8))).getTime(), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v.trim());
  if (!m) return { ms: NaN, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  const args = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  if (z) return { ms: Date.UTC(...args), allDay: false };
  const tz = /TZID=("[^"]+"|[^;:]+)/i.exec(params)?.[1];
  const zoned = tz ? zonedTime(...args, tz) : null;
  return { ms: zoned ?? new Date(...args).getTime(), allDay: false }; // floating times are local
}

export type ParsedEvent = Pick<CalendarEvent, "title" | "notes" | "start" | "end" | "allDay" | "recurrence" | "calendar"> & { uid: string; recurrenceId?: string; exdates?: string[] };
const isoDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * RFC 5545 VEVENTs: SUMMARY, DESCRIPTION, LOCATION, CATEGORIES, DTSTART/DTEND/DURATION with time zones (IANA and
 * Windows names), RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, UNTIL, COUNT, BYDAY), EXDATE, RECURRENCE-ID
 * (a moved occurrence: kept as its own event and removed from the series) and STATUS:CANCELLED.
 */
export function parseICS(text: string): ParsedEvent[] {
  const raw = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events: (ParsedEvent & { cancelled?: boolean })[] = [];
  let cur: (Partial<ParsedEvent> & { cancelled?: boolean; location?: string; duration?: number }) | null = null;
  let depth = 0; // ignore nested components such as VALARM
  for (const line of raw) {
    if (line === "BEGIN:VEVENT") { cur = { notes: "", recurrence: null, calendar: "Imported", allDay: 0, uid: "", exdates: [] }; depth = 0; continue; }
    if (cur && /^BEGIN:/.test(line)) { depth++; continue; }
    if (cur && depth > 0 && /^END:/.test(line)) { depth--; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.start !== undefined && !Number.isNaN(cur.start)) {
        const end = cur.end ?? (cur.duration !== undefined ? cur.start + cur.duration : cur.start + (cur.allDay ? 0 : 3600e3));
        const notes = [cur.location ? `Location: ${cur.location}` : "", cur.notes ?? ""].filter(Boolean).join("\n\n");
        events.push({ title: cur.title || "Untitled event", notes, start: cur.start, end, allDay: cur.allDay ?? 0, recurrence: cur.recurrence ?? null, calendar: cur.calendar ?? "Imported", uid: cur.uid || "", recurrenceId: cur.recurrenceId, exdates: cur.exdates?.length ? cur.exdates : undefined, cancelled: cur.cancelled });
      }
      cur = null;
      continue;
    }
    if (!cur || depth > 0) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const [name = "", ...params] = line.slice(0, idx).split(";");
    const value = line.slice(idx + 1);
    const p = params.join(";");
    switch (name.toUpperCase()) {
      case "UID": cur.uid = value.trim().slice(0, 500); break;
      case "SUMMARY": cur.title = unesc(value).slice(0, 500); break;
      case "DESCRIPTION": cur.notes = unesc(value).slice(0, 20000); break;
      case "LOCATION": cur.location = unesc(value).slice(0, 500); break;
      case "CATEGORIES": cur.calendar = unesc(value).split(",")[0] || "Imported"; break;
      case "STATUS": cur.cancelled = value.trim().toUpperCase() === "CANCELLED"; break;
      case "DTSTART": { const r = parseStamp(value, p); cur.start = r.ms; cur.allDay = r.allDay ? 1 : 0; break; }
      case "DTEND": { const r = parseStamp(value, p); cur.end = r.allDay ? r.ms - 86400000 : r.ms; break; }
      case "DURATION": {
        const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
        if (m) cur.duration = ((Number(m[1] ?? 0) * 7 + Number(m[2] ?? 0)) * 86400 + Number(m[3] ?? 0) * 3600 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0)) * 1000;
        break;
      }
      case "RECURRENCE-ID": { const r = parseStamp(value, p); if (!Number.isNaN(r.ms)) cur.recurrenceId = isoDay(r.ms); break; }
      case "EXDATE":
        for (const v of value.split(",")) { const r = parseStamp(v, p); if (!Number.isNaN(r.ms)) cur.exdates!.push(isoDay(r.ms)); }
        break;
      case "RRULE": {
        const kv = Object.fromEntries(value.split(";").map((x) => x.split("=") as [string, string]));
        const freq = (kv.FREQ ?? "").toLowerCase();
        if (["daily", "weekly", "monthly", "yearly"].includes(freq)) {
          const until = kv.UNTIL ? `${kv.UNTIL.slice(0, 4)}-${kv.UNTIL.slice(4, 6)}-${kv.UNTIL.slice(6, 8)}` : undefined;
          const count = kv.COUNT ? Math.max(1, Math.min(10_000, Number(kv.COUNT) || 0)) : undefined;
          const byDay = kv.BYDAY ? kv.BYDAY.split(",").filter((d) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.test(d)) : undefined;
          cur.recurrence = { freq: freq as NonNullable<Recurrence>["freq"], interval: Number(kv.INTERVAL ?? 1) || 1, ...(until ? { until } : {}), ...(count ? { count } : {}), ...(byDay?.length ? { byDay } : {}) };
        }
        break;
      }
    }
  }
  // Moved or cancelled single occurrences: remove them from their series; moved ones stay as their own events.
  const masters = new Map(events.filter((e) => e.recurrence && !e.recurrenceId && e.uid).map((e) => [e.uid, e]));
  for (const e of events) {
    if (!e.recurrenceId) continue;
    const m = masters.get(e.uid);
    if (m) m.exdates = [...new Set([...(m.exdates ?? []), e.recurrenceId])];
  }
  return events.filter((e) => !e.cancelled).map(({ cancelled: _c, ...e }) => e);
}

/** The parts of a parsed event stored on a Mindstone event. */
export function eventFields(p: ParsedEvent): Pick<CalendarEvent, "title" | "notes" | "start" | "end" | "allDay" | "recurrence" | "calendar" | "exdates"> {
  return { title: p.title, notes: p.notes, start: p.start, end: p.end, allDay: p.allDay, recurrence: p.recurrence, calendar: p.calendar, ...(p.exdates ? { exdates: p.exdates } : {}) };
}
