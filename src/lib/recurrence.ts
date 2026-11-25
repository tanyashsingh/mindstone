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

/** Expand an event (possibly recurring) into concrete occurrences overlapping [from, to). */
export function expandEvent(ev: CalendarEvent, from: number, to: number, max = 500): Occurrence[] {
  const dur = Math.max(0, ev.end - ev.start);
  const out: Occurrence[] = [];
  if (!ev.recurrence) {
    if (ev.start < to && ev.start + Math.max(dur, 1) > from) out.push({ event: ev, start: ev.start, end: ev.end, key: ev.id });
    return out;
  }
  const base = new Date(ev.start);
  const timeOfDay = base.getHours() * 3600e3 + base.getMinutes() * 60e3;
  let day: string | null = toISODate(base);
  let i = 0;
  while (day && i < max * 20) {
    const s = parseISODate(day).getTime() + timeOfDay;
    if (s >= to) break;
    if (s + Math.max(dur, 1) > from) {
      out.push({ event: ev, start: s, end: s + dur, key: `${ev.id}@${day}` });
      if (out.length >= max) break;
    }
    day = nextDate(day, ev.recurrence);
    i++;
  }
  return out;
}

export { addDays };
