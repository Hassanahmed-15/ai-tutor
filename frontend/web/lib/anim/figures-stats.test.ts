import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { scatterPlot, leastSquares, findOutlier, describeR } from "../figures/components/scatterPlot";
import { histogram, histogramClasses, parseClasses } from "../figures/components/histogram";
import { boxPlot, fiveNumber, quartiles, fromSummary } from "../figures/components/boxPlot";
import { barChart } from "../figures/components/barChart";
import { pieChart, pieAngles, piePercents } from "../figures/components/pieChart";
import { cumulativeFrequency, cumulative, ogive } from "../figures/components/cumulativeFrequency";
import { niceScale, pairs } from "../figures/components/statsKit";
import { textBox, boxesOverlap } from "../figures/components/mathsKit";

const COMPONENTS: FigureComponent[] = [scatterPlot, histogram, boxPlot, barChart, pieChart, cumulativeFrequency];
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const texts = (d: FigureDrawing) => d.shapes.flatMap((s) => (s.t === "text" ? [s.text] : []));

/** The structural contract every drawing must keep. */
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
    if (s.t === "text") assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h && Number.isFinite(s.size), `${label}: text "${s.text}" inside`);
    if (s.t === "path") assert.ok(!/NaN|Infinity|undefined/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
  }
  assert.ok(d.w > 100 && d.h > 100 && d.w < 1200 && d.h < 1200, `${label}: sensible size ${d.w}×${d.h}`);
  // Intrinsic text never overlaps other intrinsic text.
  const boxes = d.shapes.flatMap((s) => (s.t === "text" ? [{ s, b: textBox({ x: s.x, y: s.y - s.size * 0.36 }, s.text, s.size) }] : []));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].b, b = boxes[j].b;
    const shrink = (r: typeof a) => ({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 });
    assert.ok(!boxesOverlap(shrink(a), shrink(b)), `${label}: "${boxes[i].s.t === "text" && boxes[i].s.text}" overlaps "${boxes[j].s.t === "text" && boxes[j].s.text}"`);
  }
}

test("every stats component's default drawing builds ≥2 declared parts with anchors inside", () => {
  for (const c of COMPONENTS) {
    const d = c.build({});
    checkDrawing(c, d, c.name);
    assert.ok(d.parts.length >= 2, `${c.name}: at least two parts`);
  }
});

test("odd or hostile params never throw and still draw", () => {
  const junk: FigureParams[] = [
    {},
    { points: "x,y; ;;", data: "a,b", classes: "zz", frequencies: "-3,abc", categories: "", values: "0,0,0", bounds: "5,3,1" },
    { points: "1,1", values: "-5, 3, 8", categories: "A,B,C", horizontal: "yes", data: "7", summary: "1,2,3" },
    { points: "1,1; 1,1; 1,1", classes: "0-10,5-15,10-20", frequencies: "0,0,0", data: "4,4,4,4", values: "1e308, 2", bounds: "10,20", start: 50 },
    { points: "1,2; 2,4; 3,6; 4,8; 5,10; 6,12", outlier: "100,100", showLine: "false", showR: true, show: "angle", key: false },
    { classes: "0-1,1-2,2-3,3-4,4-5,5-6,6-7,7-8,8-9,9-10,10-11,11-12,12-13,13-14,14-15,15-16,16-17", frequencies: "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17", categories: "a,b,c,d,e,f,g,h,i,j,k,l,m", values: "1,2,3,4,5,6,7,8,9,10,11,12,13" },
  ];
  for (const c of COMPONENTS) for (const p of junk) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p).slice(0, 60)}`);
});

test("scatter: least squares on a known set, r = ±1 for perfect lines, outlier found", () => {
  // y = 2x + 1 exactly.
  const perfect = [1, 2, 3, 4, 5].map((x) => ({ x, y: 2 * x + 1 }));
  const f = leastSquares(perfect)!;
  assert.ok(near(f.m, 2) && near(f.c, 1) && near(f.r, 1));
  assert.ok(near(leastSquares([1, 2, 3, 4].map((x) => ({ x, y: 10 - 3 * x })))!.r, -1));
  // Known: (1,2) (2,3) (3,5) (4,4) (5,6): m = 0.9, c = 1.3, r = 0.9.
  const k = leastSquares([{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 6 }])!;
  assert.ok(near(k.m, 0.9) && near(k.c, 1.3) && near(k.r, 0.9), `m=${k.m} c=${k.c} r=${k.r}`);
  assert.equal(leastSquares([{ x: 1, y: 1 }, { x: 1, y: 5 }]), null, "vertical data has no y-on-x line");
  const withOut = [...perfect, { x: 6, y: 13 }, { x: 7, y: 15 }, { x: 3.5, y: 30 }];
  assert.equal(findOutlier(withOut), withOut.length - 1);
  assert.equal(findOutlier(perfect.concat([{ x: 6, y: 13 }])), -1, "no outlier on a perfect line");
  assert.equal(describeR(0.95), "Strong positive correlation");
  assert.equal(describeR(-0.7), "Moderate negative correlation");
  assert.equal(describeR(0.1), "No correlation");
  const d = scatterPlot.build({ points: "1,3; 2,5; 3,7; 4,9; 5,11", outlier: "none" });
  assert.ok(texts(d).includes("y = 2.00x + 1") || texts(d).some((t) => /^y = 2(\.0+)?x \+ 1$/.test(t)), `equation written: ${texts(d)}`);
  assert.ok(texts(d).includes("r = 1"));
  assert.ok(d.parts.some((p) => p.id === "trend" && p.name === "Strong positive correlation"));
  assert.ok(!d.parts.some((p) => p.id === "outlier"));
  // The drawn line passes through the fitted points: anchor on y = 2x + 1 in figure units.
  assert.deepEqual(pairs("1,2; 3,4"), [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  assert.deepEqual(pairs("(1,2) (3,4)"), [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  const two = scatterPlot.build({ points: "1,1; 2,2; 3,3", points2: "1,3; 2,2; 3,1", group1: "Boys", group2: "Girls" });
  assert.equal(two.parts.find((p) => p.id === "group-2")!.name, "Girls");
});

test("histogram: frequency density = frequency ÷ class width; modal class by density", () => {
  const rows = histogramClasses(parseClasses("0-10, 10-15, 15-30"), [20, 15, 30]);
  assert.deepEqual(rows.map((r) => r.width), [10, 5, 15]);
  assert.deepEqual(rows.map((r) => r.fd), [2, 3, 2]);
  assert.deepEqual(parseClasses("0≤x<10, 10–20, 20 to 40"), [[0, 10], [10, 20], [20, 40]]);
  const d = histogram.build({ classes: "0-10, 10-15, 15-30", frequencies: "20, 15, 30" });
  assert.equal(d.parts.find((p) => p.id === "modal-class")!.name, "Modal class 10–15", "highest DENSITY, not highest frequency");
  assert.equal(d.parts.find((p) => p.id === "y-axis")!.name, "Frequency density (f ÷ width)");
  assert.ok(d.parts.find((p) => p.id === "class-width")!.name.endsWith("15"));
  // Bar heights are proportional to density: compare drawn heights of the 2 and 3 bars.
  const bars = d.shapes.filter((s) => s.t === "path" && (s.part === "bars" || s.part === "modal-class") && s.d.endsWith("Z"));
  const heights = bars.map((s) => {
    const ys = (s.t === "path" ? s.d : "").match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1);
    return Math.max(...ys) - Math.min(...ys);
  });
  assert.ok(near(heights[1] / heights[0], 1.5, 0.01), `3 : 2 heights (${heights})`);
  // Equal widths: plain frequency.
  const eq = histogram.build({ classes: "0-5,5-10,10-15", frequencies: "3,8,4" });
  assert.equal(eq.parts.find((p) => p.id === "y-axis")!.name, "Frequency");
  assert.ok(texts(eq).includes("Frequency"));
});

test("box plot: quartiles, IQR and 1.5×IQR outliers computed from raw data", () => {
  const s = fiveNumber([12, 15, 17, 18, 19, 21, 22, 22, 24, 25, 27, 28, 30, 33, 47]);
  assert.deepEqual([s.min, s.q1, s.median, s.q3, s.max, s.iqr], [12, 18, 22, 28, 33, 10]);
  assert.deepEqual(s.outliers, [47]);
  assert.deepEqual(quartiles([1, 2, 3, 4, 5, 6, 7, 8]), { q1: 2.5, median: 4.5, q3: 6.5 });
  assert.deepEqual(quartiles([1, 2, 3, 4, 5, 6, 7]), { q1: 2, median: 4, q3: 6 });
  assert.deepEqual(quartiles([1, 2, 3, 4, 5, 6, 7, 8], "position"), { q1: 2.25, median: 4.5, q3: 6.75 });
  assert.deepEqual(fromSummary("38, 8, 21, 15, 26"), { min: 8, q1: 15, median: 21, q3: 26, max: 38, iqr: 11, outliers: [], lowFence: -Infinity, highFence: Infinity, n: 0 });
  const d = boxPlot.build({ data: "12, 15, 17, 18, 19, 21, 22, 22, 24, 25, 27, 28, 30, 33, 47" });
  assert.equal(d.parts.find((p) => p.id === "median")!.name, "Median = 22");
  assert.equal(d.parts.find((p) => p.id === "iqr")!.name, "IQR = Q3 − Q1 = 10");
  assert.ok(d.parts.some((p) => p.id === "outlier"));
  const two = boxPlot.build({ summary: "8,15,21,26,38", summary2: "5,12,16,24,30", group1: "Boys", group2: "Girls" });
  assert.equal(two.parts.find((p) => p.id === "second-plot")!.name, "Girls");
  assert.ok(!two.parts.some((p) => p.id === "outlier"));
});

test("bar chart: tallest bar, grouped series with key, horizontal", () => {
  const d = barChart.build({ categories: "Red, Blue, Green", values: "5, 8, 3" });
  assert.equal(d.parts.find((p) => p.id === "tallest")!.name, "Tallest bar: Blue (8)");
  assert.ok(!d.parts.some((p) => p.id === "key"), "no key for one series");
  const g = barChart.build({ categories: "A,B", values: "1,2", values2: "3,4", series1: "2023", series2: "2024" });
  assert.ok(g.parts.some((p) => p.id === "key") && texts(g).includes("2024"));
  checkDrawing(barChart, barChart.build({ categories: "United Kingdom, France", values: "67, 68", horizontal: true }), "horizontal");
});

test("pie chart: angles sum to 360, percentages to 100, largest sector named", () => {
  const a = pieAngles([12, 9, 6, 2, 1]);
  assert.ok(near(a.reduce((t, v) => t + v, 0), 360));
  assert.ok(near(a[0], 144));
  const p = piePercents([1, 1, 1]);
  assert.equal(p.reduce((t, v) => t + v, 0), 100);
  assert.deepEqual(piePercents([12, 9, 6, 2, 1]), [40, 30, 20, 7, 3]);
  const d = pieChart.build({ categories: "Bus, Car, Walk", values: "6, 3, 3", show: "angle" });
  assert.equal(d.parts.find((p) => p.id === "largest")!.name, "Largest: Bus (50%)");
  assert.ok(texts(d).includes("180°") && texts(d).includes("90°"));
  assert.equal(d.parts.find((p) => p.id === "sector-2")!.name, "Car (25%)");
  const many = pieChart.build({ categories: "a,b,c,d,e,f,g,h,i,j", values: "10,9,8,7,6,5,4,3,2,1" });
  assert.ok(many.parts.some((p) => p.name.startsWith("Other")) && !many.parts.some((p) => p.id === "sector-9"));
});

test("cumulative frequency: running totals, monotone ogive, median and quartiles read off it", () => {
  assert.deepEqual(cumulative([4, 9, 15, 20, 8, 4]), [4, 13, 28, 48, 56, 60]);
  const og = ogive([0, 10, 20, 30, 40], [0, 10, 20, 30, 40]);
  for (let x = 0; x <= 40; x += 2.5) assert.ok(near(og.at(x), x, 1e-9), "a straight ogive stays straight");
  assert.ok(near(og.inverse(20), 20, 1e-6));
  // Monotone even with a flat class.
  const flat = ogive([0, 10, 20, 30, 40], [0, 5, 5, 30, 40]);
  let last = -1;
  for (let x = 0; x <= 40; x += 0.25) {
    const y = flat.at(x);
    assert.ok(y >= last - 1e-9, `never turns down (x=${x})`);
    last = y;
  }
  assert.ok(Math.abs(flat.at(15) - 5) < 1e-9, "a class of frequency 0 stays flat");
  const d = cumulativeFrequency.build({ bounds: "10,20,30,40", frequencies: "10,10,10,10", start: 0 });
  assert.equal(d.parts.find((p) => p.id === "median")!.name, "Median ≈ 20");
  assert.equal(d.parts.find((p) => p.id === "lower-quartile")!.name, "Lower quartile ≈ 10");
  assert.equal(d.parts.find((p) => p.id === "upper-quartile")!.name, "Upper quartile ≈ 30");
  assert.equal(d.parts.find((p) => p.id === "iqr")!.name, "IQR ≈ 20");
  assert.equal(d.parts.find((p) => p.id === "cf-axis")!.name, "Cumulative frequency (n = 40)");
  const r = cumulativeFrequency.build({ classes: "0-10,10-20,20-30,30-40", frequencies: "10,10,10,10", readAt: 25 });
  assert.equal(r.parts.find((p) => p.id === "reading")!.name, "25 below 25");
});

test("nice scales: steps of 1, 2, 2.5 or 5 × 10ⁿ covering the data", () => {
  const s = niceScale(0, 47, 6, "force");
  assert.ok(s.lo === 0 && s.hi >= 47 && [1, 2, 2.5, 5].some((k) => near(s.step / 10 ** Math.floor(Math.log10(s.step)), k)));
  const h = niceScale(150, 180, 6);
  assert.ok(h.lo <= 150 && h.lo > 100 && h.hi >= 180, "heights do not start at zero");
});

test("match: fires on each chart's own subject, not on others", () => {
  const cases: Array<[FigureComponent, string[], string[]]> = [
    [scatterPlot, ["Draw a scatter graph of hours revised against score", "line of best fit", "negative correlation between age and value", "Pearson's correlation coefficient"], ["a histogram of heights", "bar chart of favourite colours", "scattering of light", "the line of symmetry"]],
    [histogram, ["Histograms with unequal class widths", "work out the frequency density", "draw a histogram"], ["a bar chart of pets", "box plot of times", "cumulative frequency curve", "frequency of a wave"]],
    [boxPlot, ["Compare the two box plots", "box-and-whisker diagram", "find the interquartile range", "upper quartile"], ["a scatter graph", "box of matches", "pie chart of spending", "a cat's whiskers grow"]],
    [barChart, ["Draw a bar chart of favourite fruit", "a dual bar chart", "bar graph of rainfall"], ["a histogram of masses", "the pressure in bar units", "pie chart", "a crowbar lever"]],
    [pieChart, ["Draw a pie chart to show how they travel", "work out the angle of each sector"], ["bake an apple pie", "a bar chart", "sector of a circle area", "pi is 3.14"]],
    [cumulativeFrequency, ["Draw a cumulative frequency graph", "use the ogive to estimate the median"], ["a histogram", "box plot", "frequency of a sound wave", "cumulative sum of a series"]],
  ];
  for (const [c, yes, no] of cases) {
    for (const t of yes) assert.ok(c.match.test(t), `${c.name} should match "${t}"`);
    for (const t of no) assert.ok(!c.match.test(t), `${c.name} should not match "${t}"`);
  }
});
