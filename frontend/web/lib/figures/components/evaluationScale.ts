import type { FigureComponent, FigureParams, FigurePart, Ink, Pt } from "../types";
import { PALETTE, clamp, optNum, rad } from "./mathsKit";
import { Board, type Rect, clean, items, partName, wrap } from "./humanitiesKit";

/**
 * EVALUATION SCALE. "How far do you agree…?" drawn as a balance: the claim above, the arguments FOR
 * stacked as weights on the left pan and AGAINST on the right, the beam tipped toward the heavier side
 * (or to the board's own judgement), a pointer on a dial over the pivot, and the judgement written
 * under the stand. The code sums the weights and works out the tilt.
 */

export type Argument = { text: string; weight: number };

/** "Harsh reparations (3)", "[2] Lost land", "Lost land w=1" → text + weight 1-3 (default 2). */
export function parseArgument(raw: string): Argument {
  let text = raw, weight = 2;
  const m = /\s*[([]\s*(?:w(?:eight)?\s*[=:]?\s*)?([1-3])\s*[)\]]\s*$/i.exec(text) ?? /\s+w(?:eight)?\s*[=:]\s*([1-3])\s*$/i.exec(text);
  const lead = /^\s*[([]\s*([1-3])\s*[)\]]\s*/.exec(text);
  if (m) (weight = Number(m[1])), (text = text.slice(0, m.index));
  else if (lead) (weight = Number(lead[1])), (text = text.slice(lead[0].length));
  return { text: clean(text, 80) || "Argument", weight };
}

/** The judgement position 0-100 (100 = wholly for): as given, else the share of the weight that is for. */
export function judgementPosition(params: FigureParams, forArgs: Argument[], against: Argument[]): number {
  const given = optNum(params.position) ?? optNum(params.judgement);
  if (given !== undefined) return clamp(given, 0, 100);
  const f = forArgs.reduce((t, a) => t + a.weight, 0), g = against.reduce((t, a) => t + a.weight, 0);
  return f + g > 0 ? (100 * f) / (f + g) : 50;
}

/** Beam tilt in degrees: positive = the FOR (left) side down. */
export const tiltFor = (position: number) => {
  // A square-root curve, so a modest lead still visibly tips the beam (55% → ~5°, 100% → 15°).
  const d = (clamp(position, 0, 100) - 50) / 50;
  return Math.sign(d) * Math.sqrt(Math.abs(d)) * 15;
};

const BLUE = PALETTE.blue, RED = PALETTE.red, VIOLET = PALETTE.violet, AMBER = PALETTE.amber;
const FOR_PARTS = Array.from({ length: 4 }, (_, i) => ({ id: `for-${i + 1}`, name: `For ${i + 1}` }));
const AGAINST_PARTS = Array.from({ length: 4 }, (_, i) => ({ id: `against-${i + 1}`, name: `Against ${i + 1}` }));

export const evaluationScale: FigureComponent = {
  name: "evaluationScale",
  title: "Evaluation balance: a claim above a pair of scales, arguments for and against stacked as weights on each pan, the beam tipped toward the stronger side, and the overall judgement",
  params: `claim (the question or statement judged, e.g. "Was the Treaty of Versailles fair?"); for (arguments for, up to 4, separated by ";", each a few words, optionally weighted 1-3 with "(3)" at the end, e.g. "Germany started the war (2); France had suffered huge damage (3)"); against (arguments against, same format); position (optional 0-100 judgement: 100 = wholly for, 50 = balanced, 0 = wholly against; default computed from the weights); judgement (the conclusion in a few words, e.g. "Harsh, but not unfair"; a number here is read as position); forTitle, againstTitle (pan headings; default "For", "Against"). The beam tips toward the heavier (or judged) side.`,
  match: /\bhow far do you agree\b|\bto what extent\b|\bweigh(ing)? up\b|\bevaluat\w* (the )?(argument|claim|view|statement)s?\b|\barguments? for and against\b|\bfor and against\b|\bwas (the |it )?.{3,60}\b(fair|justified|successful|a success|a failure|inevitable)\?/i,
  parts: [
    { id: "claim", name: "Claim" },
    { id: "for-arguments", name: "Arguments for" },
    { id: "against-arguments", name: "Arguments against" },
    { id: "judgement", name: "Judgement" },
    { id: "pivot", name: "Pivot (balance point)" },
    ...FOR_PARTS,
    ...AGAINST_PARTS,
  ],
  selfLabelled: true,
  build(params: FigureParams) {
    const given = Boolean(clean(params.claim) || clean(params.for) || clean(params.against));
    let forArgs = items(params.for ?? params.forArguments, 4, 90).map(parseArgument);
    let against = items(params.against ?? params.againstArguments, 4, 90).map(parseArgument);
    const claim = clean(params.claim ?? params.question, 120) || (given ? "Claim" : "Was the Treaty of Versailles fair?");
    if (!given) {
      forArgs = [{ text: "Germany had started the war", weight: 2 }, { text: "France had suffered huge damage", weight: 3 }];
      against = [{ text: "Germany was not allowed a say", weight: 2 }, { text: "Reparations were crippling", weight: 2 }, { text: "War-guilt clause humiliated Germany", weight: 1 }];
    }
    if (!forArgs.length) forArgs = [{ text: "(no arguments given)", weight: 0 }];
    if (!against.length) against = [{ text: "(no arguments given)", weight: 0 }];
    const position = judgementPosition(params, forArgs, against);
    const theta = tiltFor(position);
    const judgementText = typeof params.judgement === "string" && optNum(params.judgement) === undefined ? clean(params.judgement, 80) : "";
    const forTitle = clean(params.forTitle, 18) || "For";
    const againstTitle = clean(params.againstTitle, 18) || "Against";
    const forSum = forArgs.reduce((t, a) => t + a.weight, 0), againstSum = against.reduce((t, a) => t + a.weight, 0);

    const W = 620, cx = W / 2, L = 180, panW = 214, blockW = panW - 18;
    const b = new Board();
    // Claim banner.
    const claimLines = wrap(claim, 19, 480, 2);
    const claimBox: Rect = { x: cx - 260, y: 8, w: 520, h: claimLines.length * 24 + 22 };
    b.card(claimBox, VIOLET, "claim", { r: 12, wash: 0.12 });
    b.lines(claimLines, cx, claimBox.y + 10, 19, { part: "claim", lineH: 24 });
    // Dial over the pivot, and the pivot itself.
    const pivot: Pt = { x: cx, y: claimBox.y + claimBox.h + 76 };
    const dialR = 58;
    b.path(`M${cx - dialR * Math.sin(rad(30))} ${pivot.y - dialR * Math.cos(rad(30))} A${dialR} ${dialR} 0 0 1 ${cx + dialR * Math.sin(rad(30))} ${pivot.y - dialR * Math.cos(rad(30))}`, { stroke: "muted", width: 2, fill: "none", part: "pivot" });
    for (const a of [-30, -15, 0, 15, 30]) {
      const s = Math.sin(rad(a)), c = Math.cos(rad(a));
      b.line([{ x: cx + (dialR - 6) * s, y: pivot.y - (dialR - 6) * c }, { x: cx + (dialR + 4) * s, y: pivot.y - (dialR + 4) * c }], { stroke: "muted", width: a ? 1.6 : 2.4, part: "pivot" });
    }
    b.text(cx - dialR * Math.sin(rad(30)) - 8, pivot.y - dialR * Math.cos(rad(30)) + 4, forTitle, 13, { anchor: "end", fill: BLUE, part: "pivot" });
    b.text(cx + dialR * Math.sin(rad(30)) + 8, pivot.y - dialR * Math.cos(rad(30)) + 4, againstTitle, 13, { anchor: "start", fill: RED, part: "pivot" });

    // Beam ends (y down: the FOR end drops when theta > 0).
    const t = rad(theta);
    const endL: Pt = { x: cx - L * Math.cos(t), y: pivot.y + L * Math.sin(t) };
    const endR: Pt = { x: cx + L * Math.cos(t), y: pivot.y - L * Math.sin(t) };
    // Blocks for each side, and the string length that holds the taller stack.
    const blocks = (args: Argument[]) => args.map((a) => ({ a, lines: wrap(a.text, 15, blockW - 34, 2) })).map((x) => ({ ...x, h: x.lines.length * 19 + 14 }));
    const bl = blocks(forArgs), br = blocks(against);
    const stackH = (bs: typeof bl) => bs.reduce((s, x) => s + x.h + 6, 0);
    const S = Math.max(stackH(bl), stackH(br)) + 22;
    const pans: Array<{ side: "for" | "against"; end: Pt; bs: typeof bl; colour: Ink; title: string; sum: number }> = [
      { side: "for", end: endL, bs: bl, colour: BLUE, title: forTitle, sum: forSum },
      { side: "against", end: endR, bs: br, colour: RED, title: againstTitle, sum: againstSum },
    ];
    const lowestDish = Math.max(endL.y, endR.y) + 14 + S;
    const baseY = lowestDish + 30;
    // Stand: base, post, beam, pivot pin, pointer.
    b.path(`M${cx - 70} ${baseY + 16} L${cx - 46} ${baseY} H${cx + 46} L${cx + 70} ${baseY + 16} Z`, { fill: "wood", stroke: "ink", width: 2, part: "pivot" });
    b.path(`M${cx - 6} ${pivot.y + 8} H${cx + 6} V${baseY} H${cx - 6} Z`, { fill: "metal", stroke: "ink", width: 2, part: "pivot" });
    b.path(`M${cx - 18} ${pivot.y + 22} L${cx} ${pivot.y - 2} L${cx + 18} ${pivot.y + 22} Z`, { fill: "metal", stroke: "ink", width: 2, part: "pivot" });
    const needleEnd = { x: cx - (dialR - 10) * Math.sin(t), y: pivot.y - (dialR - 10) * Math.cos(t) };
    b.line([pivot, needleEnd], { stroke: AMBER, width: 3.2, part: "pivot" });
    b.line([endL, endR], { stroke: "ink", width: 6, part: "pivot" });
    b.circle(pivot, 6, { fill: AMBER, stroke: "ink", width: 2, part: "pivot" });

    const parts: FigurePart[] = [];
    for (const pan of pans) {
      const group = `${pan.side}-arguments`;
      const { end } = pan;
      const barY = end.y + 14, dishY = barY + S;
      const x0 = end.x - panW / 2, x1 = end.x + panW / 2;
      b.line([end, { x: end.x, y: barY }], { stroke: "ink", width: 2, part: group });
      b.circle(end, 4, { fill: "ink", stroke: "ink", width: 1, part: group });
      b.line([{ x: x0 + 4, y: barY }, { x: x1 - 4, y: barY }], { stroke: "ink", width: 3, part: group });
      b.line([{ x: x0 + 4, y: barY }, { x: x0 + 4, y: dishY }], { stroke: "muted", width: 1.6, part: group });
      b.line([{ x: x1 - 4, y: barY }, { x: x1 - 4, y: dishY }], { stroke: "muted", width: 1.6, part: group });
      b.path(`M${x0 - 6} ${dishY} H${x1 + 6} Q${x1 - 20} ${dishY + 22} ${end.x} ${dishY + 22} Q${x0 + 20} ${dishY + 22} ${x0 - 6} ${dishY} Z`, { fill: pan.colour, stroke: "ink", width: 2, opacity: 1, part: group });
      // Arguments stacked up from the dish, the first at the bottom.
      let y = dishY - 4;
      pan.bs.forEach((blk, i) => {
        const id = `${pan.side}-${i + 1}`;
        y -= blk.h;
        const box: Rect = { x: end.x - blockW / 2, y, w: blockW, h: blk.h };
        b.card(box, pan.colour, id, { r: 7, wash: 0.1 + 0.07 * blk.a.weight, width: 1.8 });
        // Weight: 1-3 pips on the block's inner side (the outer side is where a label's leader arrives).
        const outerLeft = pan.side === "for";
        const pipX = outerLeft ? box.x + box.w - 12 : box.x + 12;
        for (let k = 0; k < 3; k++) b.circle({ x: pipX, y: box.y + box.h / 2 + (k - 1) * 9 }, 3.2, { fill: k < blk.a.weight ? pan.colour : "none", stroke: pan.colour, width: 1.4, part: id });
        b.lines(blk.lines, outerLeft ? box.x + (box.w - 22) / 2 : box.x + 22 + (box.w - 22) / 2, box.y + 6, 15, { part: id, lineH: 19 });
        parts.push({ id, name: partName(blk.a.text, id), anchor: outerLeft ? { x: box.x + 3, y: box.y + box.h / 2 } : { x: box.x + box.w - 3, y: box.y + box.h / 2 } });
        y -= 6;
      });
      // Heading and total under the dish.
      b.text(end.x, dishY + 42, `${pan.title.toUpperCase()} · weight ${pan.sum}`, 15, { fill: pan.colour, part: group });
      parts.unshift({ id: group, name: pan.side === "for" ? `Arguments ${forTitle.toLowerCase()}` : `Arguments ${againstTitle.toLowerCase()}`, anchor: { x: pan.side === "for" ? x0 + 6 : x1 - 6, y: barY } });
    }

    // Judgement under the stand.
    const verdict = position >= 65 ? `Mostly ${forTitle.toLowerCase()}` : position <= 35 ? `Mostly ${againstTitle.toLowerCase()}` : "Finely balanced";
    const jText = judgementText || verdict;
    const jLines = wrap(`Judgement: ${jText}`, 17, 440, 2);
    const jBox: Rect = { x: cx - 240, y: Math.max(baseY + 26, lowestDish + 52), w: 480, h: jLines.length * 22 + 18 };
    b.card(jBox, AMBER, "judgement", { r: 10, wash: 0.16 });
    b.lines(jLines, cx, jBox.y + 8, 17, { part: "judgement", lineH: 22 });

    parts.unshift(
      { id: "claim", name: partName(claim, "Claim"), anchor: { x: claimBox.x + 6, y: claimBox.y + claimBox.h / 2 } },
      { id: "pivot", name: "Pivot (balance point)", anchor: { x: cx + 4, y: pivot.y + 16 } },
      { id: "judgement", name: partName(jText, "Judgement"), anchor: { x: jBox.x + jBox.w - 6, y: jBox.y + jBox.h / 2 } },
    );
    const H = Math.ceil(jBox.y + jBox.h + 10);
    return { w: W, h: H, shapes: b.shapes, parts };
  },
};
