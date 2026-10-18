import test from "node:test";
import assert from "node:assert/strict";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel, splitLong, takeLayoutDrops, textWidth, wrap } from "../canvas/layout";
import { pointTitle } from "../canvas/fallback";
import { labelMatchesPart, accurateLabel, takeLabelMismatches } from "../canvas/labelMatch";
import { partNameKey as partKey } from "../canvas/labelPolicy";
import { prettyPowers } from "../text/fit";
import { takeFigureCutItems } from "../figures/cuts";
import { examBoardSpec } from "../canvas/examBoard";

test("working written without spaces is broken where it reads naturally, never run out of its box", () => {
  const working = "sides:0.50(4.0)+1.0(0)=0.50(−1.0)+1.0v";
  const lines = wrap(`Both ${working}`, 21, 240, 3);
  for (const line of lines) assert.ok(textWidth(line, 21) <= 240, `"${line}" fits`);
  assert.equal(lines.join("").replace(/\s+/g, ""), `Both${working}`, "nothing lost");
  assert.ok(splitLong(working, 21, 200).every((p) => textWidth(p, 21) <= 200));
});

test("a backup card's title is what the point is about, not its first words cut short", () => {
  assert.equal(pointTitle("A direct impact is a collision in which two bodies move along the same straight line"), "Direct impact");
  assert.equal(pointTitle("Momentum: mass times velocity"), "Momentum");
  assert.equal(pointTitle("For an isolated two-body system, total momentum is conserved"), undefined);
  assert.equal(pointTitle("Choose one direction as positive before writing velocities"), undefined);
});

test("a label naming another part is replaced by the part's own name", () => {
  assert.ok(labelMatchesPart("Left ventricle", { id: "left-ventricle", name: "Left ventricle" }));
  assert.ok(labelMatchesPart("Mitochondria", { id: "mitochondrion", name: "Mitochondrion" }));
  assert.ok(labelMatchesPart("Centre O", { id: "centre", name: "Centre O" }));
  assert.ok(labelMatchesPart("Trolley A (1.2 kg)", { id: "body-a", name: "Body A" }), "placeholder parts take the writer's content");
  takeLabelMismatches();
  assert.equal(accurateLabel("Left atrium", { id: "right-atrium", name: "Right atrium" }), "Left atrium", "shares 'atrium' — a side error is the vision check's job");
  assert.equal(accurateLabel("Aorta", { id: "vena-cava", name: "Vena cava" }), "Vena cava");
  assert.equal(takeLabelMismatches().length, 1);
});

test("unit and ten powers are printed as superscripts; other number working is left alone", () => {
  assert.equal(prettyPowers("v = +2.50 m s^-1"), "v = +2.50 m s⁻¹");
  assert.equal(prettyPowers("J kg^-1 and x^2"), "J kg⁻¹ and x²");
  assert.equal(prettyPowers("5.97 × 10^24 kg and 7.0 × 10^(-6) m"), "5.97 × 10²⁴ kg and 7.0 × 10⁻⁶ m");
  assert.equal(prettyPowers("3^4 = 81"), "3^4 = 81");
  assert.equal(prettyPowers("at 4.0 m s^-1."), "at 4.0 m s⁻¹.");
});

test("compare links run across the gap whichever way they are listed, and never cross", () => {
  const spec = validateCanvasSpec({
    heading: "Before and after", notes: [], cues: [],
    stage: {
      kind: "compare",
      left: { id: "before", title: "Before", items: [{ id: "a1", text: "Separate trolleys", s: 0 }, { id: "a2", text: "3.0 kg right at 2.0 m s^-1", s: 1 }] },
      right: { id: "after", title: "After", items: [{ id: "b1", text: "Joined trolleys", s: 0 }, { id: "b2", text: "One common velocity", s: 1 }] },
      links: [{ from: "b1", to: "a1" }, { from: "a1", to: "b2" }, { from: "a2", to: "b1" }],
    },
  }, 3)!;
  const layout = layoutPanel(spec);
  const links = layout.marks.filter((m) => m.type === "link");
  const cols = layout.marks.filter((m) => m.type === "column");
  const gapL = cols[0].type === "column" ? cols[0].rect.x + cols[0].rect.w : 0;
  for (const l of links) if (l.type === "link") assert.ok(l.p0.x < gapL && l.p1.x > gapL, "left item → right item");
  assert.equal(links.length, 2, "the link crossing another is left out");
  const items = layout.marks.filter((m) => m.type === "item");
  for (const m of items) if (m.type === "item") for (const line of m.text.split("\n")) assert.ok(textWidth(line, m.size) <= m.rect.w - 32 + 1, `"${line}" stays inside its card`);
});

test("exam boards are fitted whole: no decorated cut, no 40-character heading", () => {
  const spec = examBoardSpec({ title: "Exam practice: conservation of linear momentum in direct impacts", script: "Read the question. First take right as positive. Then the combined mass. So v is 2.4." }, {
    commandWord: "Calculate", question: "A trolley A of mass 1.2 kg moves to the right at 4.0 m s^-1. It collides directly with trolley B of mass 0.80 kg, initially at rest. The trolleys coalesce on impact. Calculate their common velocity after the impact.",
    marks: 3, markPoints: ["Take right as positive and use conservation of momentum: 1.2(4.0) + 0.80(0) = (1.2 + 0.80)v", "Use the combined mass 2.0 kg in the final momentum", "v = 2.4 m s^-1 to the right"],
    lostMarks: "Candidates often use only one trolley's mass after coalescence, or write two separate final velocities.",
  });
  assert.equal(spec.heading, "Exam practice: conservation of linear momentum in direct impacts");
  assert.ok(spec.stage.kind === "exam" && spec.stage.question.includes("m s⁻¹"));
  takeFigureCutItems();
  const layout = layoutPanel(spec);
  assert.deepEqual(takeFigureCutItems(), [], "everything fits once the sizes step down");
  const heading = layout.marks.find((m) => m.type === "heading");
  assert.ok(heading && heading.type === "heading" && textWidth(heading.text, heading.size) <= 1024);
});

test("text the layout leaves off is reported, not silently lost", () => {
  const spec = validateCanvasSpec({
    heading: "Steps", notes: [], cues: [],
    stage: { kind: "flow", arrangement: "chain", nodes: Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, label: `Step ${i + 1}`, sub: "what happens here in detail", s: i })), arrows: [{ from: "n0", to: "n1", label: "a label far too long to sit on such a short arrow", s: 1 }] },
  }, 8)!;
  takeLayoutDrops();
  layoutPanel(spec);
  const drops = takeLayoutDrops();
  assert.ok(drops.length > 0, "something was left off and it was reported");
  assert.ok(drops.every((d) => typeof d === "string" && d.length > 10));
});

test("located picture parts match their board names in a normal form", () => {
  assert.equal(partKey("The Left Ventricles"), partKey("left ventricle"));
  assert.equal(partKey("Stoma (pore)"), partKey("stoma"));
});

test("a figure label too long for its margin is the part's own name, never a fragment", () => {
  const spec = validateCanvasSpec({
    heading: "The heart", notes: [], cues: [],
    stage: { kind: "figure", component: "heart", params: {}, parts: [
      { id: "right-atrium", name: "Right atrium receives deoxygenated blood", s: 0 },
      { id: "left-ventricle", name: "Left ventricle with its thick muscular wall", s: 1 },
      { id: "aorta", name: "Aorta", s: 2 },
    ] },
  }, 3)!;
  assert.ok(spec.stage.kind === "figure");
  const names = spec.stage.kind === "figure" ? spec.stage.parts.map((p) => p.name) : [];
  assert.deepEqual(names, ["Right atrium", "Left ventricle", "Aorta"]);
});

test("a generated picture labels structures, never the gases or ions moving across it", () => {
  const spec = validateCanvasSpec({
    heading: "Alveolar gas exchange", notes: [], cues: [],
    stage: { kind: "illustration", subject: "alveolus beside a capillary", parts: [
      { name: "Alveolar air", s: 0 }, { name: "Capillary wall", s: 1 }, { name: "Oxygen", s: 2 }, { name: "Carbon dioxide", s: 3 }, { name: "Squamous alveolar epithelium", s: 1 },
    ], labels: ["alveolar-air", "capillary-wall", "oxygen", "carbon-dioxide"] },
  }, 4)!;
  assert.ok(spec.stage.kind === "illustration");
  const names = spec.stage.kind === "illustration" ? spec.stage.parts.map((p) => p.name) : [];
  assert.deepEqual(names, ["Alveolar air", "Capillary wall", "Squamous alveolar epithelium"]);
});

test("pictures for things image models draw well; processes, arguments and maths stay diagrams", async () => {
  const { isPictureSubject } = await import("../diagrams/visualForm");
  const picture = ["The structure of the human heart", "Parts of a flower", "Plant and animal cells", "Root hair cells", "The human eye", "Volcano: a composite cone", "Features of a mosque", "Microscope parts", "Insects and their body parts"];
  const notPicture = ["Phototropism: response to light", "Auxin controls shoot elongation", "Forces in a situation", "The carbon cycle", "Building Bretton Woods", "Private decisions, wider effects", "Advantages of genetic modification", "Protein synthesis: transcription", "Food webs in a forest", "Volume of a cuboid", "Graph of plant growth"];
  for (const t of picture) assert.equal(isPictureSubject(t), true, t);
  for (const t of notPicture) assert.equal(isPictureSubject(t), false, t);
});

test("Dot never parks on words to point: a full board gives no spot", async () => {
  const { parkingSpot } = await import("../avatar/dotFlight");
  const target = { x: 400, y: 300, w: 200, h: 40 };
  const words = [{ x: 0, y: 0, w: 1000, h: 1000 }];
  assert.equal(parkingSpot(target, 60, { x: 0, y: 0, w: 1000, h: 1000 }, words, { x: 900, y: 900 }), null);
  assert.ok(parkingSpot(target, 60, { x: 0, y: 0, w: 1000, h: 1000 }, [], { x: 900, y: 900 }));
});

test("an equation board is maths: sentences as terms and values side by side are sent back", async () => {
  const { equationProblem } = await import("../canvas/equationCheck");
  const stage = (tokens: Array<[string, string]>, order: string[]) => ({ kind: "equation" as const, tokens: tokens.map(([id, text]) => ({ id, text, tex: text, color: "#000" })), steps: [{ s: 0, order, highlight: [] }] });
  const salad = stage([["a", "ΣFx"], ["b", "0"], ["c", "ΣFy"], ["d", "0"]], ["a", "b", "c", "d"]);
  assert.match(equationProblem(salad, salad as never, "") ?? "", /nothing between them/);
  const prose = stage([["a", "unknown rightward = known leftward"]], ["a"]);
  assert.match(equationProblem(prose, prose as never, "") ?? "", /words, not maths/);
  const word = stage([["a", "Expected frequency"], ["e", "="], ["p", "P"], ["x", "×"], ["n", "n"]], ["a", "e", "p", "x", "n"]);
  assert.equal(equationProblem(word, word as never, ""), null, "a word equation is fine");
});

test("a percentage worked with × 100 is not scaled again", async () => {
  const { checkNumbers } = await import("../canvas/numberCheck");
  assert.deepEqual(checkNumbers("% change = (3.0 ÷ 12.0) × 100 = 25%"), []);
  assert.deepEqual(checkNumbers("420/600 = 70%"), []);
  assert.equal(checkNumbers("420/600 = 60%").length, 1);
});
