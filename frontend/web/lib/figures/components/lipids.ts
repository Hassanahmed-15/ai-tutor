import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, textW, num, rad, polar } from "./mathsKit";
import { CHEM, atomText, bond, pick, softBox } from "./glucoseRings";

/**
 * LIPIDS, DRAWN AS IN THE TEXTBOOK. "triglyceride": glycerol's three carbons each joined through an
 * ester bond (–O–C(=O)–) to a fatty acid, drawn as a skeletal zigzag; an unsaturated chain has its
 * C=C double bond and the kink it makes, and the condensation's 3 H₂O is shown. "phospholipid": the
 * same glycerol with one fatty acid replaced by a phosphate group — the polar, hydrophilic head —
 * beside the circle-and-two-tails symbol the membrane is drawn with. "bilayer": the fluid mosaic
 * model — two layers of phospholipids, heads facing the water on both sides, tails inward, with a
 * channel protein, a carrier protein, a glycoprotein, a glycolipid and cholesterol.
 */

type Show = "triglyceride" | "phospholipid" | "bilayer";

const F = 18;
const R = 9.5; // a bond stops this far from a lettered atom
const SEG = 26; // skeletal bond length

const COL = {
  head: "#fca5a5" as Ink, headStroke: "#be123c" as Ink,
  channel: "#bfdbfe" as Ink, channelStroke: "#2563eb" as Ink,
  carrier: "#bbf7d0" as Ink, carrierStroke: "#16a34a" as Ink,
  glyco: "#ddd6fe" as Ink, glycoStroke: "#6d28d9" as Ink,
  sugar: "#fde68a" as Ink, sugarStroke: "#d97706" as Ink,
  chol: "#fef08a" as Ink, cholStroke: "#ca8a04" as Ink,
  polar: "#dbeafe" as Ink,
};

/**
 * A skeletal hydrocarbon chain from `start`, heading `heading` degrees (0 = right, 90 = down): a 120°
 * zigzag of `n` bonds, turning ±60° alternately at each carbon. A cis C=C at bond `kinkAt` turns the
 * same way at both of its carbons (the cis kink: both neighbours on one side), so the chain bends by
 * 60° there; `bend` (+1 clockwise on screen / −1) chooses which way, and the double bond's second
 * line is drawn inside the bend. Returns the carbon positions and the double bond's midpoint.
 */
function chain(sk: Sketch, start: Pt, heading: number, n: number, o: { part: string; firstSide?: 1 | -1; kinkAt?: number; bend?: 1 | -1; dbPart?: string; trimStart?: number }) {
  const pts: Pt[] = [start];
  let dir = heading + (o.firstSide ?? 1) * 30;
  let turn = -(o.firstSide ?? 1) * 60;
  const k = o.kinkAt;
  // Make the kink bend the asked way: the turn into the double bond must have the bend's sign.
  if (k !== undefined && o.bend !== undefined) {
    const signBefore = k === 0 ? 0 : Math.sign(turn) * (k % 2 === 1 ? 1 : -1);
    if (signBefore !== 0 && signBefore !== o.bend) {
      dir = heading - (o.firstSide ?? 1) * 30;
      turn = -turn;
    }
  }
  let db: Pt | undefined;
  for (let i = 0; i < n; i++) {
    const p = polar(pts[i], SEG, rad(dir));
    pts.push(p);
    if (i !== k) bond(sk, pts[i], p, { part: o.part, width: 2.4, ra: i === 0 ? o.trimStart ?? 0 : 0 });
    // Turn for the next bond: alternate, except straight after the double bond (same turn again → cis).
    if (k !== undefined && i === k) {
      dir += -turn; // the turn at the double bond's far carbon repeats the one at its near carbon
    } else {
      dir += turn;
      turn = -turn;
    }
  }
  if (k !== undefined && k < n) {
    const A = pts[k], B = pts[k + 1];
    db = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    // The inner line on the side of the neighbours (inside the bend).
    const nb = pts[k + 2] ?? pts[Math.max(0, k - 1)];
    const ux = (B.x - A.x) / SEG, uy = (B.y - A.y) / SEG;
    const side = Math.sign(ux * (nb.y - A.y) - uy * (nb.x - A.x)) || 1;
    const nx = -uy * side, ny = ux * side;
    sk.line([A, B], { stroke: "ink", width: 2.4, part: o.dbPart ?? o.part });
    sk.line([{ x: A.x + ux * 4 + nx * 5.5, y: A.y + uy * 4 + ny * 5.5 }, { x: B.x - ux * 4 + nx * 5.5, y: B.y - uy * 4 + ny * 5.5 }], { stroke: "ink", width: 2.4, part: o.dbPart ?? o.part });
  }
  return { pts, db, end: pts[pts.length - 1] };
}

/** A vertical curly brace from y0 to y1 with its point to the right at x + 2r. */
function brace(sk: Sketch, x: number, y0: number, y1: number, stroke: Ink, part: string, r = 8): Pt {
  const mid = (y0 + y1) / 2;
  const st = { stroke, width: 2.2, part };
  sk.arc({ x, y: y0 + r }, r, rad(-90), 0, st);
  sk.line([{ x: x + r, y: y0 + r }, { x: x + r, y: mid - r }], st);
  sk.arc({ x: x + 2 * r, y: mid - r }, r, rad(180), rad(90), st);
  sk.arc({ x: x + 2 * r, y: mid + r }, r, rad(-90), rad(-180), st);
  sk.line([{ x: x + r, y: mid + r }, { x: x + r, y: y1 - r }], st);
  sk.arc({ x, y: y1 - r }, r, 0, rad(90), st);
  return { x: x + 2 * r, y: mid };
}

/** –O–C(=O)– from a glycerol carbon: returns the ester carbon (the chain starts there). */
function ester(sk: Sketch, from: Pt, dir: Pt, carbonylSide: Pt, part: string, highlight: boolean) {
  const O = { x: from.x + dir.x * 50, y: from.y + dir.y * 50 };
  const C = { x: from.x + dir.x * 100, y: from.y + dir.y * 100 };
  const dO = { x: C.x + carbonylSide.x * 42, y: C.y + carbonylSide.y * 42 };
  if (highlight) {
    const xs = [O.x, C.x, dO.x], ys = [O.y, C.y, dO.y];
    const x0 = Math.min(...xs) - 15, x1 = Math.max(...xs) + 15, y0 = Math.min(...ys) - 15, y1 = Math.max(...ys) + 15;
    softBox(sk, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, x1 - x0, y1 - y0, CHEM.soft, part, { stroke: CHEM.hi });
  }
  bond(sk, from, O, { ra: R, rb: R, part });
  bond(sk, O, C, { ra: R, rb: R, part });
  bond(sk, C, dO, { ra: R, rb: R, part, double: "center", gap: 5 });
  atomText(sk, O, "O", F, CHEM.O, part, "center");
  atomText(sk, C, "C", F, "ink", part, "center");
  atomText(sk, dO, "O", F, CHEM.O, part, "center");
  return { O, C, dO };
}

function triglyceride(sk: Sketch, unsat: number) {
  const rows = [-86, 0, 86];
  const unsaturatedRows = unsat <= 0 ? [] : unsat === 1 ? [2] : unsat === 2 ? [0, 2] : [0, 1, 2];
  // Glycerol: H₂C / HC / H₂C down the left, joined by single bonds.
  const G = rows.map((y) => ({ x: 0, y }));
  bond(sk, G[0], G[1], { ra: R, rb: R, part: "glycerol" });
  bond(sk, G[1], G[2], { ra: R, rb: R, part: "glycerol" });
  const gText = ["H₂C", "HC", "H₂C"].map((t, i) => atomText(sk, G[i], t, F, "ink", "glycerol", "last"));
  const ends: Pt[] = [];
  const esters = G.map((g) => ester(sk, g, { x: 1, y: 0 }, { x: 0, y: -1 }, "ester-bond", true));
  let db: Pt | undefined, satEnd: Pt | undefined, unsatEnd: Pt | undefined;
  esters.forEach((e, i) => {
    const kinked = unsaturatedRows.includes(i);
    // Top chain bends up, the others down; the middle one bends later so it clears the bottom chain.
    const c = chain(sk, e.C, 0, 12, { part: kinked ? "unsaturated-chain" : "saturated-chain", firstSide: 1, kinkAt: kinked ? (i === 1 ? 8 : 6) : undefined, bend: i === 0 ? -1 : 1, dbPart: "double-bond", trimStart: R });
    ends.push(c.end);
    if (kinked && !db) db = c.db;
    if (kinked) unsatEnd = unsatEnd ?? c.end;
    else satEnd = satEnd ?? c.end;
  });
  // The condensation's product water, one per ester bond.
  const right = Math.max(...ends.map((p) => p.x)) + 46;
  const plus = { x: right, y: 0 };
  sk.text(plus, "+", 22, "ink", "water");
  const w = atomText(sk, { x: right + 22, y: 0 }, "3H₂O", F + 2, CHEM.water, "water", "first");
  sk.part("glycerol", "Glycerol", { x: gText[1].x - textW("HC", F) / 2 - 4, y: 0 });
  sk.part("ester-bond", "Ester bond", { x: esters[0].O.x - 10, y: esters[0].dO.y - 2 });
  if (satEnd) sk.part("saturated-chain", "Saturated fatty acid", satEnd);
  if (unsatEnd) sk.part("unsaturated-chain", "Unsaturated fatty acid", unsatEnd);
  if (db) sk.part("double-bond", "C=C double bond (kink)", db);
  sk.part("water", "3 H₂O released", { x: w.x + textW("3H₂O", F + 2) / 2 + 5, y: w.y });
}

function phospholipid(sk: Sketch, unsat: number) {
  // Glycerol across the top: H₂C (phosphate) — CH (fatty acid) — CH₂ (fatty acid).
  const g = [{ x: -80, y: 0 }, { x: 0, y: 0 }, { x: 80, y: 0 }];
  bond(sk, g[0], g[1], { ra: 15, rb: R, part: "glycerol" });
  bond(sk, g[1], g[2], { ra: R, rb: R, part: "glycerol" });
  const t0 = atomText(sk, g[0], "H₂C", F, "ink", "glycerol", "last");
  atomText(sk, g[1], "CH", F, "ink", "glycerol", "first");
  atomText(sk, g[2], "CH₂", F, "ink", "glycerol", "first");
  // Phosphate head: O then P (the polar, charged group), shaded as the hydrophilic region.
  const O = { x: -80, y: -48 }, P = { x: -80, y: -104 };
  softBox(sk, { x: -80, y: -86 }, 80, 108, COL.polar, undefined, { opacity: 0.4 });
  bond(sk, g[0], O, { ra: R, rb: R, part: "phosphate-group" });
  bond(sk, O, P, { ra: R, rb: 22, part: "phosphate-group" });
  atomText(sk, O, "O", F, CHEM.O, "phosphate-group", "center");
  sk.circle(P, 22, { fill: COL.head, stroke: COL.headStroke, width: 2.4, part: "phosphate-group" });
  sk.text(P, "P", 20, "#111827", "phosphate-group");
  sk.text({ x: P.x + 30, y: P.y - 18 }, "−", 22, COL.headStroke, "phosphate-group");
  // Two fatty acids through ester bonds, hanging down; the second may be unsaturated (kinked).
  const e1 = ester(sk, g[1], { x: 0, y: 1 }, { x: -1, y: 0 }, "ester-bond", true);
  const e2 = ester(sk, g[2], { x: 0, y: 1 }, { x: 1, y: 0 }, "ester-bond", true);
  const c1 = chain(sk, e1.C, 90, 8, { part: "saturated-chain", firstSide: 1, trimStart: R });
  const kinked = unsat > 0;
  const c2 = chain(sk, e2.C, 90, 8, { part: kinked ? "unsaturated-chain" : "saturated-chain", firstSide: -1, kinkAt: kinked ? 3 : undefined, bend: -1, dbPart: "double-bond", trimStart: R });
  // The symbol the membrane is drawn with, beside it: head circle and two tails, with braces.
  const sx = 250, hy = -60;
  sk.circle({ x: sx, y: hy }, 24, { fill: COL.head, stroke: COL.headStroke, width: 2.4, part: "hydrophilic-head" });
  const tailTop = hy + 24, tailEnd = 150;
  sk.line([{ x: sx - 8, y: tailTop - 2 }, { x: sx - 8, y: tailEnd }], { stroke: "ink", width: 3, part: "hydrophobic-tails" });
  if (kinked) sk.line([{ x: sx + 8, y: tailTop - 2 }, { x: sx + 8, y: 70 }, { x: sx + 24, y: tailEnd - 6 }], { stroke: "ink", width: 3, part: "hydrophobic-tails" });
  else sk.line([{ x: sx + 8, y: tailTop - 2 }, { x: sx + 8, y: tailEnd }], { stroke: "ink", width: 3, part: "hydrophobic-tails" });
  const hb = brace(sk, sx + 40, hy - 26, hy + 26, COL.headStroke, "hydrophilic-head");
  const tb = brace(sk, sx + 40, tailTop + 6, tailEnd, "muted", "hydrophobic-tails");
  sk.part("phosphate-group", "Phosphate group", { x: P.x - 22, y: P.y });
  sk.part("glycerol", "Glycerol", { x: t0.x - textW("H₂C", F) / 2 - 4, y: 0 });
  sk.part("ester-bond", "Ester bond", { x: e1.dO.x - 14, y: e1.dO.y });
  sk.part("saturated-chain", kinked ? "Saturated fatty acid" : "Fatty acid tails", c1.pts[6]);
  if (kinked) {
    sk.part("unsaturated-chain", "Unsaturated fatty acid", c2.end);
    if (c2.db) sk.part("double-bond", "C=C double bond (kink)", c2.db);
  }
  sk.part("hydrophilic-head", "Hydrophilic head (polar)", hb);
  sk.part("hydrophobic-tails", "Hydrophobic tails (non-polar)", tb);
}

function bilayer(sk: Sketch) {
  const W = 590, HY = 64, HR = 9.5, STEP = 22;
  // What stands where along the membrane (x ranges): proteins and cholesterol displace phospholipids.
  const channel = { x: 158, half: 34 }, carrier = { x: 334, half: 40 }, glyco = { x: 478, half: 28 };
  const cholTop = 92, cholBot = 18;
  const glycolipidX = 562;
  const busy = (x: number, top: boolean) =>
    Math.abs(x - channel.x) < channel.half + 12 || Math.abs(x - carrier.x) < carrier.half + 12 || (top && Math.abs(x - glyco.x) < glyco.half + 12) || Math.abs(x - (top ? cholTop : cholBot)) < 14;
  let firstHead: Pt | undefined, lastBottom: Pt | undefined, firstTail: Pt | undefined, glycolipidHead: Pt | undefined;
  // The last lipid of the inner layer is the one labelled "phospholipid" (head and both tails).
  const lastX = (() => { let x = 12; for (let t = 12; t <= W; t += STEP) if (!busy(t, false)) x = t; return x; })();
  for (const top of [true, false]) {
    const s = top ? -1 : 1;
    for (let x = 12; x <= W; x += STEP) {
      if (busy(x, top)) continue;
      const head = { x, y: s * HY };
      const isGL = top && Math.abs(x - glycolipidX) < STEP / 2;
      const isPL = !top && x === lastX;
      const part = isGL ? "glycolipid" : isPL ? "phospholipid" : "hydrophobic-tails";
      // Two tails to the middle; every third lipid has a kinked (unsaturated) tail.
      const t0 = s * (HY - HR), t1 = s * 6;
      sk.line([{ x: x - 3.5, y: t0 }, { x: x - 3.5, y: t1 }], { stroke: "ink", width: 2, part }, false);
      if (Math.round(x / STEP) % 3 === 0) sk.line([{ x: x + 3.5, y: t0 }, { x: x + 3.5, y: s * 30 }, { x: x + 8, y: t1 }], { stroke: "ink", width: 2, part }, false);
      else sk.line([{ x: x + 3.5, y: t0 }, { x: x + 3.5, y: t1 }], { stroke: "ink", width: 2, part }, false);
      sk.circle(head, HR, { fill: COL.head, stroke: COL.headStroke, width: 1.6, part: isGL ? "glycolipid" : isPL ? "phospholipid" : "hydrophilic-head" });
      if (isGL) glycolipidHead = head;
      if (top && !firstHead) {
        firstHead = head;
        firstTail = { x: x - 3.5, y: -34 };
      }
      if (!top) lastBottom = head;
    }
  }
  // Cholesterol: a small rigid molecule between the tails, its OH end by the heads.
  const chol = (x: number, top: boolean) => {
    const s = top ? -1 : 1;
    const y0 = s * (HY - 4), y1 = s * 14;
    softBox(sk, { x, y: (y0 + y1) / 2 }, 14, Math.abs(y1 - y0), COL.chol, "cholesterol", { stroke: COL.cholStroke });
    sk.circle({ x, y: y0 + s * 4 }, 4.5, { fill: COL.cholStroke, stroke: COL.cholStroke, width: 1, part: "cholesterol" });
  };
  chol(cholTop, true);
  chol(cholBot, false);
  // Channel protein: two subunits spanning the bilayer, the water-filled pore between them.
  const span = 92;
  for (const dx of [-1, 1]) softBox(sk, { x: channel.x + dx * 17, y: 0 }, 26, 2 * span, COL.channel, "channel-protein", { stroke: COL.channelStroke });
  // Carrier protein: one protein spanning the bilayer with a binding site open to the outside.
  const cx = carrier.x, ch = 88;
  sk.path(
    [
      { k: "M", p: { x: cx - 38, y: -ch + 14 } },
      { k: "A", c: { x: cx - 24, y: -ch + 14 }, r: 14, to: { x: cx - 24, y: -ch }, large: false, sweep: true },
      { k: "L", p: { x: cx - 14, y: -ch } },
      { k: "L", p: { x: cx - 14, y: -ch + 18 } },
      { k: "A", c: { x: cx, y: -ch + 18 }, r: 14, to: { x: cx + 14, y: -ch + 18 }, large: false, sweep: false },
      { k: "L", p: { x: cx + 14, y: -ch } },
      { k: "L", p: { x: cx + 24, y: -ch } },
      { k: "A", c: { x: cx + 24, y: -ch + 14 }, r: 14, to: { x: cx + 38, y: -ch + 14 }, large: false, sweep: true },
      { k: "L", p: { x: cx + 38, y: ch - 16 } },
      { k: "A", c: { x: cx + 22, y: ch - 16 }, r: 16, to: { x: cx + 22, y: ch }, large: false, sweep: true },
      { k: "L", p: { x: cx - 22, y: ch } },
      { k: "A", c: { x: cx - 22, y: ch - 16 }, r: 16, to: { x: cx - 38, y: ch - 16 }, large: false, sweep: true },
    ],
    true,
    { fill: COL.carrier, stroke: COL.carrierStroke, width: 2, part: "carrier-protein" },
    true,
  );
  // Glycoprotein: a protein with a branched carbohydrate chain on the outer surface.
  // (Set in the outer layer, so the inner layer runs on beneath it.)
  softBox(sk, { x: glyco.x, y: -span / 2 + 1 }, 2 * glyco.half - 6, span - 2, COL.glyco, "glycoprotein", { stroke: COL.glycoStroke });
  const sugar = (p: Pt, part: string) => {
    const pts = Array.from({ length: 6 }, (_, i) => polar(p, 8, rad(30 + i * 60)));
    sk.polygon(pts, { fill: COL.sugar, stroke: COL.sugarStroke, width: 1.6, part });
  };
  const gTop = { x: glyco.x, y: -span + 4 };
  const g1 = { x: glyco.x, y: gTop.y - 20 }, g2 = { x: glyco.x, y: g1.y - 20 }, g3 = { x: glyco.x - 4, y: g2.y - 20 }, gb1 = { x: glyco.x + 18, y: g2.y - 12 }, gb2 = { x: glyco.x + 36, y: g2.y - 22 };
  sk.line([gTop, g1, g2, g3], { stroke: COL.sugarStroke, width: 2, part: "glycoprotein" });
  sk.line([g2, gb1, gb2], { stroke: COL.sugarStroke, width: 2, part: "glycoprotein" });
  for (const p of [g1, g2, g3, gb1, gb2]) sugar(p, "glycoprotein");
  // Glycolipid: a short carbohydrate chain on one outer-layer lipid head.
  if (glycolipidHead) {
    const a = { x: glycolipidHead.x, y: glycolipidHead.y - HR - 12 }, b = { x: glycolipidHead.x - 8, y: a.y - 18 };
    sk.line([{ x: glycolipidHead.x, y: glycolipidHead.y - HR }, a, b], { stroke: COL.sugarStroke, width: 2, part: "glycolipid" });
    sugar(a, "glycolipid");
    sugar(b, "glycolipid");
  }
  // Water on both sides (the heads face it).
  for (const [x, y] of [[60, -116], [250, -116], [400, -116], [60, 116], [246, 116], [420, 116], [560, 116]] as const) sk.text({ x, y }, "H₂O", 14, CHEM.water);
  if (firstHead) sk.part("hydrophilic-head", "Hydrophilic phosphate head", { x: firstHead.x - HR + 1, y: firstHead.y });
  if (firstTail) sk.part("hydrophobic-tails", "Hydrophobic fatty acid tails", firstTail);
  sk.part("channel-protein", "Channel protein", { x: channel.x - 17, y: -span + 3 });
  sk.part("carrier-protein", "Carrier protein", { x: cx + 6, y: ch - 1 });
  sk.part("glycoprotein", "Glycoprotein", { x: gb2.x + 6, y: gb2.y });
  if (glycolipidHead) sk.part("glycolipid", "Glycolipid", { x: glycolipidHead.x + 6, y: glycolipidHead.y - HR - 24 });
  sk.part("cholesterol", "Cholesterol", { x: cholBot - 6, y: 34 });
  if (lastBottom) sk.part("phospholipid", "Phospholipid", { x: lastBottom.x + HR - 1, y: lastBottom.y });
}

export const lipids: FigureComponent = {
  name: "lipids",
  title: "Lipids: a triglyceride (glycerol + three fatty acids by ester bonds, saturated and unsaturated chains), a phospholipid (hydrophilic phosphate head, hydrophobic tails), or the phospholipid bilayer (fluid mosaic model)",
  params: `show ("triglyceride" default: glycerol joined to three fatty acids by ester bonds, + 3H₂O from the condensation | "phospholipid": phosphate head, glycerol and two fatty acid tails, with the head/tail symbol | "bilayer": fluid mosaic membrane with channel and carrier proteins, glycoprotein, glycolipid, cholesterol); unsaturated (triglyceride: how many of the three chains have a C=C kink, 0–3, default 1; phospholipid: 0 or 1, default 1).`,
  match: /\btriglycerides?\b|\bphospholipids?\b|\bfluid[- ]mosaic\b|\b(saturated|unsaturated) fatty acids?\b|\bfatty acids?\b(?=[\s\S]{0,80}\b(glycerol|ester bonds?|saturated|unsaturated|hydrocarbon tails?)\b)|\bglycerol\b(?=[\s\S]{0,80}\bfatty acids?\b)|\bester bonds?\b(?=[\s\S]{0,80}\b(glycerol|fatty acids?|lipids?|triglycerides?)\b)|\b(lipids?|triglycerides?)\b[\s\S]{0,60}\bester bonds?\b|\b(structure of|structures of) (a )?lipids?\b|\bhydrophilic heads?\b|\bhydrophobic tails?\b/i,
  parts: [
    { id: "glycerol", name: "Glycerol" },
    { id: "ester-bond", name: "Ester bond" },
    { id: "saturated-chain", name: "Saturated fatty acid" },
    { id: "unsaturated-chain", name: "Unsaturated fatty acid" },
    { id: "double-bond", name: "C=C double bond (kink)" },
    { id: "water", name: "3 H₂O released" },
    { id: "phosphate-group", name: "Phosphate group" },
    { id: "hydrophilic-head", name: "Hydrophilic head (polar)" },
    { id: "hydrophobic-tails", name: "Hydrophobic tails (non-polar)" },
    { id: "phospholipid", name: "Phospholipid" },
    { id: "channel-protein", name: "Channel protein" },
    { id: "carrier-protein", name: "Carrier protein" },
    { id: "glycoprotein", name: "Glycoprotein" },
    { id: "glycolipid", name: "Glycolipid" },
    { id: "cholesterol", name: "Cholesterol" },
  ],
  build(params: FigureParams) {
    const show = pick<Show>(params.show ?? params.view ?? params.type, [["bilayer", /bilayer|membrane|mosaic/], ["phospholipid", /phospho/], ["triglyceride", /trigly|fat|oil|ester/]], "triglyceride");
    const sk = new Sketch();
    if (show === "bilayer") bilayer(sk);
    else if (show === "phospholipid") phospholipid(sk, Math.round(num(params.unsaturated, 1, 0, 1)));
    else triglyceride(sk, Math.round(num(params.unsaturated, 1, 0, 3)));
    return sk.finish(16, { w: 560, h: 260 });
  },
};
