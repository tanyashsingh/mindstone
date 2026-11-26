import { describe, expect, it } from "vitest";
import { SpendGuard, SpendLimitError, type GuardStore } from "@/ai/guard";

function memStore(): GuardStore {
  let v: ReturnType<GuardStore["get"]> = null;
  return { get: () => v, set: (u) => { v = structuredClone(u); } };
}

describe("cloud AI spending guard", () => {
  it("caps requests per minute and frees slots after a minute", () => {
    let t = new Date(2026, 10, 26, 10, 0, 0).getTime();
    const g = new SpendGuard(memStore(), () => t);
    const limits = { maxRequestsPerMinute: 3, dailyTokenBudget: 0 };
    g.begin(limits); g.begin(limits); g.begin(limits);
    expect(() => g.begin(limits)).toThrow(SpendLimitError);
    try { g.begin(limits); } catch (e) { expect((e as SpendLimitError).kind).toBe("rate"); expect((e as Error).message).toMatch(/Try again in 60 s/); }
    t += 61_000;
    expect(() => g.begin(limits)).not.toThrow();
  });

  it("stops at the daily token budget and resets the next day", () => {
    let t = new Date(2026, 10, 26, 23, 0).getTime();
    const g = new SpendGuard(memStore(), () => t);
    const limits = { maxRequestsPerMinute: 0, dailyTokenBudget: 1000 };
    g.begin(limits); g.record(600);
    g.begin(limits); g.record(500);
    expect(g.usage().tokens).toBe(1100);
    expect(() => g.begin(limits)).toThrow(/budget of 1,000 tokens is used up/);
    t += 2 * 3600_000; // past midnight
    expect(() => g.begin(limits)).not.toThrow();
    expect(g.usage().tokens).toBe(0);
  });

  it("treats 0 as unlimited and ignores bad token counts", () => {
    const g = new SpendGuard(memStore());
    for (let i = 0; i < 100; i++) g.begin({ maxRequestsPerMinute: 0, dailyTokenBudget: 0 });
    g.record(Number.NaN); g.record(-5);
    expect(g.usage().tokens).toBe(0);
  });
});
