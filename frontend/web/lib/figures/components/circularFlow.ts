import type { FigureComponent, FigureParams, FigurePart, Ink, Pt } from "../types";
import { trimToFit } from "../../text/fit";
import { PALETTE, Sketch, arrow, bool, optNum } from "./mathsKit";
import { txt } from "./econKit";

/**
 * THE CIRCULAR FLOW OF INCOME. Households on the left, firms on the right; across the top the factor
 * market (factor services from households to firms, income — wages, rent, interest, profit — back),
 * across the bottom the goods market (goods and services to households, consumer expenditure back).
 * Real flows run on the inner loops, money flows on the outer ones. Each added sector stands between
 * the two: a withdrawal arrow from households into it (S, T, M) and an injection from it into firms
 * (I, G, X).
 */

export type Sector = "financial" | "government" | "overseas";
const SECTOR: Record<Sector, { name: string; out: string; inn: string; outName: string; inName: string }> = {
  financial: { name: "Financial sector", out: "S", inn: "I", outName: "Saving (S)", inName: "Investment (I)" },
  government: { name: "Government", out: "T", inn: "G", outName: "Taxation (T)", inName: "Government spending (G)" },
  overseas: { name: "Overseas", out: "M", inn: "X", outName: "Imports (M)", inName: "Exports (X)" },
};

/** Which sectors besides households and firms: a count (2–5) or names. 3 adds government, 4 overseas (open economy), 5 the financial sector. */
export function parseSectors(params: FigureParams): Sector[] {
  const raw = params.sectors ?? params.sector ?? params.model;
  const n = optNum(typeof raw === "string" ? raw.replace(/[^\d.]/g, "") || undefined : raw);
  const s = txt(raw).toLowerCase();
  const named: Sector[] = [];
  if (/financ|bank|capital market|sav(ing|e)s?\b/.test(s)) named.push("financial");
  if (/govern|state|public sector|tax/.test(s)) named.push("government");
  if (/overseas|foreign|international|rest of (the )?world|trade|open/.test(s)) named.push("overseas");
  const order: Sector[] = ["financial", "government", "overseas"];
  if (named.length) return order.filter((x) => named.includes(x));
  const k = n !== undefined && Number.isFinite(n) ? Math.round(Math.max(2, Math.min(5, n))) : 2;
  const pick: Sector[] = k >= 5 ? ["financial", "government", "overseas"] : k === 4 ? ["government", "overseas"] : k === 3 ? ["government"] : [];
  return order.filter((x) => pick.includes(x));
}

export const circularFlow: FigureComponent = {
  name: "circularFlow",
  title: "Circular flow of income diagram: households and firms, factor and goods markets, money and real flows, injections (I, G, X) and withdrawals (S, T, M)",
  params: `sectors (2 — households and firms, default —, 3 adds government, 4 adds overseas (open economy), 5 adds the financial sector; or name them, e.g. "government, financial sector"), flows ("both" — default —, "money" for income and expenditure only, "real" for factor services and goods and services only), injections (false hides the withdrawal and injection arrows of the added sectors). Real flows are the inner loops, money flows the outer loops.`,
  match: /\b(circular flow( of (income|money|national income))?|injections? and (withdrawals?|leakages?)|(withdrawals?|leakages?) and injections?|(two|three|four|five)[- ]sector (model|economy|circular flow))\b/i,
  parts: [
    { id: "income", name: "Income (wages, rent, interest)" },
    { id: "expenditure", name: "Consumer expenditure" },
    { id: "goods-services", name: "Goods and services" },
    { id: "factor-services", name: "Factor services (labour, land)" },
    { id: "withdrawals", name: "Withdrawals" },
    { id: "injections", name: "Injections" },
    { id: "households", name: "Households" },
    { id: "firms", name: "Firms" },
    { id: "banks", name: "Financial sector" },
    { id: "government", name: "Government" },
    { id: "overseas", name: "Overseas" },
  ],
  selfLabelled: true,
  build(params: FigureParams) {
    const sectors = parseSectors(params);
    const flowsWord = txt(params.flows).toLowerCase();
    const money = !/^real/.test(flowsWord) || /both|all/.test(flowsWord);
    const real = !/^money/.test(flowsWord) || /both|all/.test(flowsWord);
    const leaks = bool(params.injections ?? params.withdrawals, true) && sectors.length > 0;
    const sk = new Sketch();
    const parts: FigurePart[] = [];
    const REAL: Ink = PALETTE.blue, MONEY: Ink = PALETTE.amber, OUT: Ink = PALETTE.red, IN: Ink = PALETTE.green;

    // Columns: households | sectors | firms.
    const boxW = 150, midW = 180, gapX = 78;
    const hx = 0, mx = sectors.length ? hx + boxW + gapX : hx + boxW + 60, fx = sectors.length ? mx + midW + gapX : mx;
    const rowGap = 92;
    const rows = sectors.map((_, i) => (i - (sectors.length - 1) / 2) * rowGap);
    const boxH = Math.max(80, sectors.length ? rows[rows.length - 1] - rows[0] + 76 : 80);
    const top = -boxH / 2, bot = boxH / 2;
    const box = (x: number, y: number, w: number, h: number, label: string, part: string, fill: Ink = "paper") => {
      sk.polygon([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], { fill, stroke: "ink", width: 2.4, part });
      sk.text({ x: x + w / 2, y: y + h / 2 }, label, label.length > 12 ? 17 : 19, "ink", part);
    };
    box(hx, top, boxW, boxH, "Households", "households");
    box(fx, top, boxW, boxH, "Firms", "firms");
    parts.push({ id: "households", name: "Households", anchor: { x: hx + 14, y: top + 14 } });
    parts.push({ id: "firms", name: "Firms", anchor: { x: fx + boxW - 14, y: top + 14 } });

    // Added sectors between them, each with its withdrawal (from households) and injection (to firms).
    const sTop = sectors.length ? rows[0] - 26 : 0, sBot = sectors.length ? rows[rows.length - 1] + 26 : 0;
    sectors.forEach((sec, i) => {
      const y = rows[i];
      const id = sec === "financial" ? "banks" : sec;
      box(mx, y - 26, midW, 52, SECTOR[sec].name, id);
      parts.push({ id, name: SECTOR[sec].name, anchor: { x: mx + 12, y: y - 14 } });
      if (!leaks) return;
      arrow(sk, { x: hx + boxW, y }, { x: mx, y }, OUT, 2.8, "withdrawals", 13);
      arrow(sk, { x: mx + midW, y }, { x: fx, y }, IN, 2.8, "injections", 13);
      sk.text({ x: hx + boxW + gapX / 2, y: y - 15 }, SECTOR[sec].out, 20, OUT, "withdrawals");
      sk.text({ x: mx + midW + gapX / 2, y: y - 15 }, SECTOR[sec].inn, 20, IN, "injections");
    });
    if (leaks) {
      const y0 = rows[0];
      const outs = sectors.map((s) => SECTOR[s].out).join(", "), ins = sectors.map((s) => SECTOR[s].inn).join(", ");
      parts.push({ id: "withdrawals", name: sectors.length === 1 ? SECTOR[sectors[0]].outName : `Withdrawals (${outs})`, anchor: { x: hx + boxW + gapX * 0.3, y: y0 } });
      parts.push({ id: "injections", name: sectors.length === 1 ? SECTOR[sectors[0]].inName : `Injections (${ins})`, anchor: { x: mx + midW + gapX * 0.7, y: y0 } });
    }

    // The loops: inner (real) and outer (money), over the top (factor market) and under (goods market).
    const loop = (xFrom: number, xTo: number, yEdge: number, yRun: number, colour: Ink, part: string, name: string) => {
      const a = { x: xFrom, y: yEdge }, b = { x: xFrom, y: yRun }, c = { x: xTo, y: yRun }, d = { x: xTo, y: yEdge };
      sk.line([a, b, c], { stroke: colour, width: 3, part });
      arrow(sk, c, d, colour, 3, part, 15);
      // A mid-run chevron shows the direction along the long side.
      const mid: Pt = { x: (xFrom + xTo) / 2, y: yRun }, dir = Math.sign(xTo - xFrom);
      sk.polygon([{ x: mid.x + dir * 9, y: yRun }, { x: mid.x - dir * 7, y: yRun - 8 }, { x: mid.x - dir * 7, y: yRun + 8 }], { fill: colour, stroke: colour, width: 1, part });
      parts.push({ id: part, name, anchor: { x: mid.x + (xTo - xFrom) * 0.22, y: yRun } });
    };
    const clearTop = Math.min(top, sTop) - 40, clearBot = Math.max(bot, sBot) + 40;
    const hIn = hx + boxW * 0.68, hOut = hx + boxW * 0.32, fIn = fx + boxW * 0.32, fOut = fx + boxW * 0.68;
    if (real) loop(hIn, fIn, top, clearTop, REAL, "factor-services", "Factor services (labour, land)");
    if (money) loop(fOut, hOut, top, clearTop - 40, MONEY, "income", "Income (wages, rent, interest)");
    if (real) loop(fIn, hIn, bot, clearBot, REAL, "goods-services", "Goods and services");
    if (money) loop(hOut, fOut, bot, clearBot + 40, MONEY, "expenditure", "Consumer expenditure");
    // Flows first, then injections/withdrawals, then the boxes (whose names are written inside them).
    const rank = (id: string) => ["income", "expenditure", "goods-services", "factor-services", "withdrawals", "injections"].indexOf(id);
    parts.sort((a, b) => (rank(a.id) < 0 ? 99 : rank(a.id)) - (rank(b.id) < 0 ? 99 : rank(b.id)));
    // Self-labelled: these names are pen targets, never drawn, so they are only kept whole-worded (not sent for a rewrite).
    for (const p of parts) sk.part(p.id, trimToFit(p.name, 34), p.anchor);
    return sk.finish(16);
  },
};
