import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams, FigureShape } from "../figures/types";
import { timeline, timelineData, parseYear, parseRange } from "../figures/components/timeline";
import { causeConsequence, parseLinks } from "../figures/components/causeConsequence";
import { sourceCard, sourceType, reliabilityScore } from "../figures/components/sourceCard";
import { evaluationScale, parseArgument, judgementPosition, tiltFor } from "../figures/components/evaluationScale";
import { conceptTable, tableData, layoutTable, highlightCell } from "../figures/components/conceptTable";
import { measure, wrap } from "../figures/components/humanitiesKit";

const COMPONENTS: FigureComponent[] = [timeline, causeConsequence, sourceCard, evaluationScale, conceptTable];

function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string) {
  const declared = c.parts.map((p) => p.id);
  const built = d.parts.map((p) => p.id);
  for (const id of built) assert.ok(declared.includes(id), `${label}: ${id} is declared`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  for (const p of d.parts) {
    assert.ok(Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y), `${label}: ${p.id} anchor finite`);
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits a label (${p.name})`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "text") {
      assert.ok(s.size >= 13, `${label}: "${s.text}" font ${s.size} ≥ 13`);
      const w = measure(s.text, s.size), x = s.anchor === "middle" ? s.x - w / 2 : s.anchor === "end" ? s.x - w : s.x;
      assert.ok(x >= -1 && x + w <= d.w + 1 && s.y - s.size >= -1 && s.y <= d.h + 1, `${label}: text "${s.text}" inside the figure`);
    }
    if (s.t === "path") assert.ok(!/NaN|Infinity/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
  }
  assert.ok(d.w > 100 && d.h > 100 && d.w < 1200 && d.h < 1200, `${label}: sensible size ${d.w}×${d.h}`);
}

test("every humanities component's default drawing builds ≥2 declared parts, anchors inside", () => {
  for (const c of COMPONENTS) {
    const d = c.build({});
    checkDrawing(c, d, c.name);
    assert.ok(d.parts.length >= 2, `${c.name}: at least two parts`);
  }
});

test("odd or hostile params never throw and still draw", () => {
  const long = "word ".repeat(120);
  const junk: FigureParams[] = [
    { events: "nonsense; ; ;", periods: "abc", today: "maybe" },
    { events: long, causes: long, consequences: long, longTerm: long, links: "c9>k9; zz" },
    { claim: "", for: "(9) x; [0]", against: 7, position: "NaN" },
    { columns: "a", rows: "|||;|||||||;" + long, highlight: "r9c9" },
    { type: 42, quote: long, strengths: ";;", limitations: long, reliability: 400 },
    { events: "Supercalifragilisticexpialidociousword: Antidisestablishmentarianismword", columns: "Antidisestablishmentarianismword,b", rows: "Pneumonoultramicroscopicsilicovolcanoconiosis|x" },
  ];
  for (const c of COMPONENTS) for (const p of junk) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p).slice(0, 60)}`);
});

/* ── timeline ─────────────────────────────────────────────────────────────────────────────── */

test("timeline: dates parse with BCE/CE, months and ranges", () => {
  assert.equal(parseYear("44 BCE"), -44);
  assert.equal(parseYear("44 BC"), -44);
  assert.equal(parseYear("AD 43"), 43);
  assert.equal(parseYear("c. 500 BCE"), -500);
  assert.ok(Math.abs(parseYear("14 July 1789")! - (1789 + 6.5 / 12)) < 1e-9);
  assert.equal(parseYear("1940s"), 1945);
  assert.equal(parseYear("no date"), null);
  assert.deepEqual(parseRange("1789-1799"), [1789, 1799]);
  assert.deepEqual(parseRange("500–300 BCE"), [-500, -300]);
  assert.deepEqual(parseRange("1914 to 1918"), [1914, 1918]);
});

const dots = (d: FigureDrawing, id: string) => d.shapes.filter((s): s is Extract<FigureShape, { t: "circle" }> => s.t === "circle" && s.part === id);

test("timeline: events in date order, spaced in proportion to their dates", () => {
  const params = { events: "1799: Napoleon takes power; 1789: Bastille stormed; 1793: Terror begins; 1815: Waterloo; 1804: Emperor" };
  const { events } = timelineData(params);
  assert.deepEqual(events.map((e) => Math.floor(e.year)), [1789, 1793, 1799, 1804, 1815]);
  const d = timeline.build(params);
  const xs = events.map((_, k) => dots(d, `event-${k + 1}`)[0].cx);
  for (let k = 1; k < xs.length; k++) assert.ok(xs[k] > xs[k - 1], "dots left to right in date order");
  const ys = events.map((e) => e.year);
  for (let k = 1; k < xs.length - 1; k++) {
    const want = (ys[k] - ys[0]) / (ys[ys.length - 1] - ys[0]), got = (xs[k] - xs[0]) / (xs[xs.length - 1] - xs[0]);
    assert.ok(Math.abs(want - got) < 0.01, `event ${k + 1} at ${got.toFixed(3)} of the axis, expected ${want.toFixed(3)}`);
  }
});

test("timeline: BCE to CE scale, periods and Today", () => {
  const d = timeline.build({ events: "753 BCE: Rome founded; 44 BCE: Caesar killed; AD 476: Fall of the West", periods: "509-27 BCE: Republic", today: true });
  const xs = [1, 2, 3].map((k) => dots(d, `event-${k}`)[0].cx);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2]);
  assert.ok(d.parts.some((p) => p.id === "period") && d.parts.some((p) => p.id === "arrow-end" && p.name === "Today"));
  // Ten clustered events: no two cards overlap.
  const many = timeline.build({ events: Array.from({ length: 10 }, (_, i) => `${1914 + (i % 4) / 4 + Math.floor(i / 4)}: Event number ${i + 1} happens`).join("; ") });
  checkDrawing(timeline, many, "ten events");
  const cards = many.shapes.filter((s): s is Extract<FigureShape, { t: "path" }> => s.t === "path" && /^event-/.test(s.part ?? "") && s.stroke === "none" && /A/.test(s.d));
  // A rounded rect's path: M x+r y H x+w-r A r r 0 0 1 x+w y+r V y+h-r …
  const boxes = cards.map((s) => { const n = s.d.match(/-?\d+(\.\d+)?/g)!.map(Number); return { x0: n[0] - n[3], x1: n[8], y0: n[1], y1: n[9] + n[3] }; });
  assert.equal(boxes.length, 10);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1), `cards ${i + 1} and ${j + 1} overlap`);
  }
});

/* ── cause and consequence ────────────────────────────────────────────────────────────────── */

test("causeConsequence: columns, long-term split, links", () => {
  assert.deepEqual(parseLinks("c1>k2; k1->l1, bad"), [{ from: "c1", to: "k2" }, { from: "k1", to: "l1" }]);
  const d = causeConsequence.build({ event: "WW1", causes: "Militarism; Alliances; Imperialism; Nationalism; Assassination", consequences: "Deaths; Empires fall", longTerm: "Versailles; Fascism", trigger: 5, links: "c2>k2" });
  checkDrawing(causeConsequence, d, "ww1");
  const ids = d.parts.map((p) => p.id);
  for (const id of ["event", "causes", "consequences", "long-term", "cause-1", "cause-5", "consequence-2"]) assert.ok(ids.includes(id), id);
  const anchor = (id: string) => d.parts.find((p) => p.id === id)!.anchor;
  assert.ok(anchor("cause-1").x < anchor("event").x && anchor("event").x < anchor("consequence-1").x, "causes left, event centre, consequences right");
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "TRIGGER"));
  assert.ok(d.shapes.some((s) => s.t === "path" && s.dash), "a dashed link is drawn");
});

/* ── source card ──────────────────────────────────────────────────────────────────────────── */

test("sourceCard: type, reliability and fields", () => {
  assert.equal(sourceType("Political cartoon"), "cartoon");
  assert.equal(sourceType("census statistics"), "statistics");
  assert.equal(sourceType("Government report"), "official document");
  assert.equal(reliabilityScore("low", 0, 0), 25);
  assert.equal(reliabilityScore(80, 0, 0), 80);
  assert.ok(reliabilityScore(undefined, 2, 0) > reliabilityScore(undefined, 0, 2));
  const d = sourceCard.build({ type: "speech", author: "Herbert Spencer", date: "1864", purpose: "To explain his theory", audience: "Readers of his books", summary: "Applies 'survival of the fittest' to society", strengths: "By the theory's author", limitations: "Opinion, not evidence", reliability: "medium" });
  checkDrawing(sourceCard, d, "spencer");
  for (const id of ["provenance", "content", "purpose", "reliability", "limitation"]) assert.ok(d.parts.some((p) => p.id === id), id);
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "SPEECH"));
});

/* ── evaluation scale ─────────────────────────────────────────────────────────────────────── */

function beamEnds(d: FigureDrawing) {
  const beam = d.shapes.find((s): s is Extract<FigureShape, { t: "path" }> => s.t === "path" && s.part === "pivot" && s.width === 6)!;
  const n = beam.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return { left: { x: n[0], y: n[1] }, right: { x: n[2], y: n[3] } };
}

test("evaluationScale: tips toward the heavier side", () => {
  assert.deepEqual(parseArgument("Harsh reparations (3)"), { text: "Harsh reparations", weight: 3 });
  assert.deepEqual(parseArgument("[1] Lost land"), { text: "Lost land", weight: 1 });
  assert.equal(parseArgument("Plain").weight, 2);
  const heavyFor = evaluationScale.build({ claim: "Fair?", for: "A (3); B (3)", against: "C (1)" });
  const heavyAgainst = evaluationScale.build({ claim: "Fair?", for: "A (1)", against: "C (3); D (2)" });
  const level = evaluationScale.build({ claim: "Fair?", for: "A (2)", against: "C (2)" });
  checkDrawing(evaluationScale, heavyFor, "heavy for");
  const f = beamEnds(heavyFor), a = beamEnds(heavyAgainst), l = beamEnds(level);
  assert.ok(f.left.y > f.right.y + 10, "FOR side (left) is lower when for is heavier");
  assert.ok(a.right.y > a.left.y + 10, "AGAINST side (right) is lower when against is heavier");
  assert.ok(Math.abs(l.left.y - l.right.y) < 0.5, "level when balanced");
  // The board's own judgement overrides the weights.
  assert.equal(judgementPosition({ position: 20 }, [{ text: "a", weight: 3 }], [{ text: "b", weight: 1 }]), 20);
  const judged = beamEnds(evaluationScale.build({ for: "A (3)", against: "B (1)", position: 20 }));
  assert.ok(judged.right.y > judged.left.y, "position 20 tips against");
  assert.ok(tiltFor(100) === 15 && tiltFor(0) === -15 && tiltFor(50) === 0);
});

/* ── concept table ────────────────────────────────────────────────────────────────────────── */

test("conceptTable: every cell's text wraps inside its column", () => {
  const params = {
    columns: "Theory,Key thinker,View of society,Strength,Criticism",
    row1: "Functionalism|Durkheim|Parts work together like organs of a body to keep society stable|Explains social order|Ignores conflict and inequality",
    row2: "Marxism|Marx|Society is shaped by class conflict between bourgeoisie and proletariat|Explains inequality|Overemphasises economics",
    row3: "Feminism|Oakley, Walby|Society is patriarchal|Reveals gender inequality|Can overlook class and ethnicity",
    highlight: "Marx",
  };
  const data = tableData(params);
  assert.equal(data.rows.length, 3);
  assert.deepEqual(highlightCell("Marx", data), [2, 2], "exact cell match beats a substring");
  assert.deepEqual(highlightCell("r1c3", data), [1, 3]);
  const lay = layoutTable(data);
  lay.cells.forEach((row) => row.forEach((lines, c) => lines.forEach((ln) => assert.ok(measure(ln, lay.size) <= lay.colW[c] - 2 * lay.pad, `"${ln}" fits column ${c + 1}`))));
  const d = conceptTable.build(params);
  checkDrawing(conceptTable, d, "theories");
  // In the drawing: each left-aligned text ends before its column's right rule.
  const xs = [lay.x0];
  for (const w of lay.colW) xs.push(xs[xs.length - 1] + w);
  for (const s of d.shapes) if (s.t === "text") {
    const c = xs.findIndex((x, i) => i < xs.length - 1 && s.x >= x && s.x < xs[i + 1]);
    assert.ok(c >= 0, `"${s.text}" is in a column`);
    assert.ok(s.x + measure(s.text, s.size) <= xs[c + 1] - 2, `"${s.text}" stays inside column ${c + 1}`);
  }
  for (const id of ["header", "first-column", "highlight", "col-1", "col-5"]) assert.ok(d.parts.some((p) => p.id === id), id);
  // wrap never returns a line wider than asked (long words are broken).
  for (const ln of wrap("Pneumonoultramicroscopicsilicovolcanoconiosis is long", 16, 120)) assert.ok(measure(ln, 16) <= 120, ln);
});

/* ── matching ─────────────────────────────────────────────────────────────────────────────── */

test("match: each component's words, and not its neighbours'", () => {
  const cases: Array<[FigureComponent, string[], string[]]> = [
    [timeline, ["A timeline of the French Revolution", "the chronology of the Cold War", "Put these key dates in order"], ["Time dilation in special relativity", "the timer circuit", "cause and effect of the war"]],
    [causeConsequence, ["Causes and consequences of the First World War", "the long-term causes of the Russian Revolution", "Why did the Roman Empire collapse"], ["The causes of tides on Earth?", "the effect of temperature on rate", "A timeline of events"]],
    [sourceCard, ["How useful is Source A to a historian?", "Evaluate the provenance of this cartoon", "primary sources about the Blitz", "the reliability of the diary"], ["a source of energy", "light source and lens", "open source software"]],
    [evaluationScale, ["How far do you agree that the treaty was fair?", "Was the Treaty of Versailles fair?", "To what extent was Stalin a successful leader", "arguments for and against nuclear power"], ["How far does the ball travel?", "the balance of a chemical equation", "the extent of the reaction"]],
    [conceptTable, ["Make a comparison table of sociological theories", "local, national and global perspectives", "summarise them in a table"], ["the periodic table of elements", "a times table", "table salt dissolves"]],
  ];
  for (const [c, yes, no] of cases) {
    for (const s of yes) assert.ok(c.match.test(s), `${c.name} should match "${s}"`);
    for (const s of no) assert.ok(!c.match.test(s), `${c.name} should not match "${s}"`);
  }
});
