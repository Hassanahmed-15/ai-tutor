import type { FigureComponent, FigureParams, FigurePart, FigureShape } from "../types";
import { PALETTE } from "./mathsKit";

/**
 * A LOGIC CIRCUIT AND ITS TRUTH TABLE, DRAWN BY CODE (2026-10-21, QA batch 7: logic gates drawn
 * freely by the model came out as odd shapes with doubled, crossing labels). The board writer gives
 * only the Boolean expression — "(A OR B) AND NOT R" — and code draws the standard (ANSI) gate
 * symbols Cambridge 0478/2210/9618 use, wires them, labels inputs and output, and COMPUTES every row
 * of the truth table, so the table is always right.
 */

type Op = "AND" | "OR" | "NOT" | "NAND" | "NOR" | "XOR" | "XNOR";
type Node = { kind: "var"; name: string } | { kind: "gate"; op: Op; inputs: Node[] };

/* ── parsing ───────────────────────────────────────────────────────────────────────────── */

const OP_WORDS: Record<string, Op> = { AND: "AND", OR: "OR", NOT: "NOT", NAND: "NAND", NOR: "NOR", XOR: "XOR", XNOR: "XNOR", "∧": "AND", "·": "AND", "&": "AND", "&&": "AND", "*": "AND", "∨": "OR", "+": "OR", "|": "OR", "||": "OR", "¬": "NOT", "~": "NOT", "!": "NOT", "⊕": "XOR", "^": "XOR" };

function tokenize(src: string): string[] {
  return src.replace(/[()]/g, " $& ").replace(/(&&|\|\||[∧∨¬~!⊕·&|*+^])/g, " $1 ").split(/\s+/).filter(Boolean);
}

/** Expression → tree. NOT binds tightest, then AND/NAND, then XOR/XNOR, then OR/NOR. Null when it cannot be read. */
export function parseLogic(src: string): Node | null {
  const toks = tokenize(String(src ?? ""));
  let i = 0;
  const op = (t: string | undefined) => (t ? OP_WORDS[t.toUpperCase()] ?? OP_WORDS[t] : undefined);
  const atom = (): Node | null => {
    const t = toks[i];
    if (t === undefined) return null;
    if (op(t) === "NOT") {
      i++;
      const inner = atom();
      return inner ? { kind: "gate", op: "NOT", inputs: [inner] } : null;
    }
    if (t === "(") {
      i++;
      const inner = level(0);
      if (toks[i] !== ")") return null;
      i++;
      return inner;
    }
    if (/^[A-Za-z][A-Za-z0-9_]{0,9}$/.test(t) && !op(t)) {
      i++;
      return { kind: "var", name: t.length === 1 ? t.toUpperCase() : t };
    }
    return null;
  };
  const LEVELS: Op[][] = [["OR", "NOR"], ["XOR", "XNOR"], ["AND", "NAND"]];
  const level = (n: number): Node | null => {
    if (n >= LEVELS.length) return atom();
    let left = level(n + 1);
    if (!left) return null;
    for (;;) {
      const o = op(toks[i]);
      if (!o || !LEVELS[n].includes(o)) return left;
      i++;
      const right = level(n + 1);
      if (!right) return null;
      // A chain of the same plain gate is one gate with up to three inputs (A AND B AND C).
      if (left.kind === "gate" && left.op === o && (o === "AND" || o === "OR") && left.inputs.length < 3) left = { kind: "gate", op: o, inputs: [...left.inputs, right] };
      else left = { kind: "gate", op: o, inputs: [left, right] };
    }
  };
  const tree = level(0);
  return tree && i === toks.length ? tree : null;
}

function evaluate(n: Node, v: Record<string, boolean>): boolean {
  if (n.kind === "var") return v[n.name];
  const xs = n.inputs.map((c) => evaluate(c, v));
  switch (n.op) {
    case "AND": return xs.every(Boolean);
    case "OR": return xs.some(Boolean);
    case "NOT": return !xs[0];
    case "NAND": return !xs.every(Boolean);
    case "NOR": return !xs.some(Boolean);
    case "XOR": return xs.filter(Boolean).length % 2 === 1;
    case "XNOR": return xs.filter(Boolean).length % 2 === 0;
  }
}

function variables(n: Node, out: string[] = []): string[] {
  if (n.kind === "var") { if (!out.includes(n.name)) out.push(n.name); }
  else n.inputs.forEach((c) => variables(c, out));
  return out;
}

/** The truth table code computes: inputs in binary order, then the output. */
export function truthTable(expression: string): { vars: string[]; rows: Array<{ inputs: boolean[]; output: boolean }> } | null {
  const tree = parseLogic(expression);
  if (!tree) return null;
  const vars = variables(tree).sort();
  const rows = Array.from({ length: 2 ** vars.length }, (_, r) => {
    const inputs = vars.map((_, k) => Boolean((r >> (vars.length - 1 - k)) & 1));
    return { inputs, output: evaluate(tree, Object.fromEntries(vars.map((name, k) => [name, inputs[k]]))) };
  });
  return { vars, rows };
}

/* ── drawing ───────────────────────────────────────────────────────────────────────────── */

const W = 66;
const H = 48;
const COL = 150;
const SLOT = 74;
const LEFT = 60;
const TOP = 30;

function gateShape(op: Op, x: number, y: number): { d: string; outX: number; inX: number; bubble?: { cx: number; r: number }; extra?: string } {
  const top = y - H / 2, bot = y + H / 2;
  if (op === "NOT") return { d: `M${x} ${top + 4} L${x + W - 14} ${y} L${x} ${bot - 4} Z`, outX: x + W, inX: x, bubble: { cx: x + W - 8, r: 6 } };
  if (op === "AND" || op === "NAND") {
    const r = H / 2;
    const flat = W - r - (op === "NAND" ? 12 : 0);
    return { d: `M${x} ${top} H${x + flat} A${r} ${r} 0 0 1 ${x + flat} ${bot} H${x} Z`, outX: op === "NAND" ? x + flat + r + 12 : x + flat + r, inX: x, ...(op === "NAND" ? { bubble: { cx: x + flat + r + 6, r: 6 } } : {}) };
  }
  // OR family: a curved back, two curved sides meeting at the point.
  const tip = op === "NOR" || op === "XNOR" ? x + W - 12 : x + W;
  const d = `M${x} ${top} Q${x + (tip - x) * 0.62} ${top} ${tip} ${y} Q${x + (tip - x) * 0.62} ${bot} ${x} ${bot} Q${x + 16} ${y} ${x} ${top} Z`;
  const extra = op === "XOR" || op === "XNOR" ? `M${x - 9} ${top} Q${x + 7} ${y} ${x - 9} ${bot}` : undefined;
  return { d, outX: op === "NOR" || op === "XNOR" ? tip + 12 : tip, inX: x + 9, extra, ...(op === "NOR" || op === "XNOR" ? { bubble: { cx: tip + 6, r: 6 } } : {}) };
}

export const logicCircuit: FigureComponent = {
  name: "logicCircuit",
  title: "A logic circuit drawn by code from its Boolean expression, with standard AND, OR, NOT, NAND, NOR and XOR gate symbols, and its truth table computed by code",
  params: `expression (the circuit's Boolean expression with AND, OR, NOT, NAND, NOR, XOR and brackets, e.g. "(A OR B) AND NOT C", "NOT (A AND B)", "A XOR B"; inputs are single letters or short names; default "A AND B"); output (the output's name, default "Q"); table (true default: the truth table, computed by code, beside the circuit — false to draw the circuit alone). Reveal parts in teaching order: inputs, then each gate (gate-1 is the gate nearest the inputs, the highest number is the output gate), then output, then truth-table.`,
  match: /\blogic (gates?|circuits?|diagrams?)\b|\btruth tables?\b|\b(AND|OR|NOT|NAND|NOR|XOR|XNOR) gates?\b|\bboolean (expressions?|logic|algebra)\b|\blogic expressions?\b/i,
  parts: [
    { id: "inputs", name: "Inputs" },
    { id: "gate-1", name: "First gate" },
    { id: "gate-2", name: "Second gate" },
    { id: "gate-3", name: "Third gate" },
    { id: "gate-4", name: "Fourth gate" },
    { id: "gate-5", name: "Fifth gate" },
    { id: "gate-6", name: "Sixth gate" },
    { id: "output", name: "Output" },
    { id: "truth-table", name: "Truth table" },
  ],
  selfLabelled: true,
  build(params: FigureParams) {
    const expression = String(params.expression ?? "A AND B");
    const tree = parseLogic(expression) ?? parseLogic("A AND B")!;
    const outName = String(params.output ?? "Q").slice(0, 8) || "Q";
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];

    // Columns: leaves at 0, each gate one column right of its deepest input.
    const colOf = (n: Node): number => (n.kind === "var" ? 0 : 1 + Math.max(...n.inputs.map(colOf)));
    const maxCol = colOf(tree);
    let slot = 0;
    let gateNo = 0;
    // y of each node: leaves take slots in reading order, a gate sits at the middle of its inputs.
    const place = (n: Node): { y: number; outX: number; outY: number } => {
      if (n.kind === "var") {
        const y = TOP + slot++ * SLOT + H / 2;
        return { y, outX: LEFT, outY: y };
      }
      const ins = n.inputs.map(place);
      const y = (Math.min(...ins.map((p) => p.outY)) + Math.max(...ins.map((p) => p.outY))) / 2;
      const col = colOf(n);
      const x = LEFT + 40 + (col - 1) * COL + (maxCol - col) * 0;
      const g = gateShape(n.op, x, y);
      gateNo++;
      // Up to six gates are named parts (a school circuit has fewer); any beyond are drawn, not named.
      const id = gateNo <= 6 ? `gate-${gateNo}` : undefined;
      // Wires from each input to its pin: across, down or up, across.
      const pins = ins.map((_, k) => (ins.length === 1 ? y : y - H / 2 + ((k + 1) * H) / (ins.length + 1)));
      ins.forEach((p, k) => {
        const midX = p.outX + Math.max(14, (g.inX - p.outX) / 2);
        shapes.push({ t: "path", d: `M${p.outX} ${p.outY} H${midX} V${pins[k]} H${g.inX}`, fill: "none", stroke: "ink", width: 2.6, part: id, ...(id ? { show: id } : {}) });
      });
      const when = id ? { show: id } : {};
      shapes.push({ t: "path", d: g.d, fill: "#60a5fa33", stroke: PALETTE.blue, width: 3, part: id, ...when });
      if (g.extra) shapes.push({ t: "path", d: g.extra, fill: "none", stroke: PALETTE.blue, width: 3, part: id, ...when });
      if (g.bubble) shapes.push({ t: "circle", cx: g.bubble.cx, cy: y, r: g.bubble.r, fill: "#000000", stroke: PALETTE.blue, width: 3, part: id, ...when });
      // The gate's name inside it, clear of its sloping sides.
      shapes.push({ t: "text", x: x + (n.op === "NOT" ? 17 : n.op === "AND" || n.op === "NAND" ? 24 : 30), y: y + 5, text: n.op, size: n.op === "NOT" ? 11 : n.op.length > 3 ? 12 : 14, anchor: "middle", fill: "ink", part: id, ...when });
      if (id) parts.push({ id, name: `${n.op} gate`, anchor: { x: x + 22, y } });
      return { y, outX: g.outX, outY: y };
    };
    const out = place(tree);
    // Input terminals and their names, at the left edge.
    let k = 0;
    const leafNames: string[] = [];
    const walk = (n: Node) => { if (n.kind === "var") leafNames.push(n.name); else n.inputs.forEach(walk); };
    walk(tree);
    for (const name of leafNames) {
      const y = TOP + k++ * SLOT + H / 2;
      shapes.push({ t: "circle", cx: LEFT, cy: y, r: 4, fill: "ink", stroke: "none", part: "inputs" });
      shapes.push({ t: "text", x: LEFT - 12, y: y + 7, text: name, size: 22, anchor: "end", fill: PALETTE.amber, part: "inputs" });
    }
    parts.unshift({ id: "inputs", name: "Inputs", anchor: { x: LEFT, y: TOP + H / 2 } });
    // The output wire and its name.
    const endX = out.outX + 46;
    shapes.push({ t: "path", d: `M${out.outX} ${out.outY} H${endX}`, fill: "none", stroke: "ink", width: 2.6, part: "output", show: "output" });
    shapes.push({ t: "circle", cx: endX, cy: out.outY, r: 4, fill: "ink", stroke: "none", part: "output", show: "output" });
    shapes.push({ t: "text", x: endX + 10, y: out.outY + 8, text: outName, size: 24, anchor: "start", fill: PALETTE.green, part: "output", show: "output" });
    parts.push({ id: "output", name: `Output ${outName}`, anchor: { x: endX, y: out.outY } });

    const circuitW = endX + 10 + outName.length * 14 + 20;
    const circuitH = TOP + Math.max(1, slot) * SLOT + 10;
    let w = circuitW;
    let h = circuitH;

    // The truth table, computed by code.
    const table = truthTable(expression);
    if (table && params.table !== false && params.table !== "false" && table.vars.length <= 3) {
      const cols = [...table.vars, outName];
      // Each column as wide as its heading needs (the output's name can be a word).
      const widths = cols.map((c) => Math.max(44, c.length * 11 + 18));
      const xs = widths.map((_, j) => widths.slice(0, j).reduce((a, b) => a + b, 0));
      const cw = 44;
      const rh = 30;
      const tx = circuitW + 30;
      const ty = Math.max(10, (circuitH - (table.rows.length + 1) * rh) / 2);
      const tw = widths.reduce((a, b) => a + b, 0);
      const th = (table.rows.length + 1) * rh;
      const tt = { part: "truth-table", show: "truth-table" } as const;
      shapes.push({ t: "path", d: `M${tx} ${ty} H${tx + tw} V${ty + th} H${tx} Z`, fill: "none", stroke: "ink", width: 2, ...tt });
      shapes.push({ t: "path", d: `M${tx} ${ty + rh} H${tx + tw}`, fill: "none", stroke: "ink", width: 2, ...tt });
      shapes.push({ t: "path", d: `M${tx + xs[cols.length - 1]} ${ty} V${ty + th}`, fill: "none", stroke: "ink", width: 2, ...tt });
      cols.forEach((c, j) => shapes.push({ t: "text", x: tx + xs[j] + widths[j] / 2, y: ty + rh * 0.7, text: c, size: 17, anchor: "middle", fill: j === cols.length - 1 ? PALETTE.green : PALETTE.amber, ...tt }));
      table.rows.forEach((row, r) => {
        [...row.inputs, row.output].forEach((v, j) => shapes.push({ t: "text", x: tx + xs[j] + widths[j] / 2, y: ty + rh * (r + 1) + rh * 0.7, text: v ? "1" : "0", size: 17, anchor: "middle", fill: j === cols.length - 1 ? PALETTE.green : "ink", ...tt }));
      });
      void cw;
      parts.push({ id: "truth-table", name: "Truth table", anchor: { x: tx + tw / 2, y: ty + rh / 2 } });
      w = tx + tw + 10;
      h = Math.max(circuitH, ty + th + 10);
    }
    return { w, h, shapes, parts };
  },
};
