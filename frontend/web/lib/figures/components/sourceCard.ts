import type { FigureComponent, FigureParams, FigurePart, Ink } from "../types";
import { PALETTE, clamp, optNum } from "./mathsKit";
import { Board, type Rect, clean, items, measure, partName, wrap } from "./humanitiesKit";

/**
 * SOURCE CARD. A historical source as an archival card: its type (speech, letter, photograph,
 * cartoon, statistics, diary, official document) with an icon, the provenance fields (author, date,
 * audience, purpose), the content (a short quotation or summary), and a reliability gauge with the
 * source's strengths and limitations. Source-analysis questions ("how useful is Source A…") are
 * answered from exactly these fields.
 */

export const SOURCE_TYPES = ["speech", "letter", "photograph", "cartoon", "statistics", "diary", "official document", "newspaper", "poster", "source"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

export function sourceType(v: unknown): SourceType {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (/speech|address|lecture|sermon/.test(s)) return "speech";
  if (/letter|telegram|correspondence/.test(s)) return "letter";
  if (/photo|picture|image/.test(s)) return "photograph";
  if (/cartoon|caricature/.test(s)) return "cartoon";
  if (/stat|census|table|figures|data|graph|chart/.test(s)) return "statistics";
  if (/diary|journal|memoir/.test(s)) return "diary";
  if (/official|government|treaty|law|act\b|decree|report|minutes|document/.test(s)) return "official document";
  if (/newspaper|article|editorial|press/.test(s)) return "newspaper";
  if (/poster|propaganda|advert/.test(s)) return "poster";
  return "source";
}

/** Reliability 0-100: as given (a number, or high/medium/low), else from strengths vs limitations. */
export function reliabilityScore(v: unknown, strengths: number, limits: number): number {
  const n = optNum(v);
  if (n !== undefined) return clamp(n <= 1 && n > 0 && !Number.isInteger(n) ? n * 100 : n, 0, 100);
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (/very high|highly/.test(s)) return 88;
  if (/high|reliable|strong/.test(s) && !/un|low/.test(s)) return 75;
  if (/medium|moderate|partly|mixed/.test(s)) return 50;
  if (/very low/.test(s)) return 12;
  if (/low|unreliable|weak|biased/.test(s)) return 25;
  return clamp(50 + 14 * (strengths - limits), 10, 90);
}

const AMBER = PALETTE.amber, BLUE = PALETTE.blue, GREEN = PALETTE.green, RED = PALETTE.red, VIOLET = PALETTE.violet;

function icon(b: Board, type: SourceType, x: number, y: number, part: string) {
  // A 40×40 glyph at (x, y).
  const ink: Ink = "ink";
  const st = { stroke: ink, width: 2.2, fill: "none" as const, part };
  switch (type) {
    case "speech":
      b.rect({ x: x + 13, y: y + 2, w: 14, h: 22 }, 7, st);
      b.path(`M${x + 8} ${y + 16} Q${x + 8} ${y + 31} ${x + 20} ${y + 31} Q${x + 32} ${y + 31} ${x + 32} ${y + 16}`, st);
      b.line([{ x: x + 20, y: y + 31 }, { x: x + 20, y: y + 38 }], st);
      b.line([{ x: x + 12, y: y + 38 }, { x: x + 28, y: y + 38 }], st);
      break;
    case "letter":
      b.rect({ x: x + 2, y: y + 8, w: 36, h: 25 }, 3, st);
      b.line([{ x: x + 3, y: y + 10 }, { x: x + 20, y: y + 23 }, { x: x + 37, y: y + 10 }], st);
      break;
    case "photograph":
      b.rect({ x: x + 2, y: y + 6, w: 36, h: 28 }, 3, st);
      b.line([{ x: x + 5, y: y + 31 }, { x: x + 15, y: y + 19 }, { x: x + 22, y: y + 26 }, { x: x + 27, y: y + 21 }, { x: x + 35, y: y + 31 }], st);
      b.circle({ x: x + 29, y: y + 13 }, 3.5, st);
      break;
    case "cartoon":
      b.rect({ x: x + 2, y: y + 4, w: 36, h: 24 }, 9, st);
      b.line([{ x: x + 12, y: y + 28 }, { x: x + 9, y: y + 37 }, { x: x + 20, y: y + 28 }], st);
      b.text(x + 20, y + 22, "!?", 15, { part });
      break;
    case "statistics":
      b.line([{ x: x + 3, y: y + 3 }, { x: x + 3, y: y + 37 }, { x: x + 38, y: y + 37 }], st);
      for (const [i, h] of [[0, 12], [1, 22], [2, 30]] as const) b.rect({ x: x + 8 + i * 10, y: y + 36 - h, w: 7, h }, 1, { fill: BLUE, stroke: ink, width: 1.4, part });
      break;
    case "diary":
      b.rect({ x: x + 6, y: y + 2, w: 28, h: 36 }, 3, st);
      b.line([{ x: x + 12, y: y + 2 }, { x: x + 12, y: y + 38 }], st);
      b.line([{ x: x + 26, y: y + 2 }, { x: x + 26, y: y + 16 }], { stroke: RED, width: 3, part });
      break;
    case "official document":
      b.path(`M${x + 6} ${y + 2} H${x + 28} L${x + 34} ${y + 8} V${y + 38} H${x + 6} Z`, st);
      for (const ly of [10, 16, 22]) b.line([{ x: x + 11, y: y + ly }, { x: x + 29, y: y + ly }], { stroke: ink, width: 1.6, part });
      b.circle({ x: x + 27, y: y + 31 }, 5.5, { fill: RED, stroke: ink, width: 1.4, part });
      break;
    case "newspaper":
      b.rect({ x: x + 2, y: y + 5, w: 36, h: 30 }, 2, st);
      b.line([{ x: x + 6, y: y + 11 }, { x: x + 34, y: y + 11 }], { stroke: ink, width: 3, part });
      for (const ly of [18, 24, 30]) b.line([{ x: x + 6, y: y + ly }, { x: x + 18, y: y + ly }], { stroke: ink, width: 1.4, part }), b.line([{ x: x + 22, y: y + ly }, { x: x + 34, y: y + ly }], { stroke: ink, width: 1.4, part });
      break;
    case "poster":
      b.rect({ x: x + 6, y: y + 2, w: 28, h: 36 }, 2, st);
      b.circle({ x: x + 20, y: y + 15 }, 6, { fill: RED, stroke: ink, width: 1.4, part });
      b.line([{ x: x + 11, y: y + 29 }, { x: x + 29, y: y + 29 }], { stroke: ink, width: 3, part });
      break;
    default:
      b.path(`M${x + 6} ${y + 2} H${x + 28} L${x + 34} ${y + 8} V${y + 38} H${x + 6} Z`, st);
      for (const ly of [12, 19, 26]) b.line([{ x: x + 11, y: y + ly }, { x: x + 29, y: y + ly }], { stroke: ink, width: 1.6, part });
  }
}

export const sourceCard: FigureComponent = {
  name: "sourceCard",
  title: "Historical source card: the source's type with an icon, its provenance (author, date, audience, purpose), a short quotation or summary, and a reliability gauge with strengths and limitations",
  params: `type (speech, letter, photograph, cartoon, statistics, diary, official document, newspaper or poster); title (what the source is, e.g. "Speech to the Reichstag"; optional); author (e.g. "Herbert Spencer, philosopher"); date (e.g. "1864"); audience (who it was for); purpose (why it was made, a few words); quote (a short quotation, up to 160 characters — use only real wording from the lesson's sources) or summary (what it shows, when there is no quotation); strengths (up to 2, ";"-separated, e.g. "Written at the time; By a leading thinker"); limitations (up to 2, ";"-separated, e.g. "One man's opinion; Written to persuade"); reliability (0-100, or "high"/"medium"/"low"; default worked out from strengths vs limitations). Keep every field short.`,
  match: /\b(primary|secondary|historical) sources?\b|\bsource (analysis|evaluation|question)s?\b|\bprovenance\b|\b(reliability|usefulness|utility) of (a |the |this )?(source|account|cartoon|photograph|speech|letter|diary)\b|\bhow (useful|reliable) is (source|this source|the (cartoon|photograph|speech|letter|diary))\b|\bNOP\b.*\bsource\b/i,
  parts: [
    { id: "provenance", name: "Provenance" },
    { id: "content", name: "Content" },
    { id: "purpose", name: "Purpose" },
    { id: "reliability", name: "Reliability" },
    { id: "limitation", name: "Limitation" },
    { id: "strength", name: "Strength" },
    { id: "author", name: "Author" },
    { id: "date", name: "Date" },
    { id: "audience", name: "Audience" },
  ],
  selfLabelled: true,
  build(params: FigureParams) {
    const given = ["author", "date", "quote", "summary", "purpose", "audience", "title"].some((k) => clean(params[k]));
    const type = sourceType(params.type ?? (given ? "" : "letter"));
    const title = clean(params.title, 60) || (given ? "" : "Letter home from the Western Front");
    const author = clean(params.author, 60) || (given ? "Unknown" : "A British soldier");
    const date = clean(params.date, 30) || (given ? "Undated" : "1916");
    const audience = clean(params.audience, 60) || (given ? "—" : "His family at home");
    const purpose = clean(params.purpose, 70) || (given ? "—" : "To reassure his family");
    const quoteRaw = clean(params.quote, 160).replace(/^["“'‘]+|["”'’]+$/g, "");
    const summary = clean(params.summary, 160);
    const isQuote = Boolean(quoteRaw) || !summary;
    const content = quoteRaw || summary || (given ? "(content not given)" : "We are all in good spirits and the food is not bad. Do not worry about me.");
    let strengths = items(params.strengths, 2, 60);
    let limits = items(params.limitations ?? params.limits ?? params.weaknesses, 2, 60);
    if (!given && !strengths.length && !limits.length) (strengths = ["Eyewitness, written at the time"]), (limits = ["Letters were censored", "Wants to reassure his family"]);
    const score = reliabilityScore(params.reliability, strengths.length, limits.length);

    const W = 640, pad = 18;
    const b = new Board();
    const cardX = 6, cardY = 10, cardW = W - 12;
    // Header: icon, TYPE, title.
    const headH = 58;
    const typeLabel = type.toUpperCase();
    const titleLines = title ? wrap(title, 19, cardW - 2 * pad - 60 - measure(typeLabel, 14) - 20, 1) : [];
    // Provenance (left) and content (right).
    const colL = { x: cardX + pad, w: 236 };
    const colR = { x: colL.x + colL.w + 22, w: cardX + cardW - pad - (colL.x + colL.w + 22) };
    const fields: Array<{ id: string; key: string; value: string }> = [
      { id: "author", key: "Author", value: author },
      { id: "date", key: "Date", value: date },
      { id: "audience", key: "Audience", value: audience },
      { id: "purpose", key: "Purpose", value: purpose },
    ];
    const fy0 = cardY + headH + 14;
    let fy = fy0;
    const fieldBoxes = fields.map((f) => {
      const lines = wrap(f.value, 16, colL.w - 16, 2);
      const box: Rect = { x: colL.x, y: fy, w: colL.w, h: 18 + lines.length * 20 + 6 };
      fy += box.h + 6;
      return { ...f, lines, box };
    });
    const provEnd = fy - 6;
    const qSize = 17, qLineH = 22;
    const qLines = wrap(isQuote ? `“${content}”` : content, qSize, colR.w - 34, 6);
    const contentBox: Rect = { x: colR.x, y: fy0, w: colR.w, h: Math.max(provEnd - fy0, qLines.length * qLineH + 40) };
    const midEnd = Math.max(provEnd, contentBox.y + contentBox.h);
    // Reliability: gauge, then strengths and limitations side by side.
    const gy = midEnd + 18;
    const gaugeX = cardX + pad + 128, gaugeW = cardW - 2 * pad - 128 - 6, gaugeH = 14;
    const listY = gy + 44;
    const half = (cardW - 2 * pad - 20) / 2;
    const sLines = strengths.map((t) => wrap(t, 15, half - 30, 2));
    const lLines = limits.map((t) => wrap(t, 15, half - 30, 2));
    const listH = (ls: string[][]) => ls.reduce((h, l) => h + l.length * 19 + 8, 0);
    const listEnd = listY + 22 + Math.max(listH(sLines), listH(lLines), 19);
    const cardH = listEnd + 10 - cardY;

    // The card itself: a parchment wash, a border, two strips of tape.
    b.rect({ x: cardX, y: cardY, w: cardW, h: cardH }, 8, { fill: AMBER, stroke: "none", opacity: 0.09 });
    b.rect({ x: cardX, y: cardY, w: cardW, h: cardH }, 8, { fill: "none", stroke: "ink", width: 2 });
    for (const tx of [cardX + 26, cardX + cardW - 86]) b.path(`M${tx} ${cardY - 8} L${tx + 60} ${cardY - 3} L${tx + 57} ${cardY + 13} L${tx - 3} ${cardY + 8} Z`, { fill: AMBER, stroke: "none", opacity: 0.3 });
    // Header row.
    icon(b, type, cardX + pad, cardY + 10, "provenance");
    const typeX = cardX + pad + 54;
    b.text(typeX, cardY + 30, typeLabel, 14, { anchor: "start", fill: VIOLET, part: "provenance" });
    if (titleLines.length) b.text(typeX, cardY + 50, titleLines[0], 19, { anchor: "start", part: "content" });
    else b.text(typeX, cardY + 50, author, 17, { anchor: "start", part: "author" });
    b.line([{ x: cardX + pad, y: cardY + headH + 4 }, { x: cardX + cardW - pad, y: cardY + headH + 4 }], { stroke: "ink", width: 1.2, opacity: 0.35 });
    // Provenance fields: a small key over each value.
    b.rect({ x: colL.x - 4, y: fy0 - 4, w: colL.w + 8, h: provEnd - fy0 + 8 }, 8, { fill: BLUE, stroke: "none", opacity: 0.07, part: "provenance" });
    for (const f of fieldBoxes) {
      const col: Ink = f.id === "purpose" ? AMBER : BLUE;
      b.text(f.box.x + 8, f.box.y + 14, f.key.toUpperCase(), 13, { anchor: "start", fill: col, part: f.id });
      b.lines(f.lines, f.box.x + 8, f.box.y + 19, 16, { anchor: "start", part: f.id, lineH: 20 });
    }
    // Content.
    b.card(contentBox, VIOLET, "content", { wash: 0.08, width: 1.6, r: 8 });
    if (isQuote) b.text(contentBox.x + 14, contentBox.y + 40, "“", 44, { anchor: "start", fill: VIOLET, part: "content" });
    const qTop = contentBox.y + contentBox.h / 2 - (qLines.length * qLineH) / 2 - 3;
    b.lines(qLines, contentBox.x + contentBox.w / 2 + (isQuote ? 8 : 0), qTop, qSize, { part: "content", lineH: qLineH });
    // Gauge: red → amber → green, a marker at the score.
    b.text(cardX + pad, gy + 12, "RELIABILITY", 14, { anchor: "start", fill: "ink", part: "reliability" });
    const segs: Ink[] = [RED, AMBER, GREEN];
    segs.forEach((c, i) => b.rect({ x: gaugeX + (i * gaugeW) / 3, y: gy, w: gaugeW / 3, h: gaugeH }, i === 1 ? 0 : 6, { fill: c, stroke: "none", opacity: 0.55, part: "reliability" }));
    b.rect({ x: gaugeX, y: gy, w: gaugeW, h: gaugeH }, 6, { fill: "none", stroke: "ink", width: 1.4, part: "reliability" });
    const mx = gaugeX + (score / 100) * gaugeW;
    b.path(`M${mx} ${gy + gaugeH + 2} L${mx - 8} ${gy + gaugeH + 14} L${mx + 8} ${gy + gaugeH + 14} Z`, { fill: "ink", stroke: "ink", width: 1, part: "reliability" });
    b.line([{ x: mx, y: gy - 4 }, { x: mx, y: gy + gaugeH + 2 }], { stroke: "ink", width: 2.6, part: "reliability" });
    b.text(gaugeX, gy + gaugeH + 26, "less reliable", 13, { anchor: "start", fill: "muted", part: "reliability" });
    b.text(gaugeX + gaugeW, gy + gaugeH + 26, "more reliable", 13, { anchor: "end", fill: "muted", part: "reliability" });
    // Strengths and limitations.
    const list = (texts: string[][], x: number, colour: Ink, sign: string, head: string, part: string) => {
      b.text(x, listY + 14, head, 14, { anchor: "start", fill: colour, part });
      let y = listY + 22;
      const firsts: number[] = [];
      for (const lines of texts) {
        b.circle({ x: x + 9, y: y + 10 }, 8, { fill: colour, stroke: "none", opacity: 0.85, part });
        b.text(x + 9, y + 15, sign, 15, { fill: "paper", part });
        b.lines(lines, x + 26, y, 15, { anchor: "start", part, lineH: 19 });
        firsts.push(y + 10);
        y += lines.length * 19 + 8;
      }
      return firsts;
    };
    const sx = cardX + pad, lx = cardX + pad + half + 20;
    const sY = strengths.length ? list(sLines, sx, GREEN, "+", "STRENGTHS", "strength") : [];
    const lY = limits.length ? list(lLines, lx, RED, "−", "LIMITATIONS", "limitation") : [];

    const H = Math.ceil(cardY + cardH + 8);
    const parts: FigurePart[] = [
      { id: "provenance", name: "Provenance", anchor: { x: colL.x - 2, y: fy0 + 6 } },
      { id: "content", name: isQuote ? "Content (quotation)" : "Content", anchor: { x: contentBox.x + contentBox.w - 6, y: contentBox.y + contentBox.h / 2 } },
      { id: "purpose", name: partName(`Purpose: ${purpose}`, "Purpose"), anchor: { x: colL.x - 1, y: fieldBoxes[3].box.y + fieldBoxes[3].box.h / 2 } },
      { id: "reliability", name: "Reliability", anchor: { x: gaugeX + gaugeW - 4, y: gy + gaugeH / 2 } },
    ];
    if (lY.length) parts.push({ id: "limitation", name: partName(limits[0], "Limitation"), anchor: { x: lx + half - 6, y: lY[0] } });
    if (sY.length) parts.push({ id: "strength", name: partName(strengths[0], "Strength"), anchor: { x: sx + 1, y: sY[0] } });
    parts.push({ id: "author", name: partName(author, "Author"), anchor: { x: colL.x - 1, y: fieldBoxes[0].box.y + fieldBoxes[0].box.h / 2 } });
    parts.push({ id: "date", name: partName(date, "Date"), anchor: { x: colL.x - 1, y: fieldBoxes[1].box.y + fieldBoxes[1].box.h / 2 } });
    parts.push({ id: "audience", name: partName(`Audience: ${audience}`, "Audience"), anchor: { x: colL.x - 1, y: fieldBoxes[2].box.y + fieldBoxes[2].box.h / 2 } });
    return { w: W, h: H, shapes: b.shapes, parts };
  },
};
