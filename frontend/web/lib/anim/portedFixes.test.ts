import test from "node:test";
import assert from "node:assert/strict";

import { escapeStrayLessThan } from "../jsxRepair";
import { boxFor, wrapLabel, fittedFontSize, measureLabel, NODE_FONT } from "../structureLayout";
import { findAssets, loadAssets } from "../assetCatalogue";
import { manimCacheKey as rawCacheKey } from "../manimCacheKey";

const manimCacheKey = (script: unknown, quality: "low" | "medium" | "high") => rawCacheKey(script, quality, "v1");

/**
 * Regressions for the animation fixes ported from anim-lab.
 *
 * Each of these was a real defect measured in the lab and found still live here by diffing the two
 * repositories. They are pinned because every one of them fails SILENTLY — a blank board, a label
 * outside its box, the wrong video, a perfect-looking score from a critic that never ran. Nothing
 * in the product complained about any of them.
 */

/* ── A bare `<` in JSX text ───────────────────────────────────────────────── */

test("the stray < Babel points at is escaped, and a real comparison is left alone", () => {
  const code = [
    "function Animation({ progress }) {",
    "  const visible = progress < 0.5;",
    "  return <text>Left < Root</text>;",
    "}",
  ].join("\n");

  // Babel reports the token it could not accept, at or just after the stray `<`.
  const out = escapeStrayLessThan(code, { line: 3, column: 22 });
  assert.ok(out);
  assert.ok(out.includes("Left &lt; Root"), "the JSX text `<` is escaped");
  assert.ok(
    out.includes("progress < 0.5"),
    "the JS comparison is untouched — a blanket regex would break working code, which is why this is position-guided",
  );
});

test("a parse error with no < before it is not 'repaired' into something else", () => {
  const code = "function Animation() { return ( }";
  assert.equal(escapeStrayLessThan(code, { line: 1, column: 31 }), null);
  assert.equal(escapeStrayLessThan(code, { line: 99, column: 0 }), null, "an out-of-range line is not a crash");
});

/* ── Structure labels must sit inside their boxes ─────────────────────────── */

test("a long label gets a box wide enough for its measured text", () => {
  // The exact label that overflowed on screen. The old code estimated ~294px, clamped the box to
  // 230, and drew the text at a fixed 20px — guaranteed overflow.
  const box = boxFor("Right Left Grandchild");
  const widest = Math.max(...box.lines.map((line) => measureLabel(line, NODE_FONT)));
  assert.ok(box.width >= widest, `box ${box.width} must hold text ${widest}`);
});

test("a label too wide for one line wraps, and never past two lines", () => {
  const lines = wrapLabel("Sedimentary rock formation stage", NODE_FONT);
  assert.ok(lines.length > 1 && lines.length <= 2);
  assert.equal(lines.join(" "), "Sedimentary rock formation stage", "no words are lost");
});

test("the fitted font shrinks with the box, which is the failure the constant caused", () => {
  const box = boxFor("Right Left Grandchild");
  const widestAt = (size: number) => Math.max(...box.lines.map((line) => measureLabel(line, size)));

  const full = fittedFontSize(box.lines, box.width, box.height, 1);
  assert.ok(widestAt(full) <= box.width, "fits at scale 1");

  // A layout scaled to half: layoutStructure shrinks every box to fit the frame, and the board
  // went on drawing the label at 20px regardless.
  const small = fittedFontSize(box.lines, box.width * 0.5, box.height * 0.5, 0.5);
  assert.ok(small < full, "type scales with the box");
  assert.ok(widestAt(small) <= box.width * 0.5, "and the result still fits");
});

/* ── The Manim cache key ──────────────────────────────────────────────────── */

test("two scenes with equal captions but different ops get different cache keys", () => {
  // `JSON.stringify(script, Object.keys(script).sort())` looks like a key sort and is actually a
  // replacer ALLOW-LIST applied at every depth: with top-level keys caption/durationMs/ops,
  // nothing inside an op matched, every op serialised to {}, and these two collided — so the
  // second beat was served the first one's video.
  const a = { caption: "", durationMs: 11000, ops: [{ kind: "graph", fn: "linear", a: 1 }] };
  const b = { caption: "", durationMs: 11000, ops: [{ kind: "graph", fn: "quadratic", a: 9 }] };
  assert.notEqual(manimCacheKey(a, "low"), manimCacheKey(b, "low"));
});

test("key order does not change the cache key", () => {
  const a = { caption: "x", durationMs: 11000, ops: [{ kind: "graph", a: 1, fn: "linear" }] };
  const b = { durationMs: 11000, ops: [{ fn: "linear", kind: "graph", a: 1 }], caption: "x" };
  assert.equal(manimCacheKey(a, "low"), manimCacheKey(b, "low"));
});

/* ── The artwork catalogue ────────────────────────────────────────────────── */

test("retrieval finds the specific asset, and offers nothing when it has nothing", async () => {
  // Scoring every matching term equally meant "how a nephron filters blood" returned blood-sample
  // and arabidopsis-flower while nephron-2d never made the shortlist — short generic words hit
  // hundreds of assets and drown the specific one. Term length is the weight.
  const nephron = await findAssets("a nephron showing the glomerulus and the flow of blood");
  assert.ok(
    nephron.some((a) => a.id.includes("nephron")),
    `expected a nephron asset, got: ${nephron.map((a) => a.id).join(", ") || "(none)"}`,
  );

  // Offering something irrelevant is worse than offering nothing: it teaches the model the
  // catalogue is noise. Bioicons has no chloroplast, thylakoid or granum.
  const chloroplast = await findAssets("photosynthesis inside a chloroplast, thylakoid stacks and stroma");
  assert.equal(chloroplast.length, 0, `expected no match, got: ${chloroplast.map((a) => a.id).join(", ")}`);
});

test("asset markup survives a strict XML parser, not just a browser", async () => {
  const [asset] = await loadAssets(await findAssets("a mitochondrion with cristae"));
  assert.ok(asset, "the catalogue should have a mitochondrion");

  // These files come out of Inkscape carrying inkscape:, sodipodi: and rdf: markup whose
  // namespaces were declared on the root <svg> that unwrapping strips. Browsers shrug; resvg
  // refuses to parse the document at all, which silently costs the vision critic its opinion on
  // exactly the boards that use artwork.
  assert.ok(!/\s(?!xlink:)[a-z][\w-]*:[\w-]+\s*=/i.test(asset.body), "no orphaned namespace prefixes survive");
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${asset.w} ${asset.h}">${asset.body}</svg>`;
  assert.doesNotThrow(() => new Resvg(svg, { fitTo: { mode: "width", value: 120 } }).render().asPng());
});

/* ── The spec boards: Vega-Lite charts and KaTeX derivations ──────────────── */

test("a TeX command mangled by JSON escaping is repaired, not discarded", async () => {
  const { repairTex } = await import("../equationSpec");
  // `"\frac"` is VALID JSON — `\f` is a legal escape — so JSON.parse silently yields U+000C
  // followed by "rac{a}{b}" and KaTeX rejects a character nobody typed. Every command starting
  // \f \b \n \r \t is exposed, which is most of real derivation TeX.
  const FF = "\f"; // U+000C — exactly what a JSON "\f" collapses to, i.e. the start of "\frac"
  const TAB = "\t"; // U+0009 — likewise for "\t", i.e. the start of "\times"
  const BS = String.fromCharCode(92);

  const out = repairTex(`${FF}rac{a}{b} = ${TAB}imes 2`);
  assert.ok("tex" in out, "the control characters are restored rather than the step being dropped");
  assert.equal(out.tex, `${BS}frac{a}{b} = ${BS}times 2`);

  // The repair must not "fix" a string into plausible nonsense. Stripping delimiters before
  // restoring control characters did exactly that: String.trim() eats a leading form feed, so
  // `\frac{a}{b}` became `rac{a}{b}` — which KaTeX compiles happily, because `rac` is three
  // perfectly good variables. The board would then show the wrong equation and nothing would object.
  const both = repairTex(`$$${FF}rac{a}{b}$$`);
  assert.ok("tex" in both);
  assert.equal(both.tex, `${BS}frac{a}{b}`);
});

test("delimiters the model adds against instruction are stripped, and nonsense still fails", async () => {
  const { repairTex } = await import("../equationSpec");
  // Built from an explicit backslash rather than written as an escape: these strings are about
  // backslashes, and a literal is one editing accident away from testing something else entirely.
  const BS = String.fromCharCode(92);
  for (const wrapped of ["$$a^2 + b^2 = c^2$$", `${BS}[a^2 + b^2 = c^2${BS}]`]) {
    const out = repairTex(wrapped);
    assert.ok("tex" in out, `${wrapped} should repair`);
    assert.equal(out.tex, "a^2 + b^2 = c^2");
  }
  const bad = repairTex(`${BS}frac{1}{`);
  assert.ok("error" in bad, "an unbalanced brace is not repairable");
  assert.match(bad.error, /KaTeX/, "and the reason names KaTeX, so the retry can act on it");
});

test("an over-long step is rejected rather than sliced into invalid TeX", async () => {
  const { parseEquationSpec } = await import("../equationSpec");
  const BS = String.fromCharCode(92);
  const { spec, rejected } = parseEquationSpec({
    steps: [{ tex: `${BS}text{${"x".repeat(300)}}` }, { tex: "a = b" }, { tex: "b = c" }],
  });
  assert.ok(spec);
  assert.equal(spec.steps.length, 2, "the long step is gone, the good ones survive");
  assert.match(rejected[0].reason, /too long/);
});

test("a plot needs inline data, a drawable mark and a positional channel", async () => {
  const { validatePlotSpec } = await import("../plotSpec");
  const good = {
    mark: "line",
    data: { values: [{ year: 1, amount: 1050 }, { year: 2, amount: 1102 }] },
    encoding: { x: { field: "year", type: "quantitative" }, y: { field: "amount", type: "quantitative" } },
  };
  const ok = validatePlotSpec(good);
  assert.ok(ok);
  assert.equal(ok.width, "container", "sizing is imposed by us, never taken from the model");

  // A URL data source renders an empty chart in the browser — the silent blank board this whole
  // pipeline exists to stamp out — so it is rejected here rather than discovered on screen.
  assert.equal(validatePlotSpec({ ...good, data: { url: "data/stocks.csv" } }), null);
  assert.equal(validatePlotSpec({ ...good, mark: "geoshape" }), null, "an exotic mark is not a teaching chart");
  assert.equal(validatePlotSpec({ ...good, encoding: { color: { field: "year" } } }), null, "no position, no chart");
});

// The second half of the plot guarantee — that Vega-Lite actually COMPILES the spec — lives in
// lib/anim/plotCompile.test.mjs. vega-lite is an async ES module and cannot be required from this
// CommonJS build at all, so testing it here could only ever test the failure path.

test("every visual form routes to a board this codebase can actually fill", async () => {
  const { VISUAL_FORMS, BOARD_FOR } = await import("../director");
  const fillable = new Set(["manimScene", "structureScene", "morph", "reactAnimation", "chalkBoard", "plotBoard", "equationBoard"]);
  for (const form of VISUAL_FORMS) {
    assert.ok(fillable.has(BOARD_FOR[form]), `${form} -> ${BOARD_FOR[form]} must be a real board`);
  }
  // The two boards this phase added, pinned so a future edit cannot quietly send them back to
  // Manim — a derivation is read, not watched, and a chart should not cost seconds of Python.
  assert.equal(BOARD_FOR.plot, "plotBoard");
  assert.equal(BOARD_FOR.equation, "equationBoard");
});

/* ── The beat visual specification, and the SVM regression ────────────────── */

test("a specification needs a subject and something concrete to show", async () => {
  const { validateBeatVisualSpec } = await import("../beatVisualSpec");

  const ok = validateBeatVisualSpec({
    subject: "the SVM decision boundary and margin — a machine-learning concept, NOT a physical machine",
    mustShow: ["two classes of points", "the separating hyperplane", "the support vectors on the margin"],
    mustNotShow: "any physical machine or vending device",
    isPhysical: false,
  });
  assert.ok(ok);
  assert.equal(ok.mustShow.length, 3);
  assert.equal(ok.isPhysical, false);

  assert.equal(validateBeatVisualSpec({ mustShow: ["a thing"] }), null, "no subject, no specification");
  assert.equal(validateBeatVisualSpec({ subject: "a nephron" }), null, "a subject with nothing to show is not a plan");
  assert.equal(validateBeatVisualSpec(null), null);
});

test("isPhysical fails closed — anything but an explicit true is false", async () => {
  const { validateBeatVisualSpec } = await import("../beatVisualSpec");
  // This flag is the only thing standing between an abstract lecture and a stock photograph, so a
  // missing or fuzzy value must never read as permission.
  for (const value of [undefined, null, "true", 1, "yes"]) {
    const spec = validateBeatVisualSpec({ subject: "s", mustShow: ["m"], isPhysical: value });
    assert.ok(spec);
    assert.equal(spec.isPhysical, false, `${JSON.stringify(value)} must not grant a photo`);
  }
  const explicit = validateBeatVisualSpec({ subject: "a nephron", mustShow: ["the glomerulus"], isPhysical: true });
  assert.equal(explicit?.isPhysical, true);
});

test("the specification travels to the engine as a real brief, not a one-liner", async () => {
  const { specToBrief } = await import("../beatVisualSpec");
  const brief = specToBrief({
    subject: "the SVM decision boundary — NOT a physical machine",
    mustShow: ["two classes of points", "the margin"],
    mustNotShow: "a vending machine",
    isPhysical: false,
  });
  // Every part has to survive: the subject disambiguates, mustShow grounds the content, and
  // mustNotShow is the guard that names the wrong picture.
  assert.match(brief, /NOT a physical machine/);
  assert.match(brief, /two classes of points/);
  assert.match(brief, /Must NOT show: a vending machine/);
});


/* ── No beat may ship a dead board ────────────────────────────────────────── */

test("a placeholder nobody could fill does not count as a board", async () => {
  const { hasUsableBoard } = await import("../boardFallback");
  const beat = (ops: unknown[]) => ({ id: "b", title: "t", script: "s", draw: { ops } }) as never;

  // This is exactly what shipped as "ANIMATION UNAVAILABLE": the op is present, the code is not.
  assert.equal(hasUsableBoard(beat([{ kind: "reactAnimation", teachingPoint: "x" }])), false);
  assert.equal(hasUsableBoard(beat([{ kind: "reactAnimation", code: "export default function Animation(){}" }])), true);

  // Spec boards are the same story: a brief with no spec is a placeholder, not a picture.
  for (const kind of ["manimScene", "structureScene", "plotBoard", "equationBoard"]) {
    assert.equal(hasUsableBoard(beat([{ kind }])), false, `${kind} without a spec is not a board`);
    assert.equal(hasUsableBoard(beat([{ kind, spec: {} }])), true, `${kind} with a spec is`);
  }

  assert.equal(hasUsableBoard(beat([{ kind: "chalkBoard" }])), false, "an unfilled chalk board is empty");
  assert.equal(hasUsableBoard(beat([{ kind: "chalkBoard", ops: [{ kind: "label" }] }])), true);
  assert.equal(hasUsableBoard(beat([])), false);
  // Hand-authored ops are drawn directly, so their presence already means something is on screen.
  assert.equal(hasUsableBoard(beat([{ kind: "label", text: "hi" }])), true);
});

test("every visual form has a fallback chain that ends at a board which cannot fail", async () => {
  const { CHAIN } = await import("../boardFallback");
  const { VISUAL_FORMS } = await import("../director");
  for (const form of VISUAL_FORMS) {
    const chain = CHAIN[form];
    assert.ok(chain?.length, `${form} needs a chain`);
    // chalkBoard is the terminator because it is the only board with no way to fail on content:
    // it needs no geometry, no data and no generated code — just a brief and words.
    assert.equal(chain[chain.length - 1], "chalkBoard", `${form}'s chain must end at chalkBoard`);
  }
});

test("Manim is a last resort — the director never routes a beat to it", async () => {
  const { BOARD_FOR, VISUAL_FORMS } = await import("../director");
  // Its scene vocabulary is six geometric primitives, so anything outside maths degrades to the
  // nearest available shape — a breathing beat rendered as a bare orange rectangle, because a
  // rectangle was the only container the spec could express. The sandbox draws these properly now.
  for (const form of VISUAL_FORMS) {
    assert.notEqual(BOARD_FOR[form], "manimScene", `${form} must not be directed to Manim`);
  }
  assert.equal(BOARD_FOR.construction, "reactAnimation");
  assert.equal(BOARD_FOR["animated-maths"], "reactAnimation");
});
