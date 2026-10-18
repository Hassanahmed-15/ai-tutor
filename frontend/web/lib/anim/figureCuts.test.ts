import { test } from "node:test";
import assert from "node:assert/strict";
import { FIGURE_COMPONENTS } from "../figures/registry";
import { takeFigureCutItems, takeFigureCuts } from "../figures/cuts";
import { placeLabels } from "../figures/labels";
import { circleTheorem } from "../figures/components/circleTheorem";
import { barChart } from "../figures/components/barChart";
import { pieChart } from "../figures/components/pieChart";
import { numberLine } from "../figures/components/numberLine";
import { textBox } from "../figures/components/mathsKit";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";

/**
 * NO TEXT IS CUT (owner, 2026-10-17). Every code-drawn figure is built with each of its parameters set
 * to an over-long phrase: nothing it shows may end in "…", and whatever it shortened must have been
 * recorded, so the board writer rewrites that text to fit before the board ships.
 */

// A long phrase with no list separators (",", ";", "and", "or") and no digits, so every component
// takes it as one name; the marker word shows where it landed.
const MARK = "zephyrine";
const LONG = `${MARK[0].toUpperCase()}${MARK.slice(1)} quixotic marmalade travellers gathered beside ancient riverbanks during midsummer festivals celebrating harvests`;

/** The parameter names a component documents ("titrant (…), analyte (…)", "series1 and series2 (…)"). */
function paramKeys(c: FigureComponent): string[] {
  const keys = new Set<string>();
  for (const m of c.params.matchAll(/(?:^|[;,.]\s*|\bOR\s+|\band\s+)([a-z][A-Za-z0-9]{1,23})(?=\s*(?:\(|,\s*[a-z][A-Za-z0-9]*\s*\(|\s+and\s+[a-z][A-Za-z0-9]*\s*\())/g)) keys.add(m[1]);
  return [...keys];
}

function shown(d: FigureDrawing): string[] {
  return [...d.shapes.flatMap((s) => (s.t === "text" ? [s.text] : [])), ...d.parts.map((p) => p.name)];
}

test("every figure component: no ellipsis, and every shortened text is recorded", () => {
  const problems: string[] = [];
  for (const c of FIGURE_COMPONENTS) {
    for (const t of [...c.parts.map((p) => p.name), c.build({}).parts.map((p) => p.name)].flat()) if (/…|\.\.\./.test(t)) problems.push(`${c.name}: default part name "${t}" has an ellipsis`);
    for (const key of paramKeys(c)) {
      takeFigureCuts();
      takeFigureCutItems();
      let d: FigureDrawing;
      try {
        d = c.build({ [key]: LONG });
      } catch (e) {
        problems.push(`${c.name}.${key}: threw ${(e as Error).message}`);
        continue;
      }
      const recorded = takeFigureCutItems();
      for (const t of shown(d)) {
        if (/…|\.\.\./.test(t)) problems.push(`${c.name}.${key}: "${t}" has an ellipsis`);
        const low = t.toLowerCase();
        if (!low.includes(MARK) || low.includes(LONG.toLowerCase())) continue;
        // Shortened: the cut must be recorded with its room, and it must end on a whole word.
        if (!recorded.some((r) => r.text.toLowerCase().includes(MARK))) problems.push(`${c.name}.${key}: "${t}" was shortened without being recorded`);
        // The longest start of the phrase that is shown must end on a whole word.
        const whole = LONG.toLowerCase();
        let k = whole.length;
        while (k > MARK.length && !low.includes(whole.slice(0, k))) k--;
        if (/[a-z]/.test(whole[k] ?? "") && /[a-z]/.test(whole[k - 1])) problems.push(`${c.name}.${key}: "${t}" ends mid-word`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("margin labels: a second line too long for its margin is fitted and recorded", () => {
  takeFigureCutItems();
  const measure = (t: string, s: number) => t.length * s * 0.55;
  const text = "Partially permeable membrane that lets water molecules through but holds back the larger solute particles completely";
  const placed = placeLabels([{ id: "m", text, anchor: { x: 330, y: 200 }, s: 0 }], { x: 300, y: 100, w: 200, h: 200 }, { x: 0, y: 80, w: 800, h: 300 }, measure, 17);
  const room = placed[0].box.w;
  assert.ok(placed[0].lines.length <= 2);
  for (const l of placed[0].lines) assert.ok(measure(l, placed[0].size) <= 300 - 28 + 0.5, `"${l}" is wider than its margin`);
  assert.ok(room > 0);
  assert.ok(!placed[0].lines.join(" ").includes("…"));
  assert.ok(takeFigureCutItems().some((r) => r.text === text), "the cut label is recorded for the rewrite pass");
});

test("margin labels: a crowded column stays inside the stage", () => {
  const measure = (t: string, s: number) => t.length * s * 0.55;
  const items = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, text: `Part number ${"abcdefgh"[i]} of the figure`, anchor: { x: 540, y: 300 + i * 4 }, s: 0 }));
  const area = { x: 0, y: 100, w: 900, h: 160 };
  const placed = placeLabels(items, { x: 300, y: 120, w: 260, h: 220 }, area, measure, 17);
  assert.equal(placed.length, 8);
  for (const l of placed) {
    assert.ok(l.box.y >= area.y - 20 - 0.5, `${l.id} rose above the stage (${l.box.y})`);
    assert.ok(l.box.y + l.box.h <= area.y + area.h + 0.5, `${l.id} fell below the stage`);
  }
  const col = placed.filter((l) => l.side === "right").sort((a, b) => a.box.y - b.box.y);
  for (let i = 1; i < col.length; i++) assert.ok(col[i].box.y >= col[i - 1].box.y + col[i - 1].box.h - 0.5, "labels in a column never overlap");
});

test("composite labels fit the board's own words, recorded whole", () => {
  for (const [c, params] of [
    [barChart, { categories: "Travelling by public transport buses, Car", values: "18, 9" }],
    [pieChart, { categories: "Travelling by public transport buses, Car", values: "18, 9" }],
  ] as const) {
    takeFigureCutItems();
    const d = c.build(params);
    const items = takeFigureCutItems();
    for (const p of d.parts) {
      assert.ok(p.name.length <= 34, `${c.name} ${p.id}: "${p.name}" is over 34 characters`);
      assert.ok(!p.name.includes("…"));
    }
    const named = d.parts.find((p) => p.id === "tallest" || p.id === "largest")!;
    assert.match(named.name, /\(\d+(\.\d+)?%?\)$/, `${c.name}: the value stays whole ("${named.name}")`);
    assert.ok(items.some((i) => i.text === "Travelling by public transport buses"), `${c.name}: the category is recorded whole`);
  }
});

test("number line: a long run of integers is summarised, never ended with an ellipsis", () => {
  const d = numberLine.build({ inequality: "-9 < x <= 9", integers: true });
  const ints = d.parts.find((p) => p.id === "integers");
  if (ints) {
    assert.ok(!ints.name.includes("…"), ints.name);
    assert.ok(ints.name.length <= 34, ints.name);
  }
});

test("circle theorems: a length written on a segment never overprints its equal-length tick marks", () => {
  const cases: FigureParams[] = [
    { theorem: "chord-bisector", chord: 14, radius: 9, units: "cm" },
    { theorem: "equal-chords", chord: 10, distance: 4, units: "cm" },
    { theorem: "tangents-from-point", radius: 8, op: 17, units: "cm" },
  ];
  for (const params of cases) {
    const d = circleTheorem.build(params);
    const ticks = d.shapes.flatMap((s) => {
      if (s.t !== "path" || s.width !== 2 || s.part) return [];
      const m = /^M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)$/.exec(s.d);
      return m && Math.hypot(+m[3] - +m[1], +m[4] - +m[2]) < 15 ? [[{ x: +m[1], y: +m[2] }, { x: +m[3], y: +m[4] }]] : [];
    });
    assert.ok(ticks.length >= 2, `${params.theorem}: tick marks drawn`);
    for (const t of d.shapes) {
      if (t.t !== "text" || !/\d/.test(t.text)) continue;
      const b = textBox({ x: t.x, y: t.y - t.size * 0.36 }, t.text, t.size);
      for (const [p, q] of ticks) for (let k = 0; k <= 10; k++) {
        const x = p.x + ((q.x - p.x) * k) / 10, y = p.y + ((q.y - p.y) * k) / 10;
        assert.ok(!(x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h), `${params.theorem}: "${t.text}" sits on a tick mark`);
      }
    }
  }
});
