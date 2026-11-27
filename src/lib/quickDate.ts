// Due dates typed in plain words when adding a task: "today", "tomorrow", "friday", "next fri", "in 3 days",
// "next week", "next month", "dec 5", "5 december", "2026-12-05". Returns the date (YYYY-MM-DD) and the text with
// the date words removed, or null when the text has no date words.
import { addDays, toISODate } from "./util";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const day = (w: string) => DAYS.findIndex((d) => d.slice(0, 3) === w.slice(0, 3).toLowerCase());
const month = (w: string) => MONTHS.findIndex((m) => m.slice(0, 3) === w.slice(0, 3).toLowerCase());
// Full day names anywhere; short ones ("fri") only after on/next/this, so words like "sat" or "wed" stay text.
const FULL_DAY = "(?:sun|mon|tues|wednes|thurs|fri|satur)day";
const SHORT_DAY = "(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)";
const MONTH_RE = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";

export function parseQuickDate(text: string, now = new Date()): { date: string; rest: string } | null {
  const base = toISODate(now);
  const rules: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [/\b(\d{4}-\d{2}-\d{2})\b/, (m) => m[1]!],
    [/\btoday\b/i, () => base],
    [/\btomorrow\b/i, () => addDays(base, 1)],
    [/\bin (\d{1,3}) (day|days|week|weeks)\b/i, (m) => addDays(base, Number(m[1]) * (/week/i.test(m[2]!) ? 7 : 1))],
    [/\bnext week\b/i, () => addDays(base, 7)],
    [/\bnext month\b/i, () => { const d = new Date(now); d.setMonth(d.getMonth() + 1); return toISODate(d); }],
    [new RegExp(`\\b(?:on |next |this )?(${FULL_DAY})\\b|\\b(?:on|next|this) (${SHORT_DAY})\\b`, "i"), (m) => {
      const target = day(m[1] ?? m[2]!);
      if (target < 0) return null;
      const ahead = (target - now.getDay() + 7) % 7 || 7; // the coming one; "friday" on a Friday means next week
      return addDays(base, ahead);
    }],
    [new RegExp(`\\b(?:on )?(${MONTH_RE}) (\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(?:on )?(\\d{1,2})(?:st|nd|rd|th)? (${MONTH_RE})\\b`, "i"), (m) => {
      const mi = month(m[1] ?? m[4]!), d = Number(m[2] ?? m[3]);
      if (mi < 0 || d < 1 || d > 31) return null;
      const year = now.getFullYear();
      let when = new Date(year, mi, d);
      if (when.getMonth() !== mi) return null; // 31 February and the like
      if (toISODate(when) < base) when = new Date(year + 1, mi, d); // a past date means next year's
      return toISODate(when);
    }],
  ];
  for (const [re, fn] of rules) {
    const m = re.exec(text);
    if (!m) continue;
    const date = fn(m);
    if (!date) continue;
    return { date, rest: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ").trim() };
  }
  return null;
}
