// Small shared helpers with no dependencies.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** ULID-style id: 10 chars of time + 16 chars of randomness. Sortable and collision-safe for sync. */
export function uid(): string {
  let t = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % 32];
  return time + rand;
}

export const now = () => Date.now();

export function cx(...parts: (string | number | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;
  const d = (...a: A) => {
    lastArgs = a;
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...a);
    }, ms);
  };
  d.flush = () => {
    if (t && lastArgs) {
      clearTimeout(t);
      t = undefined;
      fn(...lastArgs);
    }
  };
  d.cancel = () => t && clearTimeout(t);
  return d;
}

// ---- Dates (local calendar dates are YYYY-MM-DD strings) ------------------
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
export const today = () => toISODate(new Date());
export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
export function startOfWeek(d: Date, weekStartsOn = 1): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (r.getDay() - weekStartsOn + 7) % 7;
  r.setDate(r.getDate() - diff);
  return r;
}
export function fmtDate(s: string | number | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  if (s === null || s === undefined || s === "") return "";
  const d = typeof s === "number" ? new Date(s) : parseISODate(s);
  return d.toLocaleDateString(undefined, opts);
}
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
export function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(ms);
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Strip characters that are unsafe in file names on Windows and elsewhere. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) || cleaned === "" ? `_${cleaned || "untitled"}` : cleaned;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
