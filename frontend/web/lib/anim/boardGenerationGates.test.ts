/**
 * The board generator's deterministic gates: the physical/abstract classifier, the server render
 * that every rendered-output check depends on, measured text layout, strict-source label grounding,
 * candidate ranking, and the prompt the generator sends.
 *
 * Each of these used to fail OPEN — a fragment made the render throw and every check report "ok",
 * one abstract word made a biology beat skip every critic — so each test pins the failure it fixes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  animationModelAcceptsImages,
  buildUserPrompt,
  isAbstractTopic,
  sourceBlueprint,
  sourceFidelityScore,
  sourceForBeat,
  strictHeading,
  stripUngroundedTexts,
  SOURCE_FAITHFUL_OVERRIDE,
} from "../reactAnimationGen";
import {
  critiqueLayout,
  layoutIssues,
  measuredTextWidth,
  shapeVerdict,
  textBoxes,
  ungroundedBoardTexts,
  withoutInventedAdditions,
} from "../reactAnimationVisionCritic";
import { pickCandidate, layoutTier, type CandidateVerdict } from "../animationCandidates";
import { getReactAnimationCodeDiagnostics } from "../drawSanitize";
import type { Beat } from "../lessonContent";
import { ENERGY_SCRIPT, ENERGY_SOURCE, FAITHFUL_TEXTS, fixtureBoard } from "./boardFixtures";

const beat = (title: string, script: string) => ({ title, script });
const op = (teachingPoint = "") => ({ teachingPoint });

/* ── isAbstractTopic ──────────────────────────────────────────────────────── */

test("THE BUG: a photosynthesis beat that mentions a 'word equation' is physical, not abstract", () => {
  const script =
    "Photosynthesis is the way that plants make food. They use carbon dioxide and water to make glucose and oxygen. " +
    "Photosynthesis is a chemical reaction. We can summarise it using a word equation.";
  assert.equal(isAbstractTopic(op(), beat("Photosynthesis", script)), false);
  // Even without the physical title, the physical terms outnumber one abstract word.
  assert.equal(isAbstractTopic(op(), beat("Making food", script)), false);
});

test("physical wins a tie; weak abstract words in prose ('list', 'function', 'set') do not count", () => {
  const script = "The function of chlorophyll is to absorb light. Here is a list of the parts. A set of cells forms tissue.";
  assert.equal(isAbstractTopic(op(), beat("What the pigment does", script)), false);
});

test("a beat whose source has a figure to redraw is physical, whatever its words", () => {
  const script = "Energy is transferred and stored. The equation summarises the function of the process.";
  assert.equal(isAbstractTopic(op(), beat("Energy Transfer", script)), true, "without the figure this reads abstract");
  assert.equal(isAbstractTopic(op(), beat("Energy Transfer", script), ENERGY_SOURCE), false);
});

test("plurals and stems now match: 'lungs' and 'respiration' are physical terms", () => {
  assert.equal(isAbstractTopic(op(), beat("How Lungs Exchange Gases Works", "Respiration moves gases in and out.")), false);
});

test("genuinely abstract beats stay abstract", () => {
  assert.equal(
    isAbstractTopic(op(), beat("Binary Search Trees", "Each node has a left and right subtree. Traversal visits every node; search runs in O(log n) on a balanced tree.")),
    true,
  );
  assert.equal(
    isAbstractTopic(op(), beat("How Supply and Demand Equilibrium Works", "Supply and demand meet at the equilibrium price. Elasticity measures the response.")),
    true,
  );
});

/* ── The server render: real React, so the checks stop failing open ─────── */

const overlapping = [
  { text: "Energy transfer", x: 76, y: 78, size: 34, sentence: 0, kind: "write" },
  { text: "vacuole", x: 690, y: 250, size: 20, sentence: 3 },
  { text: "nucleus", x: 692, y: 252, size: 20, sentence: 3 },
];

test("THE BUG: a board using <>…</> is rendered and measured (it used to throw and report ok)", async () => {
  const layout = await critiqueLayout(fixtureBoard(overlapping, { wrapInFragment: true }));
  assert.equal(layout.measured, true, `rendered: ${layout.renderError ?? ""}`);
  assert.equal(layout.ok, false, "the overlap inside the fragment is caught");
  assert.match(layout.issue ?? "", /printed on top of each other/);
});

test("React.useMemo and React.Fragment render on the server", async () => {
  const withMemo = await critiqueLayout(fixtureBoard(FAITHFUL_TEXTS, { useMemo: true }));
  assert.equal(withMemo.measured, true, withMemo.renderError);
  const fragment = fixtureBoard(FAITHFUL_TEXTS).replace("<g>\n", "<React.Fragment>\n").replace(/<\/g>\n    <\/svg>/, "</React.Fragment>\n    </svg>");
  const withFragment = await critiqueLayout(fragment);
  assert.equal(withFragment.measured, true, withFragment.renderError);
  assert.ok(withFragment.texts.includes("chloroplast containing"), "the texts inside the fragment are read");
});

test("THE NEXT.JS CASE: hooks and context render even when `react` is the react-server build", async () => {
  // A Next.js route handler resolves `react` to react.react-server.js: no useState, useRef or
  // createContext, and its useMemo belongs to a different instance than react-dom/server. Plain
  // Node never sees that build, so load it by path and render through it.
  const load = createRequire(__filename);
  const rscReact = load(load.resolve("react").replace(/index\.js$/, "react.react-server.js"));
  assert.equal(typeof rscReact.useState, "undefined", "the precondition: this build has no useState");
  const code = `export default function Animation({ progress }) {
    const Theme = React.createContext("#1b2440");
    const [size] = React.useState(() => 22);
    const box = React.useRef(null);
    const width = React.useMemo(() => 260, []);
    const Label = ({ text, y }) => { const ink = React.useContext(Theme); return <text x="700" y={y} fontSize={size} fill={ink}>{text}</text>; };
    return (
      <svg viewBox="0 0 1000 560" ref={box}>
        <Theme.Provider value="#65a30d">
          <>
            <rect x="400" y="150" width={width} height="300" />
            <Label text="vacuole" y={250} />
            <Label text="nucleus" y={310} />
          </>
        </Theme.Provider>
      </svg>
    );
  }`;
  const { renderStaticFrame } = await import("../reactAnimationVisionCritic");
  const frame = await renderStaticFrame(code, undefined, rscReact);
  assert.equal(frame.failure, undefined, frame.failure?.message);
  assert.match(frame.svg ?? "", /fill="#65a30d"[^>]*>vacuole<\/text>/, "the provided context value reaches the label");
});

test("a board whose own code throws is a fault, not a pass", async () => {
  const layout = await critiqueLayout(fixtureBoard(FAITHFUL_TEXTS, { brokenReference: true }));
  assert.equal(layout.measured, false);
  assert.equal(layout.unmeasured, "component");
  assert.equal(layout.ok, false);
  assert.match(layout.issue ?? "", /throws when it renders/);
});

test("the faithful fixture renders clean, and its texts are returned for the grounding check", async () => {
  const layout = await critiqueLayout(fixtureBoard(FAITHFUL_TEXTS));
  assert.equal(layout.measured, true, layout.renderError);
  assert.deepEqual(layout.issues, [], layout.issues.join("\n"));
  assert.deepEqual(layout.texts, FAITHFUL_TEXTS.map((row) => row.text));
});

/* ── Measured text ────────────────────────────────────────────────────────── */

test("text is measured with the sandbox font's glyph widths, not a flat 0.62 em", () => {
  const label = "chloroplast containing chlorophyll";
  const width = measuredTextWidth(label, 22);
  assert.ok(width < 0.62 * 22 * label.length * 0.9, `measured ${Math.round(width)}px is well under the old estimate`);
  assert.ok(width > 0.45 * 22 * label.length, "and still conservative");
});

test("a verbatim source label wrapped onto two lines fits where the old estimate called it clipped", () => {
  const svg = `<svg viewBox="0 0 1000 560"><text x="700" y="300" font-size="22">chloroplast containing</text><text x="700" y="326" font-size="22">chlorophyll</text></svg>`;
  assert.deepEqual(layoutIssues(svg), []);
});

test("a label wrapped with <tspan x dy> (the layout contract's form) is measured line by line", () => {
  const wrapped = `<svg><text x="710" y="286" font-size="20">chloroplast containing <tspan x="710" dy="24">chlorophyll</tspan></text></svg>`;
  assert.deepEqual(layoutIssues(wrapped), []);
  assert.deepEqual(textBoxes(wrapped).map((box) => box.text), ["chloroplast containing", "chlorophyll"]);
  const oneLine = `<svg><text x="710" y="286" font-size="20">chloroplast containing chlorophyll</text></svg>`;
  assert.match(layoutIssues(oneLine).join(" "), /outside the safe frame/, "unwrapped, it really does run off the board");
});

test("a heading and subtitle whose ink overprints are caught; properly spaced rows are not", () => {
  // The reported board: a 34px title at y=78 and a 23px subtitle at y=104. The old 1.35-em boxes
  // passed it; the title's "y" descender and the subtitle's capital L overprint on screen.
  const tight = `<svg><text x="76" y="78" font-size="34" font-weight="800">Photosynthesis</text><text x="76" y="104" font-size="23">Light powers chemical change</text></svg>`;
  assert.match(layoutIssues(tight).join(" "), /on top of each other/);
  const spaced = `<svg><text x="76" y="78" font-size="34">Photosynthesis</text><text x="76" y="120" font-size="23">Light powers chemical change</text></svg>`;
  assert.deepEqual(layoutIssues(spaced), []);
});

test("text inside a transformed group is measured where it is drawn, not at its local x/y", () => {
  // A part drawn around the origin with its label at negative x: inside the frame once translated.
  const translated = `<svg viewBox="0 0 1000 560"><g transform="translate(600 300)"><text x="-80" y="0" font-size="20">nucleus</text></g></svg>`;
  assert.deepEqual(layoutIssues(translated), [], "not 'outside the safe frame'");
  // Two labels at the same LOCAL spot in different groups sit 200 px apart on the board.
  const apart = `<svg viewBox="0 0 1000 560"><g transform="translate(300 200)"><text x="0" y="0" font-size="20">vacuole</text></g><g transform="translate(300 400)"><text x="0" y="0" font-size="20">nucleus</text></g></svg>`;
  assert.deepEqual(layoutIssues(apart), [], "not 'printed on top of each other'");
  // And two that the transforms DO bring together are caught, ink band included.
  const together = `<svg viewBox="0 0 1000 560"><g transform="translate(300 200)"><text x="0" y="0" font-size="22">cytoplasm</text></g><text x="300" y="222" font-size="22">Nucleus</text></svg>`;
  assert.match(layoutIssues(together).join(" "), /on top of each other/);
  // A label pushed off the board by its group's transform is caught.
  const off = `<svg viewBox="0 0 1000 560"><g transform="translate(900 300)"><text x="0" y="0" font-size="20">chloroplast</text></g></svg>`;
  assert.match(layoutIssues(off).join(" "), /outside the safe frame/);
});

test("rows without ascenders or descenders may sit closer than rows with them", () => {
  // x-height-only words at a 1.0 em gap do not touch; a descender over a capital at the same gap does.
  const plain = `<svg><text x="700" y="300" font-size="22">vacuole</text><text x="700" y="322" font-size="22">membrane</text></svg>`;
  const deep = `<svg><text x="700" y="300" font-size="22">cytoplasm</text><text x="700" y="322" font-size="22">Nucleus</text></svg>`;
  assert.deepEqual(layoutIssues(plain), []);
  assert.match(layoutIssues(deep).join(" "), /on top of each other/);
});

test("a stroke straight through a word with no tall letters is still caught", () => {
  // The connector checks shrink each box before testing; a box sized to "vacuole"'s own x-height
  // would shrink to nothing. They get the full-height box.
  const svg = `<svg><text x="700" y="300" font-size="22">vacuole</text><line x1="640" y1="293" x2="860" y2="293" stroke="#000" /></svg>`;
  assert.match(layoutIssues(svg).join(" "), /runs straight through the label "vacuole"/);
});

test("headings are measured in the heavier face", () => {
  assert.ok(measuredTextWidth("Energy transfer", 34, 800) > measuredTextWidth("Energy transfer", 34, 400));
});

test("text-anchor middle and end are measured from the anchor", () => {
  const [middle] = textBoxes(`<text x="500" y="100" font-size="20" text-anchor="middle">nucleus</text>`);
  const [end] = textBoxes(`<text x="500" y="100" font-size="20" text-anchor="end">nucleus</text>`);
  assert.ok(Math.abs(middle.x + middle.w / 2 - 500) < 0.01);
  assert.ok(Math.abs(end.x + end.w - 500) < 0.01);
});

test("the critics' picture is drawn in the board font — even on a server with no system fonts", async () => {
  const { rasterFontFiles, withBoardFont } = await import("../reactAnimationVisionCritic");
  const files = rasterFontFiles();
  assert.equal(files.length, 2, "public/fonts ships the SemiBold and ExtraBold TTFs");
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" style="font-family:Chalkboard SE, Marker Felt"><rect width="400" height="100" fill="#ffffff"/><text x="10" y="70" font-size="48" font-family="Gaegu" fill="#000000">nucleus</text></svg>`;
  const inked = (doc: string) => {
    const image = new Resvg(doc, { font: { fontFiles: files, loadSystemFonts: false, defaultFontFamily: "Playpen Sans" } }).render();
    let dark = 0;
    for (let i = 0; i < image.pixels.length; i += 4) if (image.pixels[i] < 128) dark += 1;
    return dark;
  };
  assert.match(withBoardFont(svg), /font-family="Playpen Sans"/);
  assert.doesNotMatch(withBoardFont(svg), /Chalkboard|Gaegu/);
  assert.ok(inked(withBoardFont(svg)) > 500, "the label is drawn");
});

/* ── Strict label grounding ───────────────────────────────────────────────── */

test("every word the board writes is checked against the source", () => {
  const faults = ungroundedBoardTexts(
    ["Energy transfer", "This energy comes from light.", "CO2", "chloroplast containing", "Sunlight", "Light starts the process", "cell wall"],
    { ...ENERGY_SOURCE, text: `${ENERGY_SOURCE.text} They use carbon dioxide and water.` },
  );
  assert.deepEqual(faults.map((f) => f.text), ["Sunlight", "Light starts the process"]);
  assert.deepEqual(faults[0].missing, ["sunlight"]);
});

test("a strict heading drops the pipeline's '(Part 2)' and refuses a title the source never uses", () => {
  assert.equal(strictHeading("Energy Transfer (Part 2)", ENERGY_SOURCE), "Energy Transfer");
  assert.equal(strictHeading("Worked Example", ENERGY_SOURCE), null);
});

test("the last-resort strip deletes an invented label (and its single-label group), nothing else", () => {
  const code = `<svg>
    <text x="76" y="78" data-teach-order="1">Energy transfer</text>
    <g data-teach-order="5" data-teach-kind="label" data-teach-sentence="1">
      <line x1="700" y1="200" x2="560" y2="200" />
      <text x="710" y="206">Sun
        light</text>
    </g>
    <text x="700" y="300" data-teach-order="6"><tspan>chloroplast containing</tspan> <tspan>chlorophyll</tspan></text>
    <text x="700" y="400" data-teach-order="7">{"Glucose store"}</text>
  </svg>`;
  const stripped = stripUngroundedTexts(code, ["Sun light", "Glucose store"]);
  assert.doesNotMatch(stripped, /Sun/);
  assert.doesNotMatch(stripped, /x2="560"/, "the invented label's leader went with it");
  assert.doesNotMatch(stripped, /Glucose store/);
  assert.match(stripped, /Energy transfer/);
  assert.match(stripped, /chloroplast containing/);
});

test("the strip also takes the leader of the contract's label form (leader group, then its <text> as a sibling)", () => {
  // lib/drawPrompt.ts: "A label is TWO steps in the same sentence: a <g> holding its leader and dot,
  // then its <text>." Deleting only the words left a leader and dot pointing at nothing.
  const code = `<svg>
      <g data-teach-order="4" data-teach-kind="label" data-teach-weight="1" data-teach-sentence="1">
        <line x1="702" y1="166" x2="508" y2="166" stroke={lead} strokeWidth="1.25" />
        <circle cx="508" cy="166" r="4" fill={ink} />
      </g>
      {/* the invented one */}
      <text x="710" y="172" fontSize="20" fill={ink} data-teach-order="5" data-teach-kind="label">Sunlight</text>

      <g data-teach-order="6" data-teach-kind="label" data-teach-weight="1" data-teach-sentence="2">
        <line x1="702" y1="276" x2="532" y2="276" stroke={lead} strokeWidth="1.25" />
        <circle cx="532" cy="276" r="4" fill={ink} />
      </g>
      <text x="710" y="282" fontSize="20" fill={ink} data-teach-order="7" data-teach-kind="label">vacuole</text>
  </svg>`;
  const stripped = stripUngroundedTexts(code, ["Sunlight"]);
  assert.doesNotMatch(stripped, /Sunlight/);
  assert.doesNotMatch(stripped, /x2="508"/, "the invented label's leader went with it");
  assert.match(stripped, /x2="532"/, "the grounded label keeps its leader");
  assert.match(stripped, />vacuole</);
});

test("strict critic defects that ask to ADD words the source lacks are dropped; deletions are kept", () => {
  const defects = [
    { what: "missing sun", where: "top", fix: 'add a label "Sunlight" above the leaf' },
    { what: "invented", where: "top", fix: 'delete the label "Sunlight"' },
    { what: "unlabelled", where: "centre", fix: 'label the large central part "vacuole"' },
    { what: "overlap", where: "right", fix: "move the nucleus label down 40px" },
    { what: "possessive", where: "left", fix: "label the plant's cell wall on the cell's left edge" },
  ];
  assert.deepEqual(withoutInventedAdditions(defects, ENERGY_SOURCE).map((d) => d.what), ["invented", "unlabelled", "overlap", "possessive"]);
});

/* ── Shape critic verdict ─────────────────────────────────────────────────── */

test("THE BUG: a shape critic reply with no score is not a pass", () => {
  assert.equal(shapeVerdict({}, "palisade cell").ok, false);
  assert.equal(shapeVerdict({}, "palisade cell").score, null);
  assert.equal(shapeVerdict({ recognizable: true }, "palisade cell").ok, true, "an explicit yes without a number still passes");
  assert.equal(shapeVerdict({ recognizable: true, score: 2 }, "leaf").ok, false);
  assert.equal(shapeVerdict({ recognizable: true, score: 4 }, "leaf").ok, true);
  assert.equal(shapeVerdict({ recognizable: false, score: 4 }, "leaf").ok, false);
});

/* ── Candidate ranking ────────────────────────────────────────────────────── */

const soft = (score: number, extra: Partial<Extract<CandidateVerdict, { kind: "soft-fail" }>> = {}, code = `soft${score}`): CandidateVerdict =>
  ({ kind: "soft-fail", code, score, layoutClean: true, issue: "x", ...extra });

test("strict: a grounded board outranks an ungrounded one however rich or clean the latter is", () => {
  const picked = pickCandidate([
    soft(900, { grounded: false }, "invented-but-clean"),
    soft(100, { grounded: true, layoutClean: false }, "faithful-with-overlap"),
  ]);
  assert.equal(picked?.code, "faithful-with-overlap");
});

test("measured-clean beats unmeasured beats measured-faulty beats a board that throws", () => {
  const order = [
    soft(10, { renderFailed: true, layoutClean: false, measured: false }, "throws"),
    soft(20, { layoutClean: false }, "faulty"),
    soft(30, { measured: false }, "unmeasured"),
    soft(5, {}, "clean"),
  ];
  assert.equal(pickCandidate(order)?.code, "clean");
  assert.deepEqual(order.map(layoutTier), [3, 2, 1, 0]);
  assert.equal(pickCandidate(order.slice(0, 3))?.code, "unmeasured");
  assert.equal(pickCandidate(order.slice(0, 2))?.code, "faulty");
});

test("among passes, a measured one beats an unmeasured richer one", () => {
  const picked = pickCandidate<CandidateVerdict>([
    { kind: "pass", code: "unmeasured", score: 200, measured: false },
    { kind: "pass", code: "measured", score: 100 },
  ]);
  assert.equal(picked?.code, "measured");
});

test("a strict board's score counts source labels written, not drawing density", () => {
  const diagnostics = { distinctTimelineSentences: 3, timelineStepCount: 9 };
  const faithful = sourceFidelityScore(FAITHFUL_TEXTS.map((r) => r.text), ENERGY_SOURCE, diagnostics);
  const partial = sourceFidelityScore(["Energy transfer", "cell wall"], ENERGY_SOURCE, { distinctTimelineSentences: 8, timelineStepCount: 40 });
  assert.ok(faithful > partial, `${faithful} > ${partial}`);
});

/* ── Density floors in strict mode ────────────────────────────────────────── */

test("a sparse faithful figure clears the strict floors that would call it 'too text-heavy'", () => {
  const code = fixtureBoard(FAITHFUL_TEXTS);
  assert.equal(getReactAnimationCodeDiagnostics(code, { sourceFaithful: true }).issue, null);
  assert.notEqual(getReactAnimationCodeDiagnostics(code).issue, null, "the reference floors still demand a busier scene");
});

/* ── The prompt ───────────────────────────────────────────────────────────── */

const promptBeat = {
  id: "b1",
  title: "Energy Transfer (Part 2)",
  script: ENERGY_SCRIPT,
  teacherMove: "explain",
  points: [],
} as unknown as Beat;
const promptOp = { kind: "reactAnimation", teachingPoint: "Energy transfer brief", at: 0, endAt: 1 } as never;

test("the user prompt carries no layout, font or character-cap rules of its own", () => {
  const prompt = buildUserPrompt(promptOp, promptBeat, sourceBlueprint(promptOp, promptBeat, ENERGY_SOURCE));
  for (const banned of [/DYNAMIC COMPOSITION/, /<=\s*25 characters/, /fontFamily/, /0\.62\*fontSize/, /SITS INSIDE/, /58-76%/]) {
    assert.doesNotMatch(prompt, banned);
  }
});

test("strict: the prompt carries the SOURCE, its labels verbatim, and the cleaned heading", () => {
  const prompt = buildUserPrompt(promptOp, promptBeat, sourceBlueprint(promptOp, promptBeat, ENERGY_SOURCE), undefined, false, ENERGY_SOURCE);
  assert.match(prompt, /SOURCE — the student's own material/);
  assert.match(prompt, /PARTS THE SOURCE FIGURE SHOWS[^\n]*"chloroplast containing chlorophyll"/);
  assert.match(prompt, /HEADING: write it as exactly "Energy Transfer"\./);
  assert.match(prompt, /for TIMING only/);
  assert.match(SOURCE_FAITHFUL_OVERRIDE, /OVERRIDES EVERY RULE ABOVE/);
});

test("the blueprint of a sourced beat is the source's caption and labels, never a planner's guess", () => {
  const blueprint = sourceBlueprint(promptOp, promptBeat, ENERGY_SOURCE);
  assert.equal(blueprint.subject, ENERGY_SOURCE.caption);
  assert.deepEqual(blueprint.requiredParts.map((p) => p.name), ENERGY_SOURCE.labels);
});

/* ── Options plumbing ─────────────────────────────────────────────────────── */

test("sourceByBeatId is read from a record or a Map, and malformed entries are ignored", () => {
  assert.equal(sourceForBeat({ b1: ENERGY_SOURCE }, "b1")?.labels.length, 4);
  assert.equal(sourceForBeat(new Map([["b1", ENERGY_SOURCE]]), "b1")?.strict, true);
  assert.equal(sourceForBeat({ b1: ENERGY_SOURCE }, "b2"), undefined);
  assert.equal(sourceForBeat({ b1: { labels: [] } as never }, "b1"), undefined);
  assert.equal(sourceForBeat({ b1: { ...ENERGY_SOURCE, figureImage: "http://evil" } }, "b1")?.figureImage, undefined);
  // A scanned page with an empty text layer cannot ground anything; it must not strip a board bare.
  assert.equal(sourceForBeat({ b1: { text: "[page 3] ", labels: [], strict: true } }, "b1"), undefined);
});

test("figure images go only to models this repo already sends images to", () => {
  assert.equal(animationModelAcceptsImages("gpt-4o", {}), true);
  assert.equal(animationModelAcceptsImages("gpt-4o-mini", {}), true);
  assert.equal(animationModelAcceptsImages("gpt-5.6-luna", {}), false);
  assert.equal(animationModelAcceptsImages("gpt-5.6-luna", { OPENAI_ANIMATION_IMAGE_INPUT: "1" }), true);
  assert.equal(animationModelAcceptsImages("gpt-4o", { OPENAI_ANIMATION_IMAGE_INPUT: "0" }), false);
});
