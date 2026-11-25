/**
 * Safe formula engine for database properties. A hand-written tokenizer + Pratt parser
 * evaluates a small expression language. No eval, Function or dynamic code execution.
 *
 * Syntax: numbers, "strings", true/false, prop("Name"), operators + - * / % == != < <= > >= && || !,
 * ternary-free if(cond, a, b), and the functions in FUNCS below.
 */
export type FValue = number | string | boolean | null | FValue[];

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

export class FormulaError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new FormulaError(`Bad number at ${i}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; } else s += src[j++];
      }
      if (j >= src.length) throw new FormulaError("Unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/%<>!(),".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new FormulaError(`Unexpected character '${c}'`);
  }
  if (out.length > 2000) throw new FormulaError("Formula too long");
  return out;
}

type Node =
  | { k: "lit"; v: FValue }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] };

const BP: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const expectOp = (v: string) => {
    const t = toks[p++];
    if (!t || t.t !== "op" || t.v !== v) throw new FormulaError(`Expected '${v}'`);
  };
  const prefix = (depth: number): Node => {
    if (depth > 64) throw new FormulaError("Formula nested too deeply");
    const t = toks[p++];
    if (!t) throw new FormulaError("Unexpected end of formula");
    if (t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "op" && (t.v === "-" || t.v === "!")) return { k: "un", op: t.v, a: expr(7, depth + 1) };
    if (t.t === "op" && t.v === "(") { const e = expr(0, depth + 1); expectOp(")"); return e; }
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      expectOp("(");
      const args: Node[] = [];
      const n = peek();
      if (!(n && n.t === "op" && n.v === ")")) {
        args.push(expr(0, depth + 1));
        while (peek()?.t === "op" && (peek() as { v: string }).v === ",") { p++; args.push(expr(0, depth + 1)); }
      }
      expectOp(")");
      return { k: "call", name: t.v, args };
    }
    throw new FormulaError(`Unexpected '${"v" in t ? t.v : ""}'`);
  };
  const expr = (minBp: number, depth: number): Node => {
    let left = prefix(depth);
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || !(t.v in BP)) break;
      const bp = BP[t.v]!;
      if (bp <= minBp) break;
      p++;
      left = { k: "bin", op: t.v, a: left, b: expr(bp, depth + 1) };
    }
    return left;
  };
  const tree = expr(0, 0);
  if (p !== toks.length) throw new FormulaError("Unexpected trailing input");
  return tree;
}

const num = (v: FValue): number => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : v === null ? 0 : Number(v) || 0);
const str = (v: FValue): string => (v === null ? "" : Array.isArray(v) ? v.map(str).join(", ") : String(v));
const truthy = (v: FValue): boolean => (Array.isArray(v) ? v.length > 0 : Boolean(v));
const toDate = (v: FValue): Date | null => {
  if (v === null || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v).length === 10 ? `${v}T00:00:00` : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const FUNCS: Record<string, (args: FValue[]) => FValue> = {
  abs: ([a]) => Math.abs(num(a ?? 0)),
  round: ([a, d]) => { const f = 10 ** num(d ?? 0); return Math.round(num(a ?? 0) * f) / f; },
  floor: ([a]) => Math.floor(num(a ?? 0)),
  ceil: ([a]) => Math.ceil(num(a ?? 0)),
  min: (a) => Math.min(...a.flat().map(num)),
  max: (a) => Math.max(...a.flat().map(num)),
  sum: (a) => a.flat().map(num).reduce((x, y) => x + y, 0),
  sqrt: ([a]) => Math.sqrt(num(a ?? 0)),
  pow: ([a, b]) => num(a ?? 0) ** num(b ?? 1),
  concat: (a) => a.map(str).join(""),
  length: ([a]) => (Array.isArray(a) ? a.length : str(a ?? "").length),
  lower: ([a]) => str(a ?? "").toLowerCase(),
  upper: ([a]) => str(a ?? "").toUpperCase(),
  contains: ([a, b]) => (Array.isArray(a) ? a.map(str).includes(str(b ?? "")) : str(a ?? "").includes(str(b ?? ""))),
  replace: ([a, b, c]) => str(a ?? "").split(str(b ?? "")).join(str(c ?? "")),
  slice: ([a, s, e]) => str(a ?? "").slice(num(s ?? 0), e === undefined ? undefined : num(e)),
  format: ([a]) => str(a ?? null),
  toNumber: ([a]) => num(a ?? 0),
  empty: ([a]) => a === null || a === undefined || a === "" || (Array.isArray(a) && a.length === 0),
  not: ([a]) => !truthy(a ?? null),
  and: (a) => a.every(truthy),
  or: (a) => a.some(truthy),
  now: () => Date.now(),
  today: () => iso(new Date()),
  dateAdd: ([d, n, unit]) => {
    const dt = toDate(d ?? null);
    if (!dt) return null;
    const u = str(unit ?? "days"), k = num(n ?? 0);
    if (u.startsWith("day")) dt.setDate(dt.getDate() + k);
    else if (u.startsWith("week")) dt.setDate(dt.getDate() + 7 * k);
    else if (u.startsWith("month")) dt.setMonth(dt.getMonth() + k);
    else if (u.startsWith("year")) dt.setFullYear(dt.getFullYear() + k);
    return iso(dt);
  },
  dateBetween: ([a, b, unit]) => {
    const x = toDate(a ?? null), y = toDate(b ?? null);
    if (!x || !y) return null;
    const ms = x.getTime() - y.getTime(), u = str(unit ?? "days");
    const div = u.startsWith("hour") ? 3.6e6 : u.startsWith("week") ? 6.048e8 : u.startsWith("month") ? 2.6298e9 : u.startsWith("year") ? 3.15576e10 : 8.64e7;
    return Math.trunc(ms / div);
  },
  year: ([d]) => toDate(d ?? null)?.getFullYear() ?? null,
  month: ([d]) => { const x = toDate(d ?? null); return x ? x.getMonth() + 1 : null; },
  day: ([d]) => toDate(d ?? null)?.getDate() ?? null,
};
export const FORMULA_FUNCTIONS = ["prop", "if", ...Object.keys(FUNCS)];

export function evaluate(node: Node, getProp: (name: string) => FValue, budget = { steps: 0 }): FValue {
  if (++budget.steps > 10000) throw new FormulaError("Formula too expensive");
  switch (node.k) {
    case "lit": return node.v;
    case "un": {
      const a = evaluate(node.a, getProp, budget);
      return node.op === "-" ? -num(a) : !truthy(a);
    }
    case "bin": {
      if (node.op === "&&") return truthy(evaluate(node.a, getProp, budget)) && truthy(evaluate(node.b, getProp, budget));
      if (node.op === "||") return truthy(evaluate(node.a, getProp, budget)) || truthy(evaluate(node.b, getProp, budget));
      const a = evaluate(node.a, getProp, budget), b = evaluate(node.b, getProp, budget);
      switch (node.op) {
        case "+": return typeof a === "string" || typeof b === "string" ? str(a) + str(b) : num(a) + num(b);
        case "-": return num(a) - num(b);
        case "*": return num(a) * num(b);
        case "/": return num(b) === 0 ? null : num(a) / num(b);
        case "%": return num(b) === 0 ? null : num(a) % num(b);
        case "==": return str(a) === str(b);
        case "!=": return str(a) !== str(b);
        case "<": return typeof a === "string" && typeof b === "string" ? a < b : num(a) < num(b);
        case "<=": return typeof a === "string" && typeof b === "string" ? a <= b : num(a) <= num(b);
        case ">": return typeof a === "string" && typeof b === "string" ? a > b : num(a) > num(b);
        case ">=": return typeof a === "string" && typeof b === "string" ? a >= b : num(a) >= num(b);
      }
      throw new FormulaError(`Unknown operator ${node.op}`);
    }
    case "call": {
      if (node.name === "prop") {
        const n = node.args[0];
        if (!n) throw new FormulaError("prop() needs a name");
        return getProp(str(evaluate(n, getProp, budget)));
      }
      if (node.name === "if") {
        const [c, a, b] = node.args;
        if (!c || !a) throw new FormulaError("if(condition, then, else)");
        return truthy(evaluate(c, getProp, budget)) ? evaluate(a, getProp, budget) : b ? evaluate(b, getProp, budget) : null;
      }
      const f = FUNCS[node.name];
      if (!f) throw new FormulaError(`Unknown function ${node.name}()`);
      return f(node.args.map((a) => evaluate(a, getProp, budget)));
    }
  }
}

const cache = new Map<string, Node | FormulaError>();
/** Evaluate a formula string; returns `{ error }` instead of throwing. */
export function runFormula(src: string, getProp: (name: string) => FValue): { value: FValue; error?: string } {
  let tree = cache.get(src);
  if (!tree) {
    try { tree = parseFormula(src); } catch (e) { tree = e instanceof FormulaError ? e : new FormulaError(String(e)); }
    if (cache.size > 500) cache.clear();
    cache.set(src, tree);
  }
  if (tree instanceof FormulaError) return { value: null, error: tree.message };
  try { return { value: evaluate(tree, getProp) }; } catch (e) { return { value: null, error: e instanceof Error ? e.message : String(e) }; }
}
