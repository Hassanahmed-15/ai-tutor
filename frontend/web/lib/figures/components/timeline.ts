import type { FigureComponent, FigureParams, FigurePart, Ink } from "../types";
import { bool, clamp } from "./mathsKit";
import { Board, COLOURS, type Rect, clean, items, measure, partName, wrap } from "./humanitiesKit";

/**
 * TIMELINE. Dated events on a time axis drawn TO SCALE (BCE dates are negative years), each on a
 * card above or below the axis joined to its date by a stem; optional periods/eras as shaded spans
 * on the axis; an arrowhead (or "Today") at the later end. The code orders the events, scales the
 * axis, and places cards so none overlap and no stem crosses another card.
 */

export type ParsedDate = { year: number; label: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "1789", "14 July 1789", "c. 500 BCE", "AD 43", "1940s", "44 BC" → a (fractional) year. */
export function parseYear(raw: string, eraHint?: "BCE" | "CE"): number | null {
  const s = raw.replace(/,(?=\d{3}\b)/g, "").trim();
  const all = [...s.matchAll(/(?:\b(AD|A\.D\.|CE)\s*)?(-?\d{1,6}(?:\.\d+)?)\s*(s\b)?\s*(BCE|B\.C\.E\.|BC|B\.C\.|CE|C\.E\.|AD|A\.D\.)?/gi)];
  if (!all.length) return null;
  // The year: the number with an era, else the last number ("14 July 1789" → 1789).
  const m = all.find((x) => x[1] || x[4]) ?? all[all.length - 1];
  let y = Number(m[2]);
  if (!Number.isFinite(y)) return null;
  const era = (m[4] ?? m[1] ?? "").toUpperCase().replace(/\./g, "");
  const bce = era === "BCE" || era === "BC" || (!era && eraHint === "BCE");
  if (bce) y = -Math.abs(y);
  if (m[3]) y += 5; // "1940s": the middle of the decade
  const month = MONTHS.findIndex((mo) => new RegExp(`\\b${mo}[a-z]*\\b`, "i").test(s));
  if (month >= 0 && !bce) y += (month + 0.5) / 12;
  return y;
}

/** "1789-1799", "500–300 BCE", "1914 to 1918" → [start, end] (an era written once applies to both). */
export function parseRange(raw: string): [number, number] | null {
  const parts = raw.split(/\s*(?:–|—|\bto\b|-(?=\s*\d|\s*[A-Za-z]{3}))\s*/i).filter(Boolean);
  if (parts.length < 2) return null;
  const hint = /\b(BCE|BC|B\.C\.)\b/i.test(parts[1]) && !/\b(CE|AD)\b/i.test(parts[0]) ? "BCE" : undefined;
  const a = parseYear(parts[0], hint), b = parseYear(parts[1]);
  if (a === null || b === null) return null;
  return a <= b ? [a, b] : [b, a];
}

/** "1789: Revolution begins" → { date, text }. A missing colon takes a leading date. */
function splitEvent(s: string): { date: string; text: string } {
  const m = /^(.{1,40}?)\s*[:—–]\s+(.+)$/.exec(s) ?? /^(.{1,40}?):(.+)$/.exec(s);
  if (m) return { date: m[1].trim(), text: m[2].trim() };
  const lead = /^((?:c\.\s*)?(?:\d{1,2}\s+)?(?:[A-Za-z]{3,9}\s+)?\d{1,6}s?(?:\s*(?:BCE|BC|CE|AD))?)\s+(.+)$/i.exec(s);
  if (lead) return { date: lead[1], text: lead[2] };
  return { date: s, text: "" };
}

export type TimelineEvent = { date: string; text: string; year: number; i: number };
export type TimelinePeriod = { name: string; from: number; to: number; text: string };

export function timelineData(params: FigureParams): { events: TimelineEvent[]; periods: TimelinePeriod[]; min: number; max: number; today: boolean } {
  const rawEvents = items(params.events, 10, 90);
  let events: TimelineEvent[] = [];
  for (const r of rawEvents) {
    const { date, text } = splitEvent(r);
    const range = parseRange(date);
    const y = range ? range[0] : parseYear(date);
    if (y === null) continue;
    events.push({ date: clean(date, 24), text: clean(text, 70), year: y, i: events.length });
  }
  if (events.length < 2) {
    events = [
      { date: "1789", text: "Storming of the Bastille", year: 1789.5, i: 0 },
      { date: "1793", text: "Reign of Terror begins", year: 1793.7, i: 1 },
      { date: "1799", text: "Napoleon takes power", year: 1799.8, i: 2 },
      { date: "1804", text: "Napoleon crowned Emperor", year: 1804.9, i: 3 },
    ];
  }
  // A bare year written after month dates of that year ("Feb 1861 … Apr 1861 … 1861: war expands") is
  // later in that year, not its 1 January.
  const hasMonth = (e: TimelineEvent) => MONTHS.some((mo) => new RegExp(`\\b${mo}[a-z]*\\b`, "i").test(e.date));
  for (const e of events) {
    if (hasMonth(e) || e.year !== Math.floor(e.year)) continue;
    const before = events.filter((o) => o.i < e.i && Math.floor(o.year) === e.year && hasMonth(o));
    if (before.length) e.year = Math.max(...before.map((o) => o.year)) + 0.001;
  }
  events.sort((a, b) => a.year - b.year || a.i - b.i);
  const periods: TimelinePeriod[] = [];
  for (const r of items(params.periods ?? params.eras, 4, 70)) {
    const { date, text } = splitEvent(r);
    const range = parseRange(date);
    if (!range) continue;
    periods.push({ name: clean(text, 40) || clean(date, 24), from: range[0], to: Math.max(range[1], range[0] + 1e-6), text: clean(date, 24) });
  }
  const today = bool(params.today, false) || (typeof params.today === "string" && /today|present|now/i.test(params.today));
  const years = [...events.map((e) => e.year), ...periods.flatMap((p) => [p.from, p.to])];
  let min = Math.min(...years), max = Math.max(...years);
  if (today) max = Math.max(max, new Date().getFullYear());
  if (max - min < 1) (min -= 1), (max += 1);
  return { events, periods, min, max, today };
}

const fmtYear = (y: number, bceSpan: boolean) => {
  const r = Math.round(y);
  if (r < 0) return `${-r} BCE`;
  return bceSpan ? `${r} CE` : String(r);
};

const SHIFTS = [0, ...Array.from({ length: 16 }, (_, i) => [(i + 1) * 20, -(i + 1) * 20]).flat()];
function segmentsCross(p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }, s: { x: number; y: number }): boolean {
  const d = (a: typeof p, b: typeof p, c: typeof p) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return d(r, s, p) * d(r, s, q) < 0 && d(p, q, r) * d(p, q, s) < 0;
}

const EVENT_PARTS = Array.from({ length: 10 }, (_, i) => ({ id: `event-${i + 1}`, name: `Event ${i + 1}` }));
const PERIOD_PARTS = [{ id: "period", name: "Period" }, { id: "period-2", name: "Period 2" }, { id: "period-3", name: "Period 3" }, { id: "period-4", name: "Period 4" }];

export const timeline: FigureComponent = {
  name: "timeline",
  title: "Timeline drawn to scale: dated events on cards alternating above and below a time axis, optional shaded periods/eras, an arrow (or Today) at the later end",
  params: `events (up to 10, separated by ";", each "date: short event", e.g. "1789: Storming of the Bastille; 1793: Reign of Terror; 1799: Napoleon takes power"; dates may be "14 July 1789", "c. 500 BCE", "44 BC", "AD 43", "1940s"; order does not matter — code sorts them and spaces them in proportion to the dates; keep each event under ~8 words); periods (optional shaded spans on the axis, up to 4, ";"-separated "start-end: name", e.g. "1789-1799: French Revolution; 1799-1815: Napoleonic era"; "500-300 BCE: …" works); today (true: extend the axis to the present year and mark "Today"); title (optional heading over the axis, e.g. "The French Revolution"). Parts event-1… are the events in date order.`,
  match: /\btime\s?lines?\b|\bchronolog(y|ical(ly)?)\b|\bsequence of (events|dates)\b|\bkey dates\b|\bturning points?\b.*\b(history|war|revolution)\b|^(?=[\s\S]*\b(wars?|revolution\w*|elect\w*|presiden\w*|kings?|queens?|reign|empires?|treat(y|ies)|independence|secession|colon\w*|dynast\w*|parliament|congress|reforms?|rebellion|invasion|abolition\w*|slavery|civil rights|partition|monarch\w*|movement)\b)(?=(?:[\s\S]*?\b1[0-9]{3}\b){3})/i,
  parts: [...EVENT_PARTS, ...PERIOD_PARTS, { id: "arrow-end", name: "Later (time →)" }],
  selfLabelled: true,
  build(params: FigureParams) {
    const { events, periods, min, max, today } = timelineData(params);
    const title = clean(params.title, 60);
    const n = events.length;
    const W = n <= 4 ? 560 : n <= 6 ? 600 : n <= 8 ? 660 : 740;
    const cardW = n <= 4 ? 168 : n <= 6 ? 148 : n <= 8 ? 128 : 126;
    const dateSize = 19, textSize = 17, lineH = 21;
    const maxLines = 3;
    const padX = cardW / 2 + 8;
    const x0 = padX, x1 = W - padX - (today ? 30 : 0);
    const span = max - min;
    const scaled = (y: number) => x0 + ((y - min) / span) * (x1 - x0);
    // Dates too close to share the axis at true scale (a year of events on a cramped line) are spaced
    // evenly in date order instead — each card keeps its own date, and the axis drops its scale ticks
    // so it never pretends to be to scale (audit 2026-10-17).
    const sortedYears = events.map((e) => e.year);
    // Cards alternate above and below, so the cards that can collide are every second one; stems and
    // dots need a little room between neighbours too.
    const gap = (i: number, j: number) => scaled(sortedYears[j]) - scaled(sortedYears[i]);
    const crowded = n > 1 && sortedYears.some((_, i) => (i + 1 < n && gap(i, i + 1) < 26) || (i + 2 < n && gap(i, i + 2) < cardW + 8));
    const rank = new Map(events.map((e, i) => [e, i]));
    const ordinal = (k: number) => x0 + (k / Math.max(1, n - 1)) * (x1 - x0);
    // Evenly spaced cards: any other date (a period's ends) is placed between the events it falls between.
    const between = (y: number) => {
      if (y <= sortedYears[0]) return ordinal(0);
      if (y >= sortedYears[n - 1]) return ordinal(n - 1);
      const k = sortedYears.findIndex((v, i) => i < n - 1 && y >= v && y <= sortedYears[i + 1]);
      const span = sortedYears[k + 1] - sortedYears[k];
      return ordinal(k) + (span > 0 ? (y - sortedYears[k]) / span : 0) * (ordinal(k + 1) - ordinal(k));
    };
    const X = (y: number, e?: (typeof events)[number]) => (crowded ? (e ? ordinal(rank.get(e) ?? 0) : between(y)) : scaled(y));
    const bceSpan = min < 0;

    // Cards: size from their wrapped text.
    const cards = events.map((e, k) => {
      const lines = e.text ? wrap(e.text, textSize, cardW - 18, maxLines) : [];
      // The date at full size when it fits, else smaller (never past the card's edge).
      const ds = [dateSize, 16, 14].find((sz) => measure(e.date, sz) <= cardW - 16) ?? 14;
      const dateLines = wrap(e.date, ds, cardW - 16, 1);
      const h = 12 + dateSize * 1.1 + Math.max(1, lines.length) * lineH + 10;
      return { e, k, lines, dateLines, ds, h, x: X(e.year, e), box: { x: 0, y: 0, w: cardW, h } as Rect, up: true, stem: [] as Array<{ x: number; y: number }> };
    });
    // One height for every card, so the rows read as rows.
    const maxH = Math.max(...cards.map((c) => c.h));
    for (const c of cards) (c.h = maxH), (c.box.h = maxH);

    // Period rows on the axis (overlapping periods take a second row).
    const bandH = 28;
    const rows: number[] = [];
    const periodRow = periods.map((p) => {
      let r = rows.findIndex((end) => end <= p.from);
      if (r < 0 || r > 1) r = rows.length < 2 ? rows.length : 1;
      rows[r] = Math.max(rows[r] ?? -Infinity, p.to);
      return r;
    });
    const rowCount = periods.length ? Math.max(...periodRow) + 1 : 0;
    const halfUp = 0, halfDown = 0;
    const stripH = rowCount ? 18 + rowCount * (bandH + 6) : 0;
    const gap0 = 34;

    // Place each card in the slot (side, tier, sideways shift) that overlaps nothing and whose stem
    // crosses no other card, preferring to alternate sides near the date.
    const placed: typeof cards = [];
    const overlaps = (a: Rect, b: Rect, pad = 8) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
    const stemHits = (sx: number, y0: number, ex: number, y1: number, b: Rect) => {
      // Sample the stem; any point inside the box (with a little room) is a hit.
      for (let t = 0.02; t <= 0.98; t += 0.04) {
        const x = sx + (ex - sx) * t, y = y0 + (y1 - y0) * t;
        if (x > b.x - 3 && x < b.x + b.w + 3 && y > b.y - 3 && y < b.y + b.h + 3) return true;
      }
      return false;
    };
    const tierY = (up: boolean, tier: number) => (up ? -(halfUp + gap0 + tier * (maxH + 14)) : halfDown + gap0 + tier * (maxH + 14));
    for (const c of cards) {
      let best: { box: Rect; up: boolean; stem: { x: number; y: number }[]; cost: number } | null = null;
      const prevUp = placed.length ? placed[placed.length - 1].up : false;
      for (const up of [!prevUp, prevUp]) for (const tier of [0, 1, 2]) for (const dx of SHIFTS) {
        const cx = clamp(c.x + dx, cardW / 2 + 2, W - cardW / 2 - 2);
        const ty = tierY(up, tier);
        const box = { x: cx - cardW / 2, y: up ? ty - c.h : ty, w: cardW, h: c.h };
        const ex = clamp(c.x, box.x + 14, box.x + box.w - 14);
        const edgeY = up ? box.y + box.h : box.y;
        const axisY = up ? -halfUp : halfDown;
        let cost = tier * 150 + Math.abs(cx - c.x) * 1.4 + (up === prevUp ? 70 : 0);
        // Overlapping another card is worst; a stem through a card or across a stem is next.
        for (const p of placed) {
          if (overlaps(box, p.box)) cost += 100000;
          if (stemHits(c.x, axisY, ex, edgeY, p.box)) cost += 5000;
          if (stemHits(p.stem[0].x, p.stem[0].y, p.stem[1].x, p.stem[1].y, box)) cost += 5000;
          if (p.up === up && segmentsCross({ x: c.x, y: axisY }, { x: ex, y: edgeY }, p.stem[0], p.stem[1])) cost += 3000;
        }
        if (!best || cost < best.cost) best = { box, up, stem: [{ x: c.x, y: axisY }, { x: ex, y: edgeY }], cost };
      }
      Object.assign(c, { box: best!.box, up: best!.up, stem: best!.stem });
      placed.push(c);
    }

    // Shift everything so the top card sits at the top margin.
    const titleH = title ? 34 : 0;
    const top = Math.min(...cards.map((c) => c.box.y), -halfUp - 20);
    const bottom = Math.max(...cards.map((c) => c.box.y + c.box.h), halfDown + 26);
    const oy = 14 + titleH - top;
    const H = Math.ceil(bottom - top + 28 + titleH + stripH);
    const ay = oy; // the axis line's y

    const b = new Board();
    if (title) b.text(W / 2, 14 + 22, title, 20, { fill: "ink" });
    // Axis with ticks at a "nice" step.
    const axisEnd = W - 12;
    b.line([{ x: 8, y: ay }, { x: axisEnd - 10, y: ay }], { stroke: "ink", width: 3, part: "arrow-end" });
    b.arrow({ x: axisEnd - 20, y: ay }, { x: axisEnd, y: ay }, "ink", 3, "arrow-end", 16);
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    const step = steps.find((s) => span / s <= 10) ?? 100000;
    const ticks: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
    if (crowded) ticks.length = 0;
    for (const t of ticks) b.line([{ x: X(t), y: ay - 6 }, { x: X(t), y: ay + 6 }], { stroke: "ink", width: 1.6, opacity: 0.7 });
    // Tick years where no stem, card or period label is in the way (below the axis, small).
    {
      const lower = cards.filter((c) => !c.up).map((c) => c.box);
      for (const t of ticks) {
        const label = fmtYear(t, bceSpan), w = measure(label, 13);
        const box = { x: X(t) - w / 2, y: ay + 9, w, h: 15 };
        const clash = cards.some((c) => Math.abs(c.stem[0].x - X(t)) < w / 2 + 5 && !c.up) || lower.some((l) => overlaps(box, { ...l, y: l.y + oy }, 2));
        if (!clash && box.x > 2 && box.x + w < W - 2) b.text(X(t), ay + 22, label, 13, { fill: "muted" });
      }
    }

    // Periods: a strip of soft bars under the cards, to the axis's scale, named inside; the same span
    // is washed on the axis itself, with end ticks, so each bar reads against the dates.
    const parts: FigurePart[] = [];
    const lowest = Math.max(ay + 14, ...cards.map((c) => c.box.y + c.box.h + oy));
    periods.forEach((p, i) => {
      const id = i ? `period-${i + 1}` : "period";
      const col: Ink = COLOURS[(i + 3) % COLOURS.length];
      const xa = X(p.from), xb = Math.max(X(p.to), xa + 8);
      const y = lowest + 18 + periodRow[i] * (bandH + 6);
      b.line([{ x: xa, y: ay }, { x: xb, y: ay }], { stroke: col, width: 12, opacity: 0.3, part: id });
      for (const x of [xa, xb]) b.line([{ x, y: ay - 9 }, { x, y: ay + 9 }], { stroke: col, width: 2.4, part: id });
      b.card({ x: xa, y, w: xb - xa, h: bandH }, col, id, { r: 6, wash: 0.22, width: 1.6 });
      const room = xb - xa - 12;
      if (room > 24) {
        const sz = measure(p.name, 16) <= room ? 16 : 14;
        const [line] = wrap(p.name, sz, room, 1);
        b.text((xa + xb) / 2, y + bandH / 2 + sz * 0.36, line, sz, { fill: "ink", part: id });
      }
      parts.push({ id, name: partName(p.name, "Period"), anchor: { x: (xa + xb) / 2 < W / 2 ? xa + Math.min(10, (xb - xa) / 2) : xb - Math.min(10, (xb - xa) / 2), y: y + bandH / 2 } });
    });

    // Events: stem, date dot, card.
    cards.forEach((c, k) => {
      const id = `event-${k + 1}`;
      const col: Ink = COLOURS[k % COLOURS.length];
      const box = { ...c.box, y: c.box.y + oy };
      const s0 = { x: c.stem[0].x, y: ay }, s1 = { x: c.stem[1].x, y: c.stem[1].y + oy };
      b.line([s0, s1], { stroke: col, width: 2, part: id });
      b.circle(s0, 5.5, { fill: col, stroke: "ink", width: 1.4, part: id });
      b.card(box, col, id, { r: 9 });
      b.text(box.x + box.w / 2, box.y + 12 + dateSize * 0.82, c.dateLines[0], c.ds, { fill: col, part: id });
      b.lines(c.lines, box.x + box.w / 2, box.y + 12 + dateSize * 1.1 + 3, textSize, { fill: "ink", part: id, lineH });
      // Anchored on the card's outer edge, so a leader reaches it without crossing the card's row.
      parts.push({ id, name: partName(c.e.text || c.e.date, `Event ${k + 1}`), anchor: { x: box.x + box.w / 2, y: c.up ? box.y + 4 : box.y + box.h - 4 } });
    });

    // The later end: an arrowhead, or "Today" at the present year.
    if (today) {
      const tx = X(new Date().getFullYear());
      b.line([{ x: tx, y: ay - 14 }, { x: tx, y: ay + 14 }], { stroke: "#dc2626", width: 3, part: "arrow-end" });
      const free = !cards.some((c) => c.up && c.box.x + c.box.w > tx - 30);
      b.text(Math.min(tx, W - 30), free ? ay - 22 : ay + 32, "Today", 15, { fill: "#dc2626", part: "arrow-end" });
    }
    parts.push({ id: "arrow-end", name: today ? "Today" : "Later (time →)", anchor: { x: axisEnd - 6, y: ay } });
    return { w: W, h: H, shapes: b.shapes, parts };
  },
};
