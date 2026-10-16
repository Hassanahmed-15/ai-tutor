import type { FigureComponent, FigureParams, FigurePart, Ink, Pt } from "../types";
import { PALETTE, clamp, num } from "./mathsKit";
import { Board, type Rect, clean, items, partName, wrap } from "./humanitiesKit";

/**
 * CAUSE → EVENT → CONSEQUENCE. Causes stacked on the left, the event in the centre, consequences on
 * the right (optionally split into short-term and long-term), arrows from every cause into the event
 * and from the event to every consequence; optional extra links ("c1>k2") drawn as dashed curves.
 * Code sizes every box to its wrapped text and spaces the columns; the model gives only the words.
 */

type Item = { key: string; text: string; lines: string[]; box: Rect; part: string; colour: Ink };

const BLUE = PALETTE.blue, GREEN = PALETTE.green, AMBER = PALETTE.amber, VIOLET = PALETTE.violet, RED = PALETTE.red;

export function parseLinks(v: unknown): Array<{ from: string; to: string }> {
  const s = typeof v === "string" ? v : "";
  return s.split(/[;,\s]+/).map((t) => /^([ckl])(\d)\s*(?:>|->|→)\s*([ckl])(\d)$/i.exec(t.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => ({ from: `${m[1].toLowerCase()}${m[2]}`, to: `${m[3].toLowerCase()}${m[4]}` })).slice(0, 6);
}

const CAUSE_PARTS = Array.from({ length: 5 }, (_, i) => ({ id: `cause-${i + 1}`, name: `Cause ${i + 1}` }));
const CONS_PARTS = Array.from({ length: 5 }, (_, i) => ({ id: `consequence-${i + 1}`, name: `Consequence ${i + 1}` }));

export const causeConsequence: FigureComponent = {
  name: "causeConsequence",
  title: "Cause and consequence diagram: causes on the left with arrows into the central event, arrows out to its consequences (short-term and long-term), optional dashed links between items",
  params: `event (the central event, a few words, e.g. "Outbreak of the First World War"); causes (up to 5, separated by ";", each a few words, e.g. "Militarism; Alliance system; Imperial rivalry; Nationalism; Assassination of Franz Ferdinand"); consequences (short-term consequences, up to 5, ";"-separated); longTerm (optional long-term consequences, up to 3, ";"-separated — the right column then splits into Short-term and Long-term); trigger (optional number: which cause is the immediate trigger, drawn red and tagged "Trigger"); links (optional extra arrows, e.g. "c1>k2; k1>l1" where c = cause, k = short-term consequence, l = long-term consequence, numbered from 1); causesTitle, consequencesTitle (column headings; default "Causes", "Consequences"). Keep every item under ~8 words.`,
  match: /\bcauses? and (consequences?|effects?)\b|\bconsequences? of\b|\bcauses? of the\b|\b(long|short)[- ]term (causes?|consequences?|effects?)\b|\bwhy did .{3,60}\b(happen|start|break out|begin|collapse|fall)\b|\bcause[- ]and[- ]effect\b|^(?=[\s\S]*\b(wars?|revolution\w*|elect\w*|presiden\w*|kings?|queens?|reign|empires?|treat(y|ies)|independence|secession|colon\w*|dynast\w*|parliament|congress|reforms?|rebellion|invasion|abolition\w*|slavery|civil rights|partition|monarch\w*|movement)\b)(?=(?:[\s\S]*?\b(led to|leading to|caused|resulted in|sparked|triggered|provoked|contributed to)\b){2})/i,
  parts: [
    { id: "event", name: "Event" },
    { id: "causes", name: "Causes" },
    { id: "consequences", name: "Consequences" },
    { id: "long-term", name: "Long-term consequences" },
    ...CAUSE_PARTS,
    ...CONS_PARTS,
  ],
  selfLabelled: true,
  build(params: FigureParams) {
    let causes = items(params.causes, 5, 80);
    let cons = items(params.consequences ?? params.effects, 5, 80);
    const longTerm = items(params.longTerm ?? params.longterm, 3, 80);
    const fallback = !causes.length && !cons.length;
    if (fallback) {
      causes = ["Militarism", "Alliance system", "Imperial rivalry", "Assassination of Franz Ferdinand"];
      cons = ["Millions killed", "Empires collapse", "Treaty of Versailles"];
    }
    if (!causes.length) causes = ["Cause"];
    if (!cons.length && !longTerm.length) cons = ["Consequence"];
    const eventText = clean(params.event, 80) || (fallback ? "First World War, 1914" : "Event");
    const trigger = Math.round(num(params.trigger, fallback ? 4 : 0, 0, causes.length));
    const links = parseLinks(params.links);
    const causesTitle = clean(params.causesTitle, 22) || "Causes";
    const consTitle = clean(params.consequencesTitle, 22) || "Consequences";

    const size = 17, lineH = 21, colW = 184, evW = 160, gapX = 58, gapY = 14, headH = 34, subH = 26;
    const leftRoom = links.some((l) => l.from[0] === "c" && l.to[0] === "c") ? 46 : 0;
    const linkRoom = links.some((l) => l.from[0] !== "c") ? 46 : 0;
    const xCause = 8 + leftRoom, xEvent = xCause + colW + gapX, xCons = xEvent + evW + gapX;
    const boxH = (lines: string[], tag = false) => 14 + lines.length * lineH + (tag ? 18 : 0);

    // Columns.
    const mk = (texts: string[], key: string, part: (i: number) => string, colour: (i: number) => Ink, x: number, tagged: (i: number) => boolean) =>
      texts.map((t, i): Item => {
        const lines = wrap(t, size, colW - 20, 3);
        return { key: `${key}${i + 1}`, text: t, lines, box: { x, y: 0, w: colW, h: boxH(lines, tagged(i)) }, part: part(i), colour: colour(i) };
      });
    const left = mk(causes, "c", (i) => `cause-${i + 1}`, (i) => (i + 1 === trigger ? RED : BLUE), xCause, (i) => i + 1 === trigger);
    const short = mk(cons, "k", (i) => `consequence-${i + 1}`, () => GREEN, xCons, () => false);
    const long = mk(longTerm, "l", () => "long-term", () => VIOLET, xCons, () => false);
    const split = long.length > 0;
    const stack = (list: Item[], y0: number) => {
      let y = y0;
      for (const it of list) (it.box.y = y), (y += it.box.h + gapY);
      return y - gapY;
    };
    const top = headH + 6;
    const leftEnd = stack(left, top);
    let rightEnd = top;
    let shortHead = top, longHead = top;
    if (split && short.length) {
      shortHead = top;
      rightEnd = stack(short, top + subH);
      longHead = rightEnd + 14;
      rightEnd = stack(long, longHead + subH);
    } else if (split) {
      longHead = top;
      rightEnd = stack(long, top + subH);
    } else rightEnd = stack(short, top);
    // Centre the shorter column against the taller.
    const colH = Math.max(leftEnd, rightEnd) - top;
    const shift = (list: Item[], by: number) => list.forEach((it) => (it.box.y += by));
    if (leftEnd < rightEnd) shift(left, (rightEnd - leftEnd) / 2);
    else {
      const by = (leftEnd - rightEnd) / 2;
      shift(short, by), shift(long, by), (shortHead += by), (longHead += by);
    }
    const evLines = wrap(eventText, 19, evW - 20, 4);
    const evH = Math.max(evLines.length * 24 + 34, Math.min(colH, 150));
    const ev: Rect = { x: xEvent, y: top + colH / 2 - evH / 2, w: evW, h: evH };

    const b = new Board();
    // Headings.
    b.text(xCause + colW / 2, 24, causesTitle, 19, { fill: BLUE, part: "causes" });
    b.text(xCons + colW / 2, 24, consTitle, 19, { fill: GREEN, part: "consequences" });
    // Untagged: the pen pointing at the column heading ("consequences") frames that heading alone.
    if (split && short.length) b.text(xCons + colW / 2, shortHead + 18, "Short-term", 15, { fill: GREEN });
    if (split) b.text(xCons + colW / 2, longHead + 18, "Long-term", 15, { fill: VIOLET, part: "long-term" });

    // Arrows: into the event (heads spread down its left side), out of it to each consequence.
    const spread = (n: number, i: number) => ev.y + 18 + ((ev.h - 36) * (n === 1 ? 0.5 : i / (n - 1)));
    left.forEach((it, i) => b.arrow({ x: it.box.x + it.box.w + 2, y: it.box.y + it.box.h / 2 }, { x: ev.x - 2, y: spread(left.length, i) }, it.colour, 2.2, it.part));
    const right = [...short, ...long];
    right.forEach((it, i) => b.arrow({ x: ev.x + ev.w + 2, y: spread(right.length, i) }, { x: it.box.x - 2, y: it.box.y + it.box.h / 2 }, it.colour, 2.2, it.part));

    // Boxes.
    for (const it of [...left, ...right]) {
      const tagged = it.part === `cause-${trigger}`;
      b.card(it.box, it.colour, it.part, { width: tagged ? 3 : 2 });
      if (tagged) b.text(it.box.x + it.box.w / 2, it.box.y + 17, "TRIGGER", 13, { fill: RED, part: it.part });
      b.lines(it.lines, it.box.x + it.box.w / 2, it.box.y + 7 + (tagged ? 18 : 0), size, { part: it.part, lineH });
    }
    b.card(ev, AMBER, "event", { width: 3, wash: 0.2, r: 14 });
    b.lines(evLines, ev.x + ev.w / 2, ev.y + ev.h / 2 - (evLines.length * 24) / 2 - 2, 19, { part: "event", lineH: 24 });

    // Extra links: dashed curves, routed round the event (over it, or under it) or round a column's outer side.
    const all = new Map([...left, ...right].map((it) => [it.key, it]));
    for (const l of links) {
      const a = all.get(l.from), z = all.get(l.to);
      if (!a || !z || a === z || (a.key[0] !== "c" && z.key[0] === "c")) continue;
      const part = z.part;
      if (a.key[0] === "c" && z.key[0] !== "c") {
        // Leaves the cause's right edge, arcs over (or under) the event, enters the consequence's left edge.
        const below = (a.box.y + z.box.y) / 2 > ev.y + ev.h / 2;
        const f = below ? 0.75 : 0.25;
        const q0 = { x: a.box.x + a.box.w + 2, y: a.box.y + a.box.h * f }, q3 = { x: z.box.x - 2, y: z.box.y + z.box.h * f };
        const yy = below ? ev.y + ev.h + 52 : Math.max(top - 6, ev.y - 52);
        b.curveArrow(q0, { x: ev.x - 6, y: yy }, { x: ev.x + ev.w + 6, y: yy }, q3, RED, 2, part, "6 5");
      } else {
        // Within a column (or from the right column back left): round the outer side.
        const onLeft = a.key[0] === "c" && z.key[0] === "c";
        const ax = onLeft ? a.box.x : a.box.x + a.box.w, zx = onLeft ? z.box.x : z.box.x + z.box.w;
        const out = onLeft ? -40 : 40;
        const p0: Pt = { x: ax, y: a.box.y + a.box.h / 2 }, p3: Pt = { x: zx, y: z.box.y + z.box.h / 2 };
        b.curveArrow(p0, { x: p0.x + out, y: p0.y }, { x: p3.x + out, y: p3.y }, p3, RED, 2, part, "6 5");
      }
    }

    const W = xCons + colW + 8 + linkRoom;
    const bottom = Math.max(top + colH, ev.y + ev.h) + (links.some((l) => l.from[0] === "c" && l.to[0] !== "c") ? 56 : 12);
    const H = Math.ceil(bottom + 8);
    // Parts: groups first, then each box (anchored on its outer edge, where a margin leader reaches it).
    const parts: FigurePart[] = [];
    parts.push({ id: "event", name: partName(eventText, "Event"), anchor: { x: ev.x + ev.w / 2, y: ev.y + 6 } });
    parts.push({ id: "causes", name: causesTitle, anchor: { x: xCause + 6, y: 18 } });
    if (short.length) parts.push({ id: "consequences", name: consTitle, anchor: { x: xCons + colW - 6, y: 18 } });
    if (long.length) parts.push({ id: "long-term", name: long.length === 1 ? partName(long[0].text, "Long-term consequence") : "Long-term consequences", anchor: { x: long[0].box.x + long[0].box.w - 6, y: long[0].box.y + long[0].box.h / 2 } });
    left.forEach((it) => parts.push({ id: it.part, name: partName(it.text, it.part), anchor: { x: it.box.x + 6, y: it.box.y + it.box.h / 2 } }));
    short.forEach((it) => parts.push({ id: it.part, name: partName(it.text, it.part), anchor: { x: it.box.x + it.box.w - 6, y: it.box.y + it.box.h / 2 } }));
    for (const p of parts) p.anchor = { x: clamp(p.anchor.x, 1, W - 1), y: clamp(p.anchor.y, 1, H - 1) };
    return { w: Math.ceil(W), h: H, shapes: b.shapes, parts };
  },
};
