// Safe maths expressions for scene specs: "x^2 - 4x + 3", "5tan(35deg)", "slope(f, t)".
// A small parser compiles text into a closure; nothing is ever passed to eval. It accepts the way
// people (and models) write maths: implicit multiplication (4x, 2(x+1), 35deg), ^ for powers,
// and the Unicode signs − × ÷ π ² ³.

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
  min: Math.min, max: Math.max, round: Math.round,
  // Counting, for probability: nCr(5, 2), nPr(5, 2), fact(4).
  fact: (n) => factorial(n), nCr: (n, r) => (r < 0 || r > n ? 0 : factorial(n) / (factorial(r) * factorial(n - r))), nPr: (n, r) => (r < 0 || r > n ? 0 : factorial(n) / factorial(n - r)),
  // Degree versions, for geometry written in degrees.
  sind: (d) => Math.sin((d * Math.PI) / 180), cosd: (d) => Math.cos((d * Math.PI) / 180), tand: (d) => Math.tan((d * Math.PI) / 180),
  asind: (v) => (Math.asin(v) * 180) / Math.PI, acosd: (v) => (Math.acos(v) * 180) / Math.PI, atand: (v) => (Math.atan(v) * 180) / Math.PI,
  // The direction of (x, y) from the origin: atan2(y, x) in radians, atan2d(y, x) in degrees.
  atan2: (y, x) => Math.atan2(y, x), atan2d: (y, x) => (Math.atan2(y, x) * 180) / Math.PI,
};
const CONSTS = { pi: Math.PI, e: Math.E, deg: Math.PI / 180, rad: 1 };
const WORDS = new Set(["and", "or", "not"]);

function factorial(n) {
  n = Math.round(n);
  if (n < 0) return NaN;
  let f = 1;
  for (let k = 2; k <= n; k++) f *= k;
  return f;
}

export function normalise(src) {
  return String(src)
    .replace(/π/g, "pi")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/θ/g, "theta");
}

function tokenize(src) {
  const out = [];
  // Names may have dotted parts: the corners of a polygon (T.1), a scatter's mean point (S.mean).
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)|(<=|>=|==|!=|&&|\|\||\S))/gy;
  let m;
  let pos = 0;
  while (pos < src.length && (m = re.exec(src)) && m[0].length) {
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push(WORDS.has(m[2]) ? { t: "op", v: m[2] } : { t: "id", v: m[2] });
    else if (m[3] !== undefined) out.push({ t: "op", v: { "&&": "and", "||": "or", "!": "not" }[m[3]] ?? m[3] });
  }
  // A failed sticky match resets lastIndex, so the position is tracked separately.
  if (src.slice(pos).trim()) throw new Error(`can't read "${src.slice(pos)}"`);
  return out;
}

/** Parses into a tree: {k:'num'|'var'|'call'|'bin'|'neg', ...}. */
export function parse(source) {
  const src = normalise(source);
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`expected "${v}" in "${source}"`);
    i++;
  };
  const startsPrimary = () => {
    const p = peek();
    return p && (p.t === "num" || p.t === "id" || (p.t === "op" && p.v === "("));
  };
  // Lowest first: or, and, not, comparisons, then arithmetic. A comparison is 1 when true, 0 when not.
  function logic() {
    let left = conj();
    while (isOp("or")) {
      i++;
      left = { k: "bin", op: "or", a: left, b: conj() };
    }
    return left;
  }
  function conj() {
    let left = negation();
    while (isOp("and")) {
      i++;
      left = { k: "bin", op: "and", a: left, b: negation() };
    }
    return left;
  }
  function negation() {
    if (isOp("not")) {
      i++;
      return { k: "not", a: negation() };
    }
    return compare();
  }
  function compare() {
    const left = sum();
    for (const op of ["<=", ">=", "==", "!=", "<", ">", "="]) {
      if (isOp(op)) {
        i++;
        return { k: "bin", op: op === "=" ? "==" : op, a: left, b: sum() };
      }
    }
    return left;
  }
  function sum() {
    let left = product();
    while (isOp("+") || isOp("-")) {
      const op = toks[i++].v;
      left = { k: "bin", op, a: left, b: product() };
    }
    return left;
  }
  function product() {
    let left = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = toks[i++].v;
        left = { k: "bin", op, a: left, b: unary() };
      } else if (startsPrimary()) {
        // Implicit multiplication: 4x, 2(x + 1), x y.
        left = { k: "bin", op: "*", a: left, b: power() };
      } else return left;
    }
  }
  function unary() {
    if (isOp("-")) {
      i++;
      return { k: "neg", a: unary() };
    }
    if (isOp("+")) {
      i++;
      return unary();
    }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp("^")) {
      i++;
      return { k: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  }
  function primary() {
    const p = peek();
    if (!p) throw new Error(`"${source}" ends too early`);
    if (p.t === "num") {
      i++;
      return { k: "num", v: p.v };
    }
    if (p.t === "id") {
      i++;
      if (isOp("(")) {
        i++;
        const args = [];
        if (!isOp(")")) {
          args.push(logic());
          while (isOp(",")) {
            i++;
            args.push(logic());
          }
        }
        expect(")");
        return { k: "call", name: p.v, args };
      }
      return { k: "var", name: p.v };
    }
    if (p.t === "op" && p.v === "(") {
      i++;
      const e = logic();
      expect(")");
      return e;
    }
    throw new Error(`unexpected "${p.v}" in "${source}"`);
  }
  const tree = logic();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}" in "${source}"`);
  return tree;
}

/** Names the tree uses, so the checker can find references to things that do not exist. */
export function namesIn(tree, acc = { vars: new Set(), calls: new Set(), args: [] }) {
  if (tree.k === "var") acc.vars.add(tree.name);
  else if (tree.k === "call") {
    acc.calls.add(tree.name);
    acc.args.push({ name: tree.name, args: tree.args });
    tree.args.forEach((a) => namesIn(a, acc));
  } else if (tree.k === "bin") {
    namesIn(tree.a, acc);
    namesIn(tree.b, acc);
  } else if (tree.k === "neg" || tree.k === "not") namesIn(tree.a, acc);
  return acc;
}

/**
 * Compiles to fn(env). env.vars: name → number or () => number; env.funcs: name → function taking
 * (args as numbers) or, when env.rawArgs has the name, taking the unevaluated argument trees (so
 * slope(f, t) can receive the name f).
 */
export function compile(source) {
  const tree = typeof source === "number" ? { k: "num", v: source } : parse(source);
  const run = (n, env) => {
    switch (n.k) {
      case "num":
        return n.v;
      case "neg":
        return -run(n.a, env);
      case "not":
        return run(n.a, env) ? 0 : 1;
      case "bin": {
        if (n.op === "and") return run(n.a, env) && run(n.b, env) ? 1 : 0;
        if (n.op === "or") return run(n.a, env) || run(n.b, env) ? 1 : 0;
        const a = run(n.a, env), b = run(n.b, env);
        switch (n.op) {
          case "<": return a < b ? 1 : 0;
          case ">": return a > b ? 1 : 0;
          case "<=": return a <= b + 1e-12 ? 1 : 0;
          case ">=": return a >= b - 1e-12 ? 1 : 0;
          case "==": return Math.abs(a - b) < 1e-9 ? 1 : 0;
          case "!=": return Math.abs(a - b) >= 1e-9 ? 1 : 0;
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return a / b;
          case "^": return Math.pow(a, b);
        }
        return NaN;
      }
      case "var": {
        if (env.vars && Object.hasOwn(env.vars, n.name)) {
          const v = env.vars[n.name];
          return typeof v === "function" ? v() : v;
        }
        if (n.name in CONSTS) return CONSTS[n.name];
        throw new Error(`unknown name "${n.name}"`);
      }
      case "call": {
        const user = env.funcs && env.funcs[n.name];
        if (user) return env.rawArgs && env.rawArgs.has(n.name) ? user(n.args, env, run) : user(...n.args.map((a) => run(a, env)));
        const f = FUNCS[n.name];
        if (!f) throw new Error(`unknown function "${n.name}"`);
        return f(...n.args.map((a) => run(a, env)));
      }
    }
    return NaN;
  };
  const fn = (env) => run(tree, env);
  fn.tree = tree;
  return fn;
}

export const KNOWN = { funcs: Object.keys(FUNCS), consts: Object.keys(CONSTS) };

/** "{2t:1}" → 2.0 ; "{dist(A,B):3sf}" ; "{x:0}". Formats a number for a label. */
export function formatNumber(v, fmt) {
  if (!Number.isFinite(v)) return "?";
  // Rounding dust from a solver (2e-12) is zero.
  if (Math.abs(v) < 1e-9) v = 0;
  if (fmt === "pi") return asPi(v);
  if (fmt === "frac") return asFraction(v);
  if (fmt && /sf$/.test(fmt)) return String(Number(v.toPrecision(Number(fmt.replace("sf", "")) || 3)));
  const dp = fmt === undefined || fmt === "" ? null : Number(fmt);
  let s;
  if (dp === null) {
    // No format: an exact-looking value (at most 3 decimals) as it is; anything longer to 3 s.f.
    const r = Number(v.toPrecision(10));
    s = Math.abs(r * 1000 - Math.round(r * 1000)) < 1e-6 ? String(r) : String(Number(v.toPrecision(3)));
  } else s = v.toFixed(dp);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace("-", "−");
}

/** The fraction p/q (q ≤ 12) within rounding of v, or null. */
function fractionOf(v) {
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(v * q);
    if (Math.abs(p / q - v) < 1e-9) return [p, q];
  }
  return null;
}

/** 1.5707… → "π/2", 4.712… → "3π/2", −3.14… → "−π"; other numbers as decimals. */
export function asPi(v) {
  if (Math.abs(v) < 1e-12) return "0";
  const f = fractionOf(v / Math.PI);
  if (!f) return formatNumber(v, "3sf");
  const [p, q] = f;
  const sign = p < 0 ? "−" : "";
  const top = Math.abs(p) === 1 ? "π" : `${Math.abs(p)}π`;
  return q === 1 ? sign + top : `${sign}${top}/${q}`;
}

/** 0.75 → "3/4", 2 → "2"; other numbers as decimals. */
export function asFraction(v) {
  const f = fractionOf(v);
  if (!f) return formatNumber(v, "3sf");
  const [p, q] = f;
  return q === 1 ? formatNumber(p) : `${p < 0 ? "−" : ""}${Math.abs(p)}/${q}`;
}
