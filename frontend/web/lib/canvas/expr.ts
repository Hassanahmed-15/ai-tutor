/**
 * A tiny, safe expression language for canvas boards: curve formulas, slider bindings and reaction
 * conditions the model writes ("40 * light / (25 + light)", "light > 70 && co2 < 30").
 *
 * Never `eval` or `new Function`: the text comes from a model. This is a recursive-descent parser
 * over numbers, variables, + - * / ^ %, comparisons, && || !, a ? b : c, and a fixed list of maths
 * functions. Anything else fails to parse and the caller treats the expression as absent.
 */

type Node =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "un"; op: "-" | "!"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "cond"; c: Node; a: Node; b: Node }
  | { t: "call"; fn: string; args: Node[] };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pow: Math.pow,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const TOKEN = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|&&|\|\||==|!=|<=|>=|[-+*/^%(),<>!?:])/y;

function tokenize(src: string): string[] | null {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  const text = src.replace(/\*\*/g, "^").replace(/×/g, "*").replace(/−/g, "-");
  while (TOKEN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) break;
    const m = TOKEN.exec(text);
    if (!m) return null;
    out.push(m[1]);
  }
  return out;
}

function parse(tokens: string[]): Node | null {
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];

  function ternary(): Node {
    const c = or();
    if (peek() === "?") {
      take();
      const a = ternary();
      if (take() !== ":") throw new Error("expected :");
      const b = ternary();
      return { t: "cond", c, a, b };
    }
    return c;
  }
  function binary(next: () => Node, ops: string[]): () => Node {
    return () => {
      let a = next();
      while (ops.includes(peek())) {
        const op = take();
        a = { t: "bin", op, a, b: next() };
      }
      return a;
    };
  }
  const power = (): Node => {
    const a = unary();
    if (peek() === "^") {
      take();
      return { t: "bin", op: "^", a, b: power() };
    }
    return a;
  };
  const mul = binary(power, ["*", "/", "%"]);
  const add = binary(mul, ["+", "-"]);
  const cmp = binary(add, ["<", ">", "<=", ">=", "==", "!="]);
  const and = binary(cmp, ["&&"]);
  const or = binary(and, ["||"]);

  function unary(): Node {
    if (peek() === "-" || peek() === "!") {
      const op = take() as "-" | "!";
      return { t: "un", op, a: unary() };
    }
    if (peek() === "+") {
      take();
      return unary();
    }
    return atom();
  }
  function atom(): Node {
    const tok = take();
    if (tok === undefined) throw new Error("unexpected end");
    if (tok === "(") {
      const inner = ternary();
      if (take() !== ")") throw new Error("expected )");
      return inner;
    }
    if (/^[\d.]/.test(tok)) return { t: "num", v: Number(tok) };
    if (/^[A-Za-z_]/.test(tok)) {
      if (peek() === "(") {
        take();
        const args: Node[] = [];
        if (peek() !== ")") {
          args.push(ternary());
          while (peek() === ",") {
            take();
            args.push(ternary());
          }
        }
        if (take() !== ")") throw new Error("expected )");
        if (!FUNCTIONS[tok.toLowerCase()]) throw new Error(`unknown function ${tok}`);
        return { t: "call", fn: tok.toLowerCase(), args };
      }
      return { t: "var", name: tok };
    }
    throw new Error(`unexpected ${tok}`);
  }

  try {
    const node = ternary();
    return i === tokens.length ? node : null;
  } catch {
    return null;
  }
}

function run(node: Node, vars: Record<string, number>): number {
  switch (node.t) {
    case "num":
      return node.v;
    case "var":
      if (node.name in vars) return vars[node.name];
      if (node.name.toLowerCase() in CONSTANTS) return CONSTANTS[node.name.toLowerCase()];
      return NaN;
    case "un":
      return node.op === "-" ? -run(node.a, vars) : run(node.a, vars) ? 0 : 1;
    case "cond":
      return run(node.c, vars) ? run(node.a, vars) : run(node.b, vars);
    case "call":
      return FUNCTIONS[node.fn](...node.args.map((a) => run(a, vars)));
    case "bin": {
      const a = run(node.a, vars);
      const b = run(node.b, vars);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case "^": return Math.pow(a, b);
        case "<": return a < b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "==": return a === b ? 1 : 0;
        case "!=": return a !== b ? 1 : 0;
        case "&&": return a && b ? 1 : 0;
        case "||": return a || b ? 1 : 0;
      }
      return NaN;
    }
  }
}

export type CompiledExpr = { vars: string[]; eval: (vars: Record<string, number>) => number };

const cache = new Map<string, CompiledExpr | null>();

/** Compile once; null when the text is not a valid expression. */
export function compileExpr(src: string | undefined | null): CompiledExpr | null {
  if (!src || typeof src !== "string" || src.length > 300) return null;
  if (cache.has(src)) return cache.get(src)!;
  const tokens = tokenize(src);
  const node = tokens && tokens.length ? parse(tokens) : null;
  let compiled: CompiledExpr | null = null;
  if (node) {
    const names = new Set<string>();
    const walk = (n: Node) => {
      if (n.t === "var" && !(n.name.toLowerCase() in CONSTANTS)) names.add(n.name);
      if (n.t === "un") walk(n.a);
      if (n.t === "bin") { walk(n.a); walk(n.b); }
      if (n.t === "cond") { walk(n.c); walk(n.a); walk(n.b); }
      if (n.t === "call") n.args.forEach(walk);
    };
    walk(node);
    compiled = { vars: [...names], eval: (vars) => run(node, vars) };
  }
  cache.set(src, compiled);
  return compiled;
}

/** Evaluate, returning `fallback` for anything that does not parse or is not a finite number. */
export function evalExpr(src: string | undefined | null, vars: Record<string, number>, fallback = NaN): number {
  const compiled = compileExpr(src);
  if (!compiled) return fallback;
  const v = compiled.eval(vars);
  return Number.isFinite(v) ? v : fallback;
}

/** True when the expression parses and every variable it reads is one of `known` (plus `x` for curves). */
export function exprUsesOnly(src: string | undefined, known: string[]): boolean {
  const compiled = compileExpr(src);
  return Boolean(compiled) && compiled!.vars.every((v) => known.includes(v));
}
