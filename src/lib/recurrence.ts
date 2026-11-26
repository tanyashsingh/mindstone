import type { CalendarEvent, Recurrence } from "@/data/types";
import { addDays, parseISODate, toISODate } from "./util";

/** Next occurrence date (YYYY-MM-DD) after `date` for a recurrence rule, or null when finished. */
export function nextDate(date: string, rule: Recurrence): string | null {
  if (!rule) return null;
  const d = parseISODate(date);
  const n = Math.max(1, rule.interval || 1);
  if (rule.freq === "daily") d.setDate(d.getDate() + n);
  else if (rule.freq === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (rule.freq === "monthly") {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  } else d.setFullYear(d.getFullYear() + n);
  const out = toISODate(d);
  if (rule.until && out > rule.until) return null;
  return out;
}

export interface Occurrence { event: CalendarEvent; start: number; end: number; key: string }

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Every occurrence date of a rule, in order, from the first date (inclusive). Stops at until/count or after `limit` steps. */
export function* occurrenceDates(first: string, rule: NonNullable<Recurrence>, limit = 20_000): Generator<string> {
  const n = Math.max(1, rule.interval || 1);
  const start = parseISODate(first);
  let produced = 0;
  const byDay = (rule.byDay ?? [])
    .map((x) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x.trim().toUpperCase()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ ord: m[1] ? Number(m[1]) : 0, wd: DAYS.indexOf(m[2]!) }));
  for (let step = 0; step < limit; step++) {
    let dates: Date[];
    if (rule.freq === "daily") dates = [new Date(start.getFullYear(), start.getMonth(), start.getDate() + step * n)];
    else if (rule.freq === "weekly") {
      if (!byDay.length) dates = [new Date(start.getFullYear(), start.getMonth(), start.getDate() + step * 7 * n)];
      else {
        const monday = new Date(start.getFullYear(), start.getMonth(), start.getDate() - ((start.getDay() + 6) % 7) + step * 7 * n);
        dates = byDay.map((b) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + ((b.wd + 6) % 7))).sort((x, y) => x.getTime() - y.getTime());
      }
    } else if (rule.freq === "monthly") {
      const y = start.getFullYear(), m = start.getMonth() + step * n;
      const month = new Date(y, m, 1).getMonth();
      const last = new Date(y, m + 1, 0).getDate();
      if (byDay.some((b) => b.ord !== 0)) {
        dates = byDay.map((b) => {
          if (b.ord > 0) return new Date(y, m, 1 + ((b.wd - new Date(y, m, 1).getDay() + 7) % 7) + (b.ord - 1) * 7);
          return new Date(y, m, last - ((new Date(y, m, last).getDay() - b.wd + 7) % 7) + (b.ord + 1) * 7);
        }).filter((d) => d.getMonth() === month).sort((x, z) => x.getTime() - z.getTime());
      } else dates = [new Date(y, m, Math.min(start.getDate(), last))];
    } else {
      const y = start.getFullYear() + step * n;
      dates = [new Date(y, start.getMonth(), Math.min(start.getDate(), new Date(y, start.getMonth() + 1, 0).getDate()))];
    }
    for (const d of dates) {
      if (d < start) continue;
      const iso = toISODate(d);
      if (rule.until && iso > rule.until) return;
      if (rule.count && produced >= rule.count) return;
      produced++;
      yield iso;
    }
  }
}

/** Expand an event (possibly recurring) into concrete occurrences overlapping [from, to). */
export function expandEvent(ev: CalendarEvent, from: number, to: number, max = 500): Occurrence[] {
  const dur = Math.max(0, ev.end - ev.start);
  const out: Occurrence[] = [];
  if (!ev.recurrence) {
    if (ev.start < to && ev.start + Math.max(dur, 1) > from) out.push({ event: ev, start: ev.start, end: ev.end, key: ev.id });
    return out;
  }
  const base = new Date(ev.start);
  const timeOfDay = base.getHours() * 3600e3 + base.getMinutes() * 60e3 + base.getSeconds() * 1e3;
  const skip = new Set(ev.exdates ?? []);
  for (const day of occurrenceDates(toISODate(base), ev.recurrence)) {
    const s = parseISODate(day).getTime() + timeOfDay;
    if (s >= to) break;
    if (skip.has(day)) continue;
    if (s + Math.max(dur, 1) > from) {
      out.push({ event: ev, start: s, end: s + dur, key: `${ev.id}@${day}` });
      if (out.length >= max) break;
    }
  }
  return out;
}

export { addDays };
