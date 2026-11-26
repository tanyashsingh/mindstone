/**
 * Spending guard for cloud AI: a requests-per-minute cap and a daily token budget, so a runaway loop or a
 * stuck retry can't burn through someone's API credit. Local providers (Ollama, OpenAI-compatible servers on
 * this machine) are free and never limited. Usage is kept per device in local storage.
 */
export interface GuardLimits { maxRequestsPerMinute: number; dailyTokenBudget: number } // 0 = unlimited
interface Usage { day: string; tokens: number; recent: number[] }
export interface GuardStore { get(): Usage | null; set(u: Usage): void }

export class SpendLimitError extends Error {
  constructor(message: string, readonly kind: "rate" | "budget") { super(message); }
}

const KEY = "mindstone.aiUsage";
export const localStore: GuardStore = {
  get: () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null") as Usage | null; } catch { return null; } },
  set: (u) => localStorage.setItem(KEY, JSON.stringify(u)),
};

const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export class SpendGuard {
  constructor(private store: GuardStore, private now: () => number = Date.now) {}

  private load(): Usage {
    const t = this.now();
    const u = this.store.get();
    if (!u || u.day !== dayOf(t)) return { day: dayOf(t), tokens: 0, recent: (u?.recent ?? []).filter((x) => t - x < 60_000) };
    return { ...u, recent: u.recent.filter((x) => t - x < 60_000) };
  }

  /** Call before a cloud request. Throws SpendLimitError when a limit is reached; otherwise records the request. */
  begin(limits: GuardLimits): void {
    const u = this.load();
    if (limits.dailyTokenBudget > 0 && u.tokens >= limits.dailyTokenBudget) {
      throw new SpendLimitError(`Today's cloud AI budget of ${limits.dailyTokenBudget.toLocaleString()} tokens is used up. It resets at midnight, or raise it in Settings → AI.`, "budget");
    }
    if (limits.maxRequestsPerMinute > 0 && u.recent.length >= limits.maxRequestsPerMinute) {
      const wait = Math.ceil((60_000 - (this.now() - u.recent[0]!)) / 1000);
      throw new SpendLimitError(`Too many cloud AI requests in the last minute (limit ${limits.maxRequestsPerMinute}). Try again in ${wait} s, or change the limit in Settings → AI.`, "rate");
    }
    u.recent.push(this.now());
    this.store.set(u);
  }

  /** Call after a cloud request with the tokens the provider reported. */
  record(tokens: number): void {
    const u = this.load();
    u.tokens += Math.max(0, Math.round(tokens) || 0);
    this.store.set(u);
  }

  usage(): { day: string; tokens: number; lastMinute: number } {
    const u = this.load();
    return { day: u.day, tokens: u.tokens, lastMinute: u.recent.length };
  }
}
