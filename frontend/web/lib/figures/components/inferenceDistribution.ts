import type { FigureComponent, FigureParams, FigureShape } from "../types";

const number = (v: unknown, fallback: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const f = (n: number) => Number(n.toFixed(2));

/** A standard-normal teaching diagram. Geometry, tail direction and shading are code-owned. */
export const inferenceDistribution: FigureComponent = {
  name: "inferenceDistribution",
  title: "Null distribution with an observed test statistic and the one- or two-tailed p-value region",
  params: `observed (standardised observed statistic, -3.5 to 3.5; default 1.8), tail ("left", "right" — default — or "two"), alpha (optional significance level, default 0.05). Code always shades outcomes at least as extreme as the observed statistic.`,
  match: /\b(p[- ]?value|null distribution|test statistic|significance test|one[- ]tailed|two[- ]tailed|rejection region)\b/i,
  parts: [
    { id: "null-distribution", name: "Null distribution" },
    { id: "observed-statistic", name: "Observed test statistic" },
    { id: "p-value-region", name: "P-value: outcomes at least as extreme" },
    { id: "centre", name: "Expected if H₀ is true" },
    { id: "axis", name: "Test statistic" },
  ],
  build(params: FigureParams) {
    const w = 680, h = 390, left = 48, right = 652, base = 322, top = 48;
    const observed = number(params.observed, 1.8, -3.5, 3.5);
    const tail = /two/i.test(String(params.tail ?? "")) ? "two" : /left/i.test(String(params.tail ?? "")) ? "left" : "right";
    const X = (z: number) => left + ((z + 4) / 8) * (right - left);
    const Y = (z: number) => base - Math.exp(-0.5 * z * z) * (base - top);
    const curve: string[] = [];
    for (let i = 0; i <= 160; i++) { const z = -4 + i / 20; curve.push(`${i ? "L" : "M"}${f(X(z))} ${f(Y(z))}`); }
    const region = (a: number, b: number) => {
      const points: string[] = [`M${f(X(a))} ${base}`];
      const n = Math.max(2, Math.ceil((b - a) * 24));
      for (let i = 0; i <= n; i++) { const z = a + ((b - a) * i) / n; points.push(`L${f(X(z))} ${f(Y(z))}`); }
      points.push(`L${f(X(b))} ${base} Z`);
      return points.join(" ");
    };
    const cut = Math.abs(observed);
    const shapes: FigureShape[] = [
      { t: "path", part: "axis", d: `M${left - 12} ${base} H${right + 12}`, stroke: "ink", width: 2.2, fill: "none" },
      { t: "path", part: "null-distribution", d: curve.join(" "), stroke: "#2563eb", width: 3.2, fill: "none" },
    ];
    if (tail === "right" || tail === "two") shapes.push({ t: "path", part: "p-value-region", d: region(tail === "two" ? cut : observed, 4), fill: "#f59e0b", stroke: "#d97706", width: 1.2, opacity: 0.42 });
    if (tail === "left" || tail === "two") shapes.push({ t: "path", part: "p-value-region", d: region(-4, tail === "two" ? -cut : observed), fill: "#f59e0b", stroke: "#d97706", width: 1.2, opacity: 0.42 });
    shapes.push(
      { t: "path", part: "centre", d: `M${f(X(0))} ${base} V${f(Y(0) - 10)}`, stroke: "muted", width: 1.5, dash: "6 5", fill: "none" },
      { t: "path", part: "observed-statistic", d: `M${f(X(observed))} ${base + 2} V${f(Y(observed) - 26)}`, stroke: "#dc2626", width: 2.8, fill: "none" },
      { t: "text", part: "observed-statistic", x: f(X(observed)), y: f(Y(observed) - 34), text: "observed", size: 18, anchor: "middle", fill: "#dc2626" },
      { t: "text", part: "p-value-region", x: tail === "left" ? X(-2.8) : X(2.8), y: base - 26, text: tail === "two" ? "p-value tails" : "p-value", size: 18, anchor: "middle", fill: "#d97706" },
      { t: "text", part: "axis", x: (left + right) / 2, y: base + 38, text: "Test statistic under H₀", size: 20, anchor: "middle", fill: "ink" },
      { t: "text", part: "centre", x: X(0), y: top - 12, text: "H₀", size: 21, anchor: "middle", fill: "ink" },
    );
    return { w, h, shapes, parts: [
      { id: "null-distribution", name: "Null distribution", anchor: { x: X(-0.8), y: Y(-0.8) } },
      { id: "observed-statistic", name: "Observed test statistic", anchor: { x: X(observed), y: Math.max(top + 15, Y(observed) - 18) } },
      { id: "p-value-region", name: "P-value region", anchor: { x: tail === "left" ? X(-Math.max(2.6, Math.abs(observed))) : X(Math.max(2.6, Math.abs(observed))), y: base - 12 } },
      { id: "centre", name: "Expected if H₀ is true", anchor: { x: X(0), y: top + 8 } },
      { id: "axis", name: "Test statistic", anchor: { x: right, y: base } },
    ] };
  },
};
