import type { FigureComponent, FigureParams, FigureShape } from "../types";

const f = (n: number) => Number(n.toFixed(2));

/** Two opposite phases of one stationary wave, with code-owned nodes and antinodes. */
export const standingWave: FigureComponent = {
  name: "standingWave",
  title: "Stationary wave with fixed nodes, antinodes and the relationship between node spacing and wavelength",
  params: `loops (number of antinodes, 2-5; default 3), amplitude (0.3-1; default 0.8). The dashed curve is the opposite phase; nodes remain fixed.`,
  match: /\b(stationary|standing) waves?\b|\bnodes? and antinodes?\b|\badjacent nodes?\b/i,
  parts: [
    { id: "node", name: "Node" },
    { id: "antinode", name: "Antinode" },
    { id: "wavelength", name: "Wavelength (λ)" },
    { id: "node-spacing", name: "Adjacent nodes = λ/2" },
    { id: "equilibrium", name: "Equilibrium position" },
    { id: "opposite-phase", name: "Opposite phase" },
  ],
  build(params: FigureParams) {
    const loops = Math.round(Math.max(2, Math.min(5, Number(params.loops) || 3)));
    const amp = Math.max(0.3, Math.min(1, Number(params.amplitude) || 0.8)) * 105;
    const w = 680, h = 380, x0 = 52, x1 = 628, y0 = 195, L = x1 - x0;
    const curve = (sign: number) => {
      let d = "";
      for (let i = 0; i <= 240; i++) { const x = x0 + (i / 240) * L; const y = y0 - sign * amp * Math.sin((loops * Math.PI * (x - x0)) / L); d += `${i ? "L" : "M"}${f(x)} ${f(y)}`; }
      return d;
    };
    const nodeX = (i: number) => x0 + (i * L) / loops;
    const antiX = (i: number) => x0 + ((i + 0.5) * L) / loops;
    const shapes: FigureShape[] = [
      { t: "path", part: "equilibrium", d: `M${x0 - 12} ${y0} H${x1 + 12}`, stroke: "muted", width: 1.5, dash: "7 5", fill: "none" },
      { t: "path", d: curve(1), stroke: "#2563eb", width: 3.2, fill: "none" },
      { t: "path", part: "opposite-phase", d: curve(-1), stroke: "#7c3aed", width: 2.4, dash: "9 6", fill: "none", opacity: 0.75 },
    ];
    for (let i = 0; i <= loops; i++) shapes.push({ t: "circle", part: "node", cx: nodeX(i), cy: y0, r: 5.5, fill: "#dc2626", stroke: "paper", width: 1.2 });
    shapes.push({ t: "circle", part: "antinode", cx: antiX(0), cy: y0 - amp, r: 6, fill: "#16a34a", stroke: "paper", width: 1.2 });
    const a = nodeX(0), b = nodeX(1), c = Math.min(x1, nodeX(2));
    shapes.push(
      { t: "path", part: "node-spacing", d: `M${a} 330 V346 M${b} 330 V346 M${a} 340 H${b}`, stroke: "#d97706", width: 2.2, fill: "none" },
      { t: "text", part: "node-spacing", x: (a + b) / 2, y: 368, text: "λ/2", size: 20, anchor: "middle", fill: "#d97706" },
      { t: "path", part: "wavelength", d: `M${a} 286 V304 M${c} 286 V304 M${a} 298 H${c}`, stroke: "ink", width: 2.2, fill: "none" },
      { t: "text", part: "wavelength", x: (a + c) / 2, y: 290, text: "λ", size: 20, anchor: "middle", fill: "ink" },
    );
    return { w, h, shapes, parts: [
      { id: "node", name: "Node", anchor: { x: nodeX(1), y: y0 } },
      { id: "antinode", name: "Antinode", anchor: { x: antiX(0), y: y0 - amp } },
      { id: "wavelength", name: "Wavelength (λ)", anchor: { x: c, y: 298 } },
      { id: "node-spacing", name: "Adjacent nodes = λ/2", anchor: { x: b, y: 340 } },
      { id: "equilibrium", name: "Equilibrium position", anchor: { x: x1 - 10, y: y0 } },
      { id: "opposite-phase", name: "Opposite phase", anchor: { x: antiX(1), y: y0 + (loops > 1 ? amp : -amp) } },
    ] };
  },
};
