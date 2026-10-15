import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";

/**
 * CIRCUIT DIAGRAM with standard (IGCSE/AP) symbols. The model lists the components; code lays out a
 * rectangular loop with right-angled wires: the series components along the top (and the bottom, or
 * the left side when there are branches), each parallel branch as a rung of a ladder between two
 * rails, a voltmeter drawn in parallel across the component it measures, junction dots where wires
 * meet, and the conventional current arrow (clockwise: the cell's long plate, +, faces the way the
 * current leaves it).
 */

type Kind = "cell" | "battery" | "switch" | "ammeter" | "voltmeter" | "lamp" | "resistor" | "variable-resistor" | "fuse" | "diode" | "led" | "ldr" | "thermistor" | "motor";
type Item = { kind: Kind; value?: string; label?: string; open?: boolean; reverse?: boolean };

const NAMES: Record<Kind, string> = {
  cell: "Cell", battery: "Battery", switch: "Switch", ammeter: "Ammeter", voltmeter: "Voltmeter", lamp: "Lamp", resistor: "Resistor",
  "variable-resistor": "Variable resistor", fuse: "Fuse", diode: "Diode", led: "Light-emitting diode (LED)", ldr: "Light-dependent resistor (LDR)",
  thermistor: "Thermistor", motor: "Motor",
};
const KINDS = Object.keys(NAMES) as Kind[];

// Longest alias first so "variable resistor" is not read as "resistor".
const ALIASES: Array<[RegExp, Kind]> = [
  [/^(variable[\s-]*resistor|rheostat|potentiometer)/, "variable-resistor"],
  [/^(light[\s-]*dependent[\s-]*resistor|ldr)/, "ldr"],
  [/^(light[\s-]*emitting[\s-]*diode|led)\b/, "led"],
  [/^(thermistor)/, "thermistor"],
  [/^(resistor)/, "resistor"],
  [/^(battery|batteries)/, "battery"],
  [/^(cell|power supply|supply)/, "cell"],
  [/^(switch)/, "switch"],
  [/^(ammeter)/, "ammeter"],
  [/^(voltmeter)/, "voltmeter"],
  [/^(lamp|light bulb|bulb)/, "lamp"],
  [/^(fuse)/, "fuse"],
  [/^(diode)/, "diode"],
  [/^(motor)/, "motor"],
];

function parseItem(raw: string): Item | null {
  const s = raw.trim().toLowerCase();
  for (const [re, kind] of ALIASES) {
    const m = s.match(re);
    if (!m) continue;
    const rest = raw.trim().slice(m[0].length).replace(/^[\s:=(]+|[)\s]+$/g, "").trim();
    const item: Item = { kind };
    if (kind === "switch") item.open = !/closed|on\b/i.test(rest);
    else if ((kind === "diode" || kind === "led") && /reverse/i.test(rest)) item.reverse = true;
    else if (rest && /\d/.test(rest)) item.value = rest.replace(/\s*ohms?\b/i, " Ω").replace(/(\d)\s*(V|A|Ω|W)\b/, "$1 $2").slice(0, 10);
    else if (rest) item.label = rest.slice(0, 30);
    return item;
  }
  return null;
}
const parseList = (v: unknown, max: number): Item[] =>
  typeof v === "string" ? v.split(/[,;|]/).map(parseItem).filter((i): i is Item => Boolean(i)).slice(0, max) : [];

// ── geometry helpers ──────────────────────────────────────────────────────────────────────────
/** A placement frame: centre, the direction the current travels, and "up" (the outward side for the symbol's own top). */
type Frame = { c: Pt; d: Pt; u: Pt };
const g = (f: Frame, lx: number, ly: number): Pt => ({ x: f.c.x + lx * f.d.x - ly * f.u.x, y: f.c.y + lx * f.d.y - ly * f.u.y });
const fmt = (n: number) => Number(n.toFixed(2));
const poly = (f: Frame, pts: Array<[number, number]>, close = false) =>
  pts.map(([x, y], i) => { const p = g(f, x, y); return `${i ? "L" : "M"}${fmt(p.x)} ${fmt(p.y)}`; }).join(" ") + (close ? " Z" : "");
const line = (a: Pt, b: Pt) => `M${fmt(a.x)} ${fmt(a.y)} L${fmt(b.x)} ${fmt(b.y)}`;

const HALF = 30; // every symbol's terminals sit at ±HALF along the wire
const WIRE = 2.4;

/** One symbol, drawn in its frame; returns the point a label should point at: inside the symbol but off the wire (towards "up" when out is -1, away when 1), so a leader never runs along a wire. */
function drawSymbol(item: Item, f: Frame, shapes: FigureShape[], out: 1 | -1 = -1): Pt {
  const part = item.kind;
  // Decorations whose handedness is not physics (a lever, a light arrow) read left-to-right on every edge.
  const m = f.d.x < -0.5 ? -1 : 1;
  const stroke = (d: string, width = WIRE, fill: FigureShape["fill"] = "none") => shapes.push({ t: "path", part, d, stroke: "ink", width, fill });
  const leads = (inner: number) => stroke(poly(f, [[-HALF, 0], [-inner, 0]]) + " " + poly(f, [[inner, 0], [HALF, 0]]));
  const circle = (r: number, fill: FigureShape["fill"] = "none") => shapes.push({ t: "circle", part, cx: f.c.x, cy: f.c.y, r, fill, stroke: "ink", width: WIRE });
  const letter = (t: string) => shapes.push({ t: "text", part, x: f.c.x, y: f.c.y + 6, text: t, size: 17, anchor: "middle", fill: "ink" });
  const arrowHead = (tip: [number, number], from: [number, number], size = 7) => {
    const dx = tip[0] - from[0], dy = tip[1] - from[1], len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    shapes.push({ t: "path", part, d: poly(f, [tip, [tip[0] - ux * size - uy * size * 0.55, tip[1] - uy * size + ux * size * 0.55], [tip[0] - ux * size + uy * size * 0.55, tip[1] - uy * size - ux * size * 0.55]], true), fill: "ink", stroke: "ink", width: 1 });
  };
  const rect = (hw: number, hh: number) => stroke(poly(f, [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], true), WIRE, "none");
  switch (item.kind) {
    case "cell": {
      // Long thin plate (+) on the side the current leaves; short thick plate (−).
      leads(5);
      stroke(poly(f, [[-5, -10], [-5, 10]]), 5.5);
      stroke(poly(f, [[5, -21], [5, 21]]), 2.4);
      return g(f, 5, out * 14);
    }
    case "battery": {
      stroke(poly(f, [[-HALF, 0], [-15, 0]]) + " " + poly(f, [[15, 0], [HALF, 0]]));
      stroke(poly(f, [[-15, -10], [-15, 10]]) + " " + poly(f, [[3, -10], [3, 10]]), 5.5);
      stroke(poly(f, [[-3, -21], [-3, 21]]) + " " + poly(f, [[15, -21], [15, 21]]), 2.4);
      stroke(poly(f, [[-3, 0], [3, 0]]), 1.6);
      return g(f, 15, out * 14);
    }
    case "resistor":
      leads(20); rect(20, 8);
      return g(f, 0, out * 4);
    case "variable-resistor":
      leads(20); rect(20, 8);
      stroke(poly(f, [[-17 * m, 15], [15 * m, -15]]), 2);
      arrowHead([18 * m, -18], [-17 * m, 15]);
      return g(f, 0, out * 4);
    case "fuse":
      leads(18); rect(18, 7);
      stroke(poly(f, [[-18, 0], [18, 0]]), 1.8);
      return g(f, 0, out * 4);
    case "thermistor":
      leads(20); rect(20, 8);
      stroke(poly(f, [[-26 * m, 15], [-17 * m, 15], [17 * m, -15]]), 2);
      return g(f, 0, out * 4);
    case "ldr": {
      leads(19);
      circle(19);
      stroke(poly(f, [[-12, -6], [12, -6], [12, 6], [-12, 6]], true), 2.2, "none");
      for (const off of [-9, 5]) { stroke(poly(f, [[(off - 16) * m, -36], [(off - 3) * m, -23]]), 1.8); arrowHead([(off - 2) * m, -22], [(off - 16) * m, -36], 6); }
      return g(f, 0, out * 13);
    }
    case "lamp": {
      leads(14); circle(14);
      const k = 14 * Math.SQRT1_2;
      stroke(poly(f, [[-k, -k], [k, k]]) + " " + poly(f, [[-k, k], [k, -k]]), 2);
      return g(f, 0, out * 9);
    }
    case "ammeter":
    case "voltmeter":
    case "motor":
      leads(15); circle(15); letter(item.kind === "ammeter" ? "A" : item.kind === "voltmeter" ? "V" : "M");
      return g(f, 0, out * 11);
    case "switch": {
      stroke(poly(f, [[-HALF, 0], [-14, 0]]) + " " + poly(f, [[14, 0], [HALF, 0]]));
      shapes.push({ t: "circle", part, ...cxy(g(f, -14, 0)), r: 3.2, fill: "none", stroke: "ink", width: 2 });
      shapes.push({ t: "circle", part, ...cxy(g(f, 14, 0)), r: 3.2, fill: "none", stroke: "ink", width: 2 });
      stroke(poly(f, item.open ? [[-12 * m, -1.5], [12 * m, -15]] : [[-12, -1.5], [14, -2.5]]));
      return item.open ? g(f, 2 * m, -9.4) : g(f, 0, -2.3);
    }
    case "diode":
    case "led": {
      const s = item.reverse ? -1 : 1; // the triangle points the way current may pass
      leads(11);
      stroke(poly(f, [[-10 * s, -11], [10 * s, 0], [-10 * s, 11]], true), 2.2, "none");
      stroke(poly(f, [[-11, 0], [11, 0]]), 2);
      stroke(poly(f, [[10 * s, -11], [10 * s, 11]]), 2.6);
      if (item.kind === "led") for (const off of [-5, 6]) { stroke(poly(f, [[off * m, -15], [(off + 11) * m, -28]]), 1.8); arrowHead([(off + 13) * m, -30], [off * m, -15], 6); }
      return g(f, item.reverse ? 3 : -3, out * 4);
    }
  }
}
const cxy = (p: Pt) => ({ cx: fmt(p.x), cy: fmt(p.y) });

type Placed = { item: Item; f: Frame; side: "top" | "bottom" | "left" | "rung"; anchor?: Pt };

export const circuit: FigureComponent = {
  name: "circuit",
  title: "Circuit diagram with standard symbols: cells, switch, meters, lamps and resistors in series, parallel branches as rungs, a voltmeter across a component, and the conventional current arrow",
  params: `series (the main loop in order, comma-separated, each "type" or "type:value", ≤6, ≤60 characters, e.g. "cell:6 V, switch, ammeter, lamp"), branch1, branch2, branch3 (optional parallel branches, each a comma list like "lamp" or "resistor:4 Ω, ammeter"), voltmeterAcross (the component a voltmeter is connected across: "lamp", "resistor", "lamp2" = the second lamp, "cell"…), current (false hides the current arrow). Types: cell, battery, switch (value "open" or "closed"; default open), ammeter, voltmeter, lamp, resistor, variable resistor, fuse, diode, LED (value "reverse" for reverse-biased), LDR, thermistor, motor. Values with a number are written beside the symbol ("6 V", "2 Ω"). With no cell listed, a cell is added first.`,
  match: /\b(electric(al)? circuits?|circuit (diagram|symbols?)|series and parallel|in (series|parallel)|ammeters?|voltmeters?|resistors?|rheostats?|thermistors?|LDRs?|light[- ]dependent resistors?|potential dividers?)\b|\bcircuits?\b(?=.*\b(current|voltage|resist\w*|cells?|battery|lamps?|bulbs?|switch(es)?)\b)/i,
  parts: KINDS.map((k): { id: string; name: string } => ({ id: k, name: NAMES[k] })).concat([
    { id: "wire", name: "Connecting wire" },
    { id: "junction", name: "Junction" },
    { id: "current", name: "Conventional current (+ to −)" },
  ]),
  build(params: FigureParams) {
    let series = parseList(params.series, 6);
    if (!series.some((i) => i.kind === "cell" || i.kind === "battery")) series = [{ kind: "cell" } as Item, ...series].slice(0, 6);
    if (series.length < 2 && !["branch1", "branch2", "branch3"].some((k) => parseList(params[k], 1).length)) series.push({ kind: "lamp" });
    const branches = ["branch1", "branch2", "branch3"].map((k) => parseList(params[k], 3)).filter((b) => b.length);
    const showCurrent = params.current !== false;

    // Which edge each series component sits on.
    const top = branches.length ? series.slice(0, 4) : series.length >= 3 ? series.slice(0, Math.ceil(series.length / 2)) : series;
    const left = branches.length ? series.slice(4) : [];
    const bottom = branches.length ? [] : series.slice(top.length);

    // Find the voltmeter's component: "lamp2" is the second lamp in the order the current meets them.
    const order: Array<{ item: Item; where: "top" | "left" | "bottom" | number }> = [
      ...top.map((item) => ({ item, where: "top" as const })),
      ...bottom.map((item) => ({ item, where: "bottom" as const })),
      ...branches.flatMap((b, k) => b.map((item) => ({ item, where: k }))),
      ...left.map((item) => ({ item, where: "left" as const })),
    ];
    let across: Item | undefined;
    if (typeof params.voltmeterAcross === "string" && params.voltmeterAcross.trim()) {
      const m = params.voltmeterAcross.trim().match(/^(.*?)\s*(\d)?$/);
      const want = m ? parseItem(m[1]) : null;
      const nth = m?.[2] ? Number(m[2]) : 1;
      if (want) across = order.filter((o) => o.item.kind === want.kind)[nth - 1]?.item ?? order.find((o) => o.item.kind === want.kind)?.item;
    }
    const acrossWhere = across ? order.find((o) => o.item === across)!.where : undefined;

    const slot = 104;
    const cols = Math.max(2, top.length, bottom.length, ...branches.map((b) => b.length));
    const L = left.length ? (left.some((i) => i.value) ? 130 : 100) : acrossWhere === "left" ? 120 : 50;
    const R = L + cols * slot;
    const T = acrossWhere === "top" ? 100 : 62;
    const rungGap = (k: number) => (acrossWhere === k ? 140 : 90);
    const firstY = T + Math.max(120, left.length * 100 + 30);
    const rungYs: number[] = [];
    branches.forEach((_, k) => rungYs.push(k ? rungYs[k - 1] + rungGap(k - 1) : firstY));
    const B = branches.length ? rungYs[rungYs.length - 1] : T + Math.max(170, 0);
    const lastBelow = branches.length ? acrossWhere === branches.length - 1 : acrossWhere === "bottom";
    const w = R + (showCurrent ? 56 : 40);
    const h = B + (lastBelow ? 100 : bottom.some((i) => i.value) ? 56 : 44);

    const shapes: FigureShape[] = [];
    const placed: Placed[] = [];
    const wire = (d: string) => shapes.push({ t: "path", part: "wire", d, stroke: "ink", width: WIRE, fill: "none" });
    const junctions: Pt[] = [];

    /** Lay items along a straight run of wire from a to b, with wire between their terminals. */
    const run = (items: Item[], a: Pt, b: Pt, side: Placed["side"], u: Pt) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      let at = a;
      items.forEach((item, i) => {
        const t = (i + 0.5) / items.length;
        const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const f: Frame = { c, d, u };
        wire(line(at, g(f, -HALF, 0)));
        at = g(f, HALF, 0);
        placed.push({ item, f, side });
      });
      wire(line(at, b));
    };
    const UP = { x: 0, y: -1 }, LEFT = { x: -1, y: 0 };
    // Clockwise: along the top left→right, down the right rail, the rungs (or bottom) right→left, up the left.
    run(top, { x: L, y: T }, { x: R, y: T }, "top", UP);
    if (branches.length) {
      wire(line({ x: R, y: T }, { x: R, y: B }));
      branches.forEach((b, k) => run(b, { x: R, y: rungYs[k] }, { x: L, y: rungYs[k] }, "rung", UP));
      if (left.length) run(left, { x: L, y: firstY }, { x: L, y: T }, "left", LEFT);
      else wire(line({ x: L, y: B }, { x: L, y: T }));
      if (left.length && B > firstY) wire(line({ x: L, y: B }, { x: L, y: firstY }));
      for (let k = 0; k < rungYs.length - 1; k++) junctions.push({ x: L, y: rungYs[k] }, { x: R, y: rungYs[k] });
    } else {
      wire(line({ x: R, y: T }, { x: R, y: B }));
      run(bottom, { x: R, y: B }, { x: L, y: B }, "bottom", UP);
      wire(line({ x: L, y: B }, { x: L, y: T }));
    }

    for (const p of placed) {
      p.anchor = drawSymbol(p.item, p.f, shapes, p.side === "bottom" ? 1 : -1);
      if (p.item.value) {
        // Values stand clear of the labels' leaders: above the top wire, below the bottom, above a rung, inside the left side.
        const out = p.side === "bottom" ? 34 : 30;
        const pos = p.side === "bottom" ? { x: p.f.c.x, y: p.f.c.y + out + 12 } : p.side === "left" ? { x: p.f.c.x + 24, y: p.f.c.y + 5 } : { x: p.f.c.x, y: p.f.c.y - out };
        shapes.push({ t: "text", part: p.item.kind, x: fmt(pos.x), y: fmt(pos.y), text: p.item.value, size: 15, anchor: p.side === "left" ? "start" : "middle", fill: "muted" });
      }
    }

    // The voltmeter: in parallel, joined to the wire just outside the component's terminals.
    let voltmeterAnchor: Pt | undefined;
    let voltJunction: Pt | undefined;
    const target = placed.find((p) => p.item === across);
    if (target) {
      const out = target.side === "top" ? 68 : target.side === "left" ? 66 : 62; // outward distance
      const sign = target.side === "top" || target.side === "left" ? 1 : -1; // along u, or opposite (below)
      const f = target.f;
      const a = g(f, -HALF - 10, 0), b = g(f, HALF + 10, 0);
      const a2 = g(f, -HALF - 10, -sign * out), b2 = g(f, HALF + 10, -sign * out);
      wire(line(a, a2) + " " + line(b, b2));
      const vf: Frame = { c: g(f, 0, -sign * out), d: f.d, u: f.u };
      wire(line(a2, g(vf, -15, 0)) + " " + line(g(vf, 15, 0), b2));
      drawSymbol({ kind: "voltmeter" }, vf, shapes);
      voltmeterAnchor = g(vf, 15 * Math.SQRT1_2, -sign * 15 * Math.SQRT1_2);
      junctions.push(a, b);
      // The junction's label points just down the voltmeter lead, so its leader never runs along (and hides) the main wire.
      const outer = Math.abs(a.x - w / 2) > Math.abs(b.x - w / 2) ? -1 : 1;
      voltJunction = g(f, outer * (HALF + 10), -sign * 5);
    }
    for (const j of junctions) shapes.push({ t: "circle", part: "junction", cx: fmt(j.x), cy: fmt(j.y), r: 4.5, fill: "ink", stroke: "ink", width: 1 });

    // Conventional current: clockwise, so down the right-hand wire.
    const railEnd = branches.length ? rungYs[0] : B;
    const arrowY = (T + railEnd) / 2;
    if (showCurrent) {
      shapes.push({ t: "path", part: "current", d: `M${R - 8} ${arrowY - 7} L${R} ${arrowY + 7} L${R + 8} ${arrowY - 7} Z`, fill: "#dc2626", stroke: "#dc2626", width: 1.5 });
      shapes.push({ t: "text", part: "current", x: R + 16, y: arrowY + 6, text: "I", size: 17, anchor: "start", fill: "#dc2626" });
    }

    // Parts: the components present first (in the order the current meets them), then the rest.
    const parts: FigurePart[] = [];
    const seen = new Set<string>();
    for (const o of order) {
      const p = placed.find((x) => x.item === o.item)!;
      if (seen.has(p.item.kind)) continue;
      seen.add(p.item.kind);
      parts.push({ id: p.item.kind, name: p.item.label ? `${NAMES[p.item.kind]} (${p.item.label})` : NAMES[p.item.kind], anchor: p.anchor! });
    }
    if (voltmeterAnchor && !seen.has("voltmeter")) { seen.add("voltmeter"); parts.push({ id: "voltmeter", name: NAMES.voltmeter, anchor: voltmeterAnchor }); }
    const wireAnchor = { x: L, y: (T + (branches.length ? rungYs[0] : B)) / 2 };
    parts.push({ id: "wire", name: "Connecting wire", anchor: wireAnchor });
    parts.push({ id: "junction", name: "Junction", anchor: branches.length > 1 ? junctions[0] : voltJunction ?? { x: L, y: T } });
    parts.push({ id: "current", name: "Conventional current (+ to −)", anchor: { x: R, y: arrowY } });
    // Components not in this circuit keep an anchor on the wire, listed last.
    for (const k of KINDS) if (!seen.has(k)) parts.push({ id: k, name: NAMES[k], anchor: wireAnchor });
    return { w, h, shapes, parts };
  },
};
