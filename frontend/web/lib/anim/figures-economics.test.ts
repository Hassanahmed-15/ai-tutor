import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { supplyDemand, marketModel, parseShifts } from "../figures/components/supplyDemand";
import { ppf, ppfModel } from "../figures/components/ppf";
import { adAs, adAsModel, keynesianAs } from "../figures/components/adAs";
import { costRevenue, firmModel, cost, QMIN_ATC, QMIN_AVC } from "../figures/components/costRevenue";
import { circularFlow, parseSectors } from "../figures/components/circularFlow";

const COMPONENTS: FigureComponent[] = [supplyDemand, ppf, adAs, costRevenue, circularFlow];

function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string) {
  const declared = c.parts.map((p) => p.id);
  const built = d.parts.map((p) => p.id);
  for (const id of built) assert.ok(declared.includes(id), `${label}: ${id} is declared`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  for (const p of d.parts) {
    assert.ok(Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y), `${label}: ${p.id} anchor finite`);
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits (${p.name})`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "text") assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h, `${label}: text "${s.text}" inside`);
    if (s.t === "path") assert.ok(!/NaN|Infinity|undefined/.test(s.d), `${label}: path finite`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
  }
  assert.ok(d.w > 100 && d.h > 100 && d.w < 1200 && d.h < 1200, `${label}: sensible size ${d.w}×${d.h}`);
}

const CASES: Record<string, FigureParams[]> = {
  supplyDemand: [{}, { shift: "demand right" }, { shift: "supply left, demand right" }, { shift: "both left" }, { tax: 2, incidence: true, deadweight: true }, { subsidy: 1.5, surplus: "both" }, { priceControl: "max", surplus: "both", deadweight: true }, { priceControl: "min", controlPrice: 7 }, { priceControl: "max", controlPrice: 8 }, { elasticity: "inelastic demand", tax: 3 }, { good: "coffee", surplus: "consumer" }],
  ppf: [{}, { shape: "straight" }, { shift: "outward" }, { shift: "inward" }, { shift: "outward x" }, { maxX: 100, maxY: 50, opportunityCost: true, points: "A,B" }, { points: "C" }],
  adAs: [{}, { shift: "AD right" }, { shift: "SRAS left" }, { shift: "LRAS right, SRAS right" }, { gap: "deflationary" }, { gap: "inflationary" }, { model: "keynesian" }, { model: "keynesian", shift: "AD right" }, { model: "keynesian", shift: "AS right", gap: "deflationary" }],
  costRevenue: [{}, { market: "perfect competition" }, { market: "perfect competition", outcome: "loss" }, { market: "perfect competition long run" }, { market: "monopolistic competition long run" }, { market: "monopolistic competition", outcome: "supernormal" }, { market: "monopoly", outcome: "loss", avc: true }, { market: "monopoly", outcome: "normal" }],
  circularFlow: [{}, { sectors: 3 }, { sectors: 4 }, { sectors: 5 }, { sectors: "government, financial sector" }, { flows: "money" }, { flows: "real", sectors: 5 }, { sectors: 5, injections: false }],
};

test("economics: every case builds only declared parts, anchors and text inside, nothing NaN", () => {
  for (const c of COMPONENTS) for (const p of CASES[c.name]) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`);
});

test("economics: default drawings have at least two parts", () => {
  for (const c of COMPONENTS) assert.ok(c.build({}).parts.length >= 2, c.name);
});

test("economics: hostile params never throw", () => {
  const junk: FigureParams[] = [{ shift: 42, tax: "lots", subsidy: -3, controlPrice: "x" }, { maxX: -5, maxY: "abc", shape: 7 }, { model: "", shiftSize: 1e9, gap: true }, { market: 3, outcome: "???" }, { sectors: "99", flows: 1 }, { sectors: -1 }, { shift: "", priceControl: "max", maxPrice: 1e9 }, { tax: 1e9 }, { shiftSize: "NaN" }];
  for (const c of COMPONENTS) for (const p of junk) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`);
});

test("supply and demand: shifts move the equilibrium the right way", () => {
  const base = marketModel({});
  assert.ok(Math.abs(base.eq0.p - 5) < 1e-9 && Math.abs(base.eq0.q - 5) < 1e-9);
  const dr = marketModel({ shift: "demand right" });
  assert.ok(dr.eq1.p > dr.eq0.p && dr.eq1.q > dr.eq0.q, "demand right → higher P and Q");
  const dl = marketModel({ shift: "decrease in demand" });
  assert.ok(dl.eq1.p < dl.eq0.p && dl.eq1.q < dl.eq0.q, "demand left → lower P and Q");
  const sr = marketModel({ shift: "supply right" });
  assert.ok(sr.eq1.p < sr.eq0.p && sr.eq1.q > sr.eq0.q, "supply right → lower P, higher Q");
  const sl = marketModel({ shift: "supply shifts up" });
  assert.ok(sl.eq1.p > sl.eq0.p && sl.eq1.q < sl.eq0.q, "supply up (= left) → higher P, lower Q");
  assert.deepEqual(parseShifts({ shift: "both right" }), { demand: 1, supply: 1 });
  assert.deepEqual(parseShifts({ shift: "demand left, supply right" }), { demand: -1, supply: 1 });
  // The drawing has the new curve and the new equilibrium to the right of the old one.
  const d = supplyDemand.build({ shift: "demand right" });
  const e0 = d.parts.find((p) => p.id === "equilibrium")!.anchor, e1 = d.parts.find((p) => p.id === "new-equilibrium")!.anchor;
  assert.ok(e1.x > e0.x && e1.y < e0.y, "new equilibrium drawn up and to the right");
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "D₂") && d.shapes.some((s) => s.t === "text" && s.text === "P₂"));
});

test("supply and demand: a maximum price below equilibrium makes a shortage of Qd − Qs", () => {
  const m = marketModel({ priceControl: "max", controlPrice: 3.5 });
  const c = m.control!;
  assert.ok(c.binding && c.price < m.eq1.p);
  const qd = (m.d1.a - 3.5) / -m.d1.b, qs = (3.5 - m.s1.a) / m.s1.b;
  assert.ok(Math.abs(c.qd - qd) < 1e-9 && Math.abs(c.qs - qs) < 1e-9);
  assert.ok(Math.abs(c.shortage - (qd - qs)) < 1e-9 && c.shortage > 0);
  assert.ok(supplyDemand.build({ priceControl: "max", controlPrice: 3.5 }).parts.some((p) => p.id === "shortage"));
  // Above equilibrium a maximum price does nothing.
  const nb = marketModel({ priceControl: "max", controlPrice: 8 });
  assert.ok(!nb.control!.binding && nb.control!.shortage === 0);
  assert.ok(!supplyDemand.build({ priceControl: "max", controlPrice: 8 }).parts.some((p) => p.id === "shortage"));
  // A minimum price above equilibrium makes a surplus of Qs − Qd.
  const mn = marketModel({ priceControl: "min", controlPrice: 7 });
  assert.ok(mn.control!.surplus > 0 && Math.abs(mn.control!.surplus - (mn.control!.qs - mn.control!.qd)) < 1e-9);
});

test("supply and demand: an indirect tax shifts supply up by exactly the tax", () => {
  const m = marketModel({ tax: 2 });
  const t = m.tax!;
  assert.equal(t.sTax.b, m.s0.b, "parallel shift");
  for (const q of [0, 3, 7]) assert.ok(Math.abs(t.sTax.a + t.sTax.b * q - (m.s0.a + m.s0.b * q) - 2) < 1e-9, "vertical distance = tax");
  assert.ok(Math.abs(t.pc - t.pp - 2) < 1e-9, "consumer price − producer price = tax");
  assert.ok(t.pc > m.eq0.p && t.pp < m.eq0.p && t.q < m.eq0.q, "consumers pay more, producers receive less, less is traded");
  assert.ok(Math.abs(t.revenue - 2 * t.q) < 1e-9, "revenue = tax × quantity");
  // Inelastic demand → consumers bear more of the tax.
  const ie = marketModel({ tax: 2, demandElasticity: "inelastic" });
  assert.ok(ie.tax!.pc - ie.eq0.p > ie.eq0.p - ie.tax!.pp);
  const s = marketModel({ subsidy: 1.5 });
  assert.ok(s.subsidy!.pc < s.eq0.p && s.subsidy!.q > s.eq0.q && Math.abs(s.subsidy!.pp - s.subsidy!.pc - 1.5) < 1e-9);
});

test("ppf: points on, inside and outside; outward shift; opportunity cost", () => {
  const m = ppfModel({});
  const onCurve = (p: { q: number; p: number }) => Math.abs((p.q / m.X) ** 2 + (p.p / m.Y) ** 2 - 1) < 1e-9;
  assert.ok(onCurve(m.A) && onCurve(m.B), "A and B on the frontier");
  assert.ok(m.onOrInside(m.C) && !onCurve(m.C), "C strictly inside");
  assert.ok(!m.onOrInside(m.D), "D outside");
  const g = ppfModel({ shift: "outward" });
  assert.ok(g.shift.X2 > g.X && g.shift.Y2 > g.Y);
  assert.ok(g.onOrInside(g.D, g.shift.X2, g.shift.Y2), "D attainable after growth");
  const one = ppfModel({ shift: "outward x" });
  assert.ok(one.shift.X2 > one.X && one.shift.Y2 === one.Y);
  const v = ppfModel({ maxX: 100, maxY: 50 });
  assert.ok(Math.abs(v.opportunityCost - (v.A.p - v.B.p)) < 1e-9 && v.opportunityCost > 0);
  // Concave: increasing opportunity cost (the next equal step in X costs more Y).
  const yOf = (x: number) => v.Y * Math.sqrt(1 - (x / v.X) ** 2);
  assert.ok(yOf(60) - yOf(80) > yOf(20) - yOf(40));
  const d = ppf.build({ maxX: 100, maxY: 50, opportunityCost: true });
  assert.ok(d.parts.find((p) => p.id === "opportunity-cost")!.name.includes("12.1"));
  const st = ppfModel({ shape: "straight" });
  assert.ok(!st.concave && Math.abs(st.A.q / st.X + st.A.p / st.Y - 1) < 1e-9);
});

test("AD/AS: LRAS vertical at Yf; AD right raises output and the price level; gaps named", () => {
  const d = adAs.build({});
  const lras = d.shapes.find((s) => s.part === "lras" && s.t === "path")!;
  assert.ok(lras.t === "path");
  const nums = (lras as { d: string }).d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  assert.equal(nums[0], nums[2], "LRAS is vertical (same x at both ends)");
  const m0 = adAsModel({});
  assert.ok(Math.abs(m0.eq0.q - m0.yf0) < 1e-9, "default starts at full employment");
  const m = adAsModel({ shift: "AD right" });
  assert.ok(m.eq1.q > m.eq0.q && m.eq1.p > m.eq0.p);
  assert.ok(m.gap > 0 && adAs.build({ shift: "AD right" }).parts.find((p) => p.id === "output-gap")!.name === "Inflationary gap");
  const s = adAsModel({ shift: "SRAS left" });
  assert.ok(s.eq1.q < s.eq0.q && s.eq1.p > s.eq0.p, "cost-push: stagflation");
  assert.equal(adAs.build({ gap: "deflationary" }).parts.find((p) => p.id === "output-gap")!.name, "Deflationary gap");
  const l = adAsModel({ shift: "LRAS right" });
  assert.ok(l.yf1 > l.yf0);
  // Keynesian AS: flat, then rising, then vertical at Yf.
  const as = keynesianAs();
  assert.equal(as.y(0.2).p, as.y(0.8).p);
  assert.ok(as.y(1.6).p > as.y(1.3).p);
  assert.equal(as.y(2.3).q, as.yf);
  const k = adAsModel({ model: "keynesian", gap: "deflationary" });
  assert.ok(k.eq0.q < as.yf && Math.abs(k.eq0.p - 2.6) < 1e-6, "on the flat stretch");
});

test("cost and revenue: output where MC = MR; profit rectangle is (AR − ATC) × Q", () => {
  assert.ok(Math.abs(cost.mc(QMIN_ATC) - cost.atc(QMIN_ATC)) < 1e-6, "MC cuts ATC at its minimum");
  assert.ok(Math.abs(cost.mc(QMIN_AVC) - cost.avc(QMIN_AVC)) < 1e-9, "MC cuts AVC at its minimum");
  for (const p of [{}, { market: "perfect competition" }, { market: "monopolistic competition long run" }, { market: "monopoly", outcome: "loss" }, { market: "perfect competition", outcome: "loss" }] as FigureParams[]) {
    const m = firmModel(p);
    const mr = m.d0 - 2 * m.d1 * m.q;
    assert.ok(Math.abs(cost.mc(m.q) - mr) < 1e-6, `${JSON.stringify(p)}: MC = MR at Q*`);
    assert.ok(cost.mc(m.q + 0.01) > cost.mc(m.q), "on MC's rising stretch");
    assert.ok(Math.abs(m.price - (m.d0 - m.d1 * m.q)) < 1e-9, "price read off AR");
    assert.ok(Math.abs(m.profit - (m.price - cost.atc(m.q)) * m.q) < 1e-9);
  }
  const mono = firmModel({});
  assert.ok(mono.structure === "monopoly" && mono.profit > 0 && mono.price > cost.mc(mono.q), "monopoly: supernormal profit, P > MC");
  const lr = firmModel({ market: "monopolistic competition long run" });
  assert.ok(Math.abs(lr.price - lr.atc) < 1e-6 && lr.q < QMIN_ATC, "long run: AR tangent to ATC left of its minimum (normal profit, excess capacity)");
  const pcLr = firmModel({ market: "perfect competition long run" });
  assert.ok(Math.abs(pcLr.q - QMIN_ATC) < 1e-4 && Math.abs(pcLr.profit) < 1e-4, "perfect competition long run: P = min ATC");
  const loss = firmModel({ market: "perfect competition", outcome: "loss" });
  assert.ok(loss.profit < 0 && loss.price > cost.avc(QMIN_AVC), "loss but above shutdown");
  assert.ok(costRevenue.build({ outcome: "loss" }).parts.some((p) => p.id === "loss"));
  assert.ok(costRevenue.build({}).parts.some((p) => p.id === "supernormal-profit"));
});

test("circular flow: sectors and their withdrawals/injections", () => {
  assert.deepEqual(parseSectors({}), []);
  assert.deepEqual(parseSectors({ sectors: 3 }), ["government"]);
  assert.deepEqual(parseSectors({ sectors: 5 }), ["financial", "government", "overseas"]);
  assert.deepEqual(parseSectors({ sectors: "households, firms, banks and overseas" }), ["financial", "overseas"]);
  const d = circularFlow.build({ sectors: 5 });
  const texts = d.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  for (const t of ["S", "T", "M", "I", "G", "X", "Households", "Firms"]) assert.ok(texts.includes(t), t);
  assert.equal(d.parts.find((p) => p.id === "withdrawals")!.name, "Withdrawals (S, T, M)");
  const two = circularFlow.build({});
  assert.ok(!two.parts.some((p) => p.id === "injections") && two.parts.some((p) => p.id === "income"));
});

test("economics match: fires on economics, not on physics/biology/chemistry words", () => {
  const yes: Array<[FigureComponent, string]> = [
    [supplyDemand, "Draw a supply and demand diagram for coffee"],
    [supplyDemand, "The effect of an indirect tax on the market"],
    [supplyDemand, "A maximum price set below equilibrium"],
    [supplyDemand, "Consumer surplus and producer surplus"],
    [supplyDemand, "An increase in demand raises the equilibrium price"],
    [ppf, "Production possibility frontier and opportunity cost of capital goods"],
    [ppf, "Points inside the PPC show unemployment"],
    [adAs, "Aggregate demand and aggregate supply"],
    [adAs, "A shift of the LRAS curve"],
    [adAs, "Closing an inflationary gap"],
    [adAs, "the AD/AS model"],
    [costRevenue, "Profit maximisation where MC = MR"],
    [costRevenue, "Monopolistic competition in the long run"],
    [costRevenue, "Supernormal profit made by a monopolist"],
    [circularFlow, "The circular flow of income"],
    [circularFlow, "Injections and withdrawals in a four-sector economy"],
  ];
  for (const [c, t] of yes) assert.ok(c.match.test(t), `${c.name} should match: ${t}`);
  const no = ["Oxygen demand of muscles during exercise", "Biological oxygen demand of river water", "The power supply in a circuit", "Blood supply to the heart", "Energy demand of the cell", "An increase in supply of oxygen to tissues", "The ad was shown as advertised", "Water supply and sewage", "Marginal notes in the textbook", "The flow of current in a circuit", "Blood flow in the circulatory system", "Supply voltage of the cell"];
  for (const c of COMPONENTS) for (const t of no) assert.ok(!c.match.test(t), `${c.name} should not match: ${t}`);
});
