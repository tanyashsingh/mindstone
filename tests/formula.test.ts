import { describe, expect, it } from "vitest";
import { runFormula } from "@/lib/formula";

const props: Record<string, unknown> = { Price: 12.5, Qty: 4, Name: "Widget", Done: true, Due: "2026-01-10" };
const get = (n: string) => (props[n] ?? null) as never;

describe("formula engine", () => {
  it("does arithmetic with precedence", () => {
    expect(runFormula("1 + 2 * 3", get).value).toBe(7);
    expect(runFormula("(1 + 2) * 3", get).value).toBe(9);
    expect(runFormula("-2 * -3", get).value).toBe(6);
  });
  it("reads properties", () => {
    expect(runFormula('prop("Price") * prop("Qty")', get).value).toBe(50);
    expect(runFormula('upper(prop("Name"))', get).value).toBe("WIDGET");
  });
  it("supports if, comparison and logic", () => {
    expect(runFormula('if(prop("Qty") > 3 && prop("Done"), "bulk", "small")', get).value).toBe("bulk");
    expect(runFormula("if(false, 1)", get).value).toBe(null);
  });
  it("handles dates", () => {
    expect(runFormula('dateAdd(prop("Due"), 1, "months")', get).value).toBe("2026-02-10");
    expect(runFormula('dateBetween("2026-01-10", "2026-01-01", "days")', get).value).toBe(9);
  });
  it("returns errors instead of executing code", () => {
    expect(runFormula("constructor.constructor('x')()", get).error).toBeTruthy();
    expect(runFormula("alert(1)", get).error).toMatch(/Unknown function/);
    expect(runFormula("1 +", get).error).toBeTruthy();
    expect(runFormula('"unterminated', get).error).toMatch(/Unterminated/);
  });
  it("division by zero is null", () => {
    expect(runFormula("1 / 0", get).value).toBe(null);
  });
  it("limits nesting depth", () => {
    expect(runFormula("(".repeat(200) + "1" + ")".repeat(200), get).error).toMatch(/deeply/);
  });
});
