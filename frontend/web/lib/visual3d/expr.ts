// Safe maths expressions: "x^2 - y^2", "sin(x)*cos(y)", "2(x+1)", "exp(-(x^2+y^2)/4)".
// A small recursive-descent parser compiles text into a closure. Nothing is ever passed to eval or
// new Function, and only whitelisted functions and constants exist, so model output cannot run
// code. Ported from maths-lab/engine/expr.js (proven on 114 boards).

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "call"; name: string; args: Node[] }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "neg"; a: Node };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10,
  exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, sign: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
export const ALLOWED_FUNCTIONS = Object.keys(FUNCS);
const MAX_LENGTH = 200;

function normalise(src: string): string {
  return src.replace(/π/g, "pi").replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/²/g, "^2").replace(/³/g, "^3");
}

function tokenize(src: string): { t: "num" | "id" | "op"; v: string }[] {
  const out: { t: "num" | "id" | "op"; v: string }[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(\S))/gy;
  let pos = 0;
  let m: RegExpExecArray | null;
  while (pos < src.length && (m = re.exec(src)) && m[0].length) {
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: "num", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "id", v: m[2] });
    else out.push({ t: "op", v: m[3] });
  }
  if (src.slice(pos).trim()) throw new Error(`can't read "${src.slice(pos)}"`);
  return out;
}

export function parse(source: string): Node {
  if (typeof source !== "string") throw new Error("an expression must be text");
  if (source.length > MAX_LENGTH) throw new Error(`expression is longer than ${MAX_LENGTH} characters`);
  const toks = tokenize(normalise(source));
  let i = 0;
  const isOp = (v: string) => toks[i]?.t === "op" && toks[i].v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}" in "${source}"`);
    i++;
  };
  const startsPrimary = () => !!toks[i] && (toks[i].t !== "op" || toks[i].v === "(");
  const sum = (): Node => {
    let left = product();
    while (isOp("+") || isOp("-")) left = { k: "bin", op: toks[i++].v, a: left, b: product() };
    return left;
  };
  const product = (): Node => {
    let left = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) left = { k: "bin", op: toks[i++].v, a: left, b: unary() };
      else if (startsPrimary()) left = { k: "bin", op: "*", a: left, b: power() }; // 2x, 2(x+1)
      else return left;
    }
  };
  const unary = (): Node => {
    if (isOp("-")) return i++, { k: "neg", a: unary() };
    if (isOp("+")) return i++, unary();
    return power();
  };
  const power = (): Node => {
    const base = primary();
    if (isOp("^")) return i++, { k: "bin", op: "^", a: base, b: unary() };
    return base;
  };
  const primary = (): Node => {
    const p = toks[i];
    if (!p) throw new Error(`"${source}" ends too early`);
    if (p.t === "num") return i++, { k: "num", v: Number(p.v) };
    if (p.t === "id") {
      i++;
      if (isOp("(")) {
        i++;
        const args: Node[] = [];
        if (!isOp(")")) {
          args.push(sum());
          while (isOp(",")) i++, args.push(sum());
        }
        expect(")");
        if (!Object.hasOwn(FUNCS, p.v)) throw new Error(`unknown function "${p.v}" (allowed: ${ALLOWED_FUNCTIONS.join(", ")})`);
        return { k: "call", name: p.v, args };
      }
      return { k: "var", name: p.v };
    }
    if (p.v === "(") {
      i++;
      const e = sum();
      expect(")");
      return e;
    }
    throw new Error(`unexpected "${p.v}" in "${source}"`);
  };
  const tree = sum();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}" in "${source}"`);
  return tree;
}

function varsIn(n: Node, acc = new Set<string>()): Set<string> {
  if (n.k === "var") acc.add(n.name);
  else if (n.k === "call") n.args.forEach((a) => varsIn(a, acc));
  else if (n.k === "bin") (varsIn(n.a, acc), varsIn(n.b, acc));
  else if (n.k === "neg") varsIn(n.a, acc);
  return acc;
}

/** Compile an expression in the given variables, e.g. compile("x^2 - y^2", ["x", "y"]) → (x, y) => number. */
export function compile(source: string, variables: string[]): (...values: number[]) => number {
  const tree = parse(source);
  // Object.hasOwn, not "in": names like "constructor" must not reach Object.prototype.
  for (const v of varsIn(tree)) if (!variables.includes(v) && !Object.hasOwn(CONSTS, v)) throw new Error(`unknown name "${v}" in "${source}" (use ${variables.join(", ")})`);
  const run = (n: Node, env: Record<string, number>): number => {
    switch (n.k) {
      case "num": return n.v;
      case "neg": return -run(n.a, env);
      case "var": return Object.hasOwn(env, n.name) ? env[n.name] : CONSTS[n.name];
      case "call": return FUNCS[n.name](...n.args.map((a) => run(a, env)));
      case "bin": {
        const a = run(n.a, env), b = run(n.b, env);
        return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? a / b : Math.pow(a, b);
      }
    }
  };
  return (...values: number[]) => {
    const env: Record<string, number> = {};
    variables.forEach((v, k) => (env[v] = values[k]));
    return run(tree, env);
  };
}

/** Round for display: 3 significant figures, tiny values to 0. */
export function fmt(v: number, sf = 3): number {
  if (!Number.isFinite(v)) return v;
  if (Math.abs(v) < 1e-9) return 0;
  return Number(v.toPrecision(sf));
}
