import test from "node:test";
import assert from "node:assert/strict";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { fallbackSpec, wholeClause } from "../canvas/fallback";
import { boundFunction, functionGraphProblem } from "../figures/components/functionGraph";
import { directQuestionInstruction, parseQuestionShape } from "../planPrompt";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";

const beat = (id: string, title: string, stage: CanvasStage, script: string, extra: Partial<CanvasPlanBeat> = {}): CanvasPlanBeat => ({
  id, title, brief: title, script, stage, objects: [], inside: null, carry: [], interaction: "quiz", overview: false, ...extra,
});

// The Krebs lecture of the 2026-10-18 bench: four boards sent to the image model, all failed, all text cards.
const CITRATE = "The Krebs cycle is a series of enzyme-controlled redox reactions in the mitochondrial matrix. It is also called the citric acid cycle. Oxaloacetate is a four-carbon acceptor molecule. Acetyl coenzyme A carries a two-carbon acetyl group into the cycle. The two combine to form six-carbon citrate. Coenzyme A is released to collect another acetyl group. The cycle then turns citrate back into oxaloacetate.";
const DECARB = "Isocitrate undergoes decarboxylation, which means removing a carboxyl group as carbon dioxide. One carbon dioxide molecule leaves, so the six-carbon intermediate becomes a five-carbon molecule. This is the first decarboxylation step in the Krebs cycle. A second decarboxylation later releases another carbon dioxide. Each step also reduces NAD. By the end, oxaloacetate is regenerated.";

test("a board the visual choice calls a diagram stays a code-drawn flow, never a picture", () => {
  const { beats } = applyLessonVisualPolicy([
    beat("b1", "Krebs Cycle: Formation of Citrate", "flow", CITRATE, { visualType: "diagram" }),
    beat("b2", "Decarboxylation Steps", "illustration", DECARB, { visualType: "diagram" }),
  ], { mode: "prompt", aiPictures: true });
  assert.deepEqual(beats.map((b) => b.stage), ["flow", "flow"]);
});

test("a cycle called a 'thing' is still drawn as its loop of steps", () => {
  const { beats } = applyLessonVisualPolicy([beat("b1", "Krebs Cycle: Formation of Citrate", "flow", CITRATE, { visualType: "thing" })], { mode: "prompt", aiPictures: true });
  assert.equal(beats[0].stage, "flow");
});

test("the two-in-three diagram quota never turns a non-'thing' board into a picture", () => {
  const { beats } = applyLessonVisualPolicy([
    beat("b1", "Krebs Cycle: Formation of Citrate", "flow", CITRATE, { visualType: "diagram" }),
    beat("b2", "Aerobic and anaerobic respiration in muscle", "compare", "Aerobic respiration in muscle cells uses oxygen and releases much more energy than anaerobic respiration, which makes lactate in the muscle.", { visualType: "comparison" }),
    beat("b3", "Decarboxylation Steps", "flow", DECARB, { visualType: "diagram" }),
  ], { mode: "prompt", aiPictures: true });
  assert.notEqual(beats[1].stage, "illustration");
});

test("the last-resort backup of a cycle board is a loop of linked cards spread over the narration, each a whole clause", () => {
  const spec = fallbackSpec(beat("b2", "Decarboxylation Steps", "flow", DECARB, { visualType: "diagram", brief: "Diagram: a cycle of decarboxylation steps" }));
  assert.equal(spec.stage.kind, "scene");
  if (spec.stage.kind !== "scene") return;
  assert.ok(spec.stage.arrows.length >= spec.stage.items.length, "joined in order and closed into a loop");
  const last = Math.max(...spec.stage.items.map((i) => i.s));
  assert.ok(last >= 3, `cards reach the end of the narration (last card on sentence ${last + 1})`);
  for (const it of spec.stage.items) assert.doesNotMatch(it.detail ?? it.label ?? "", /\b(becomes|so the|and|the)$/i);
});

test("a long sentence is cut where a clause ends, never mid-phrase", () => {
  assert.equal(wholeClause("One carbon dioxide molecule leaves, so the six-carbon intermediate becomes a five-carbon molecule.", 80), "One carbon dioxide molecule leaves");
  assert.equal(wholeClause("Short and whole.", 80), "Short and whole");
});

test("a function graph draws the board's own curve: letters get their numbers, an unreadable f is sent back", () => {
  assert.equal(boundFunction("sin(x + h)", { h: 0.5 }), "sin(x + (0.5))");
  assert.equal(boundFunction("(4+h)*x - 4 - 2*h", {}), "(4+(1))*x - 4 - 2*(1)");
  assert.equal(boundFunction("e^x", {}), "e^x");
  assert.equal(functionGraphProblem({ f: "sin(x + h)", h: 0.5, g: "sin(x)" }), null);
  assert.match(functionGraphProblem({ f: "x^n", tangentAt: 2 }) ?? "", /cannot read f/);
  assert.match(functionGraphProblem({}) ?? "", /no f/);
  assert.equal(functionGraphProblem({ f: "x^2", g: "(4+h)*x - 4 - 2*h" }), null);
});

test("question sizes: a fact is one board, an idea two (the idea, then at work), a process two or three", () => {
  assert.equal(parseQuestionShape({ shape: "fact" }), "fact");
  assert.match(directQuestionInstruction("Why do we see lightning before we hear thunder?", { shape: "single" }), /plan TWO subtopics/);
  assert.match(directQuestionInstruction("What is the SI unit of force?", { shape: "fact" }), /exactly ONE subtopic/);
  assert.match(directQuestionInstruction("How does the heart pump blood?", { shape: "process" }), /TWO or THREE/);
  // A PDF question (no shape) keeps its one-board answer.
  assert.match(directQuestionInstruction("What does page 3 say about X?", {}), /exactly ONE subtopic/);
});

test("a diagram with words across its boxes or arrows through its words is caught; a labelled box is not", async () => {
  const { textCollisions } = await import("../diagrams/clutter");
  // The owner's screenshot: "Longer wavelength" across two boxes and the gap; an arrow through "absorbed energy".
  const box = (x: number) => ({ t: "path" as const, d: `M${x} 50 L${x + 190} 50 L${x + 190} 210 L${x} 210 Z` });
  const bad = { shapes: [box(40), box(330), { t: "text" as const, x: 300, y: 160, text: "Longer wavelength", size: 18, anchor: "middle" as const }, { t: "text" as const, x: 400, y: 260, text: "absorbed energy", size: 16, anchor: "middle" as const }, { t: "path" as const, d: "M300 160 L470 400" }] };
  assert.ok(textCollisions(bad).length >= 2);
  // Words inside their own boxes, clear of the borders: a clean block diagram.
  const good = { shapes: [box(40), box(330), { t: "text" as const, x: 135, y: 135, text: "Blue light", size: 18, anchor: "middle" as const }, { t: "text" as const, x: 425, y: 135, text: "Red light", size: 18, anchor: "middle" as const }, { t: "path" as const, d: "M232 130 L328 130" }] };
  assert.deepEqual(textCollisions(good), []);
});

test("a board of cards is laid out tidily: a chain when its arrows run in order, a grid otherwise, the writer's cells past six", async () => {
  const { tidyCards, tidyGrid } = await import("../canvas/layout");
  const card = (id: string, cell: string) => ({ id, kind: "box" as const, label: id, detail: `${id} detail`, cell, span: "1x1", s: 0 });
  const arrow = (from: string, to: string) => ({ id: `${from}-${to}`, from, to, s: 0 });
  // Temperature rises → activity rises → optimum → denaturation: a chain, in arrow order.
  const chain = tidyCards({ kind: "scene", items: [card("optimum", "F4"), card("rises", "A1"), card("activity", "C3"), card("denature", "B2")], arrows: [arrow("rises", "activity"), arrow("activity", "optimum"), arrow("optimum", "denature")] });
  assert.equal(chain?.arrangement, "chain");
  assert.deepEqual(chain?.nodes.map((n) => n.id), ["rises", "activity", "optimum", "denature"]);
  // Four factors around nothing in particular: an even grid, linked cards next to each other.
  const loose = { kind: "scene" as const, items: [card("a", "A1"), card("b", "F4"), card("c", "C2"), card("d", "E1")], arrows: [arrow("c", "d")] };
  assert.equal(tidyCards(loose), null);
  const grid = tidyGrid(loose);
  assert.deepEqual(grid.items.map((i) => i.cell), ["B1", "D1", "D3", "B3"]);
  // Seven cards keep the writer's cells: a 4-row grid cut their details to one word.
  const seven = { kind: "scene" as const, items: ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => card(id, `${"ABCDEF"[i % 6]}${1 + (i % 4)}`)), arrows: [] };
  assert.equal(tidyGrid(seven), seven);
});

test("a shape graph is described to the reviewer by its shape, never by coordinates", async () => {
  const { curveShape, boardReviewRequest } = await import("../canvas/boardReview");
  assert.match(curveShape("x < 6 ? x * x : 72 - 6 * x", 0, 12), /rises, then falls \(highest about 50% of the way along\)/);
  const spec = { v: 1, heading: "Temperature", notes: [], cues: [], stage: { kind: "graph", qualitative: true, x: { label: "Temperature", min: 0, max: 12 }, y: { label: "Rate of activity", min: 0, max: 40 }, curves: [{ id: "c", expr: "x < 6 ? x * x : 72 - 6 * x", s: 0 }], markers: [{ id: "m", x: "6", curve: "c", label: "Optimum", s: 1 }] } } as never;
  const told = boardReviewRequest(spec, { title: "Temperature", script: "Activity rises to an optimum, then falls." }, "Enzymes");
  assert.match(told, /SHAPE GRAPH with no numbers/);
  assert.doesNotMatch(told, /passes through/);
});

test("a figure comes back on a later board when that board teaches new parts of it, zoomed to them — never a plain repeat", async () => {
  const { figureComponent } = await import("../figures/registry");
  const enzyme = figureComponent("enzymeAction");
  if (!enzyme) return;
  const [p0, p1, p2] = enzyme.parts;
  const plan = [
    beat("b1", "Enzyme structure", "figure", `The ${p0.name} and the ${p1.name} are shown here.`, { figure: "enzymeAction" }),
    beat("b2", "What binds", "figure", `Now the ${p2?.name ?? p1.name} joins in.`, { figure: "enzymeAction" }),
    beat("b3", "Same again", "figure", `Again the ${p0.name}.`, { figure: "enzymeAction" }),
  ];
  const { beats, audit } = applyLessonVisualPolicy(plan, { mode: "prompt", aiPictures: false });
  if (!p2) return;
  assert.equal(beats[1].figure, "enzymeAction", audit.changes.join(" | "));
  assert.match(beats[1].brief, /zoom/);
  assert.notEqual(beats[2].figure, "enzymeAction", "a board with nothing new on the figure does not repeat it");
});

test("cards: an order card is built from a flow's own arrows; a tap card keeps its targets; hints and replays survive validation", async () => {
  const { orderCard, tapParts, boardElements } = await import("../canvas/cardKinds");
  const { validateInteraction } = await import("../canvas/validate");
  const node = (id: string, label: string, s: number) => ({ id, label, s });
  const flow = { v: 1, heading: "Enzyme action", notes: [{ id: "n1", text: "Lock and key", s: 0 }], cues: [], stage: { kind: "flow", arrangement: "chain", nodes: [node("c", "Complex forms", 1), node("a", "Substrate arrives", 0), node("p", "Products leave", 2)], arrows: [{ id: "x", from: "a", to: "c", s: 1 }, { id: "y", from: "c", to: "p", s: 2 }] } } as never;
  const card = orderCard(flow, "The substrate arrives. A complex forms. The products leave.");
  assert.equal(card?.mode, "order");
  assert.deepEqual(card?.steps?.map((s) => s.text), ["Substrate arrives", "Complex forms", "Products leave"]);
  assert.equal(card?.hint?.target, "a");
  // A flow whose arrows do not run through every step gets no order card.
  const broken = { ...(flow as object), stage: { ...(flow as { stage: object }).stage, arrows: [{ id: "x", from: "a", to: "c", s: 1 }] } } as never;
  assert.equal(orderCard(broken, ""), null);
  assert.deepEqual(boardElements(flow).map((e) => e.id), ["n1", "c", "a", "p"]);
  assert.equal(tapParts(flow).length, 0, "a flow is not tapped, it is ordered");
  const tap = validateInteraction({ kind: "quiz", mode: "tap", question: "Tap where the substrate binds", options: [{ text: "Active site", target: "active", correct: true, feedback: "Yes." }, { text: "Enzyme", target: "enzyme", correct: false, feedback: "That is the whole enzyme." }, { text: "Products", target: "products", correct: false, feedback: "Those leave after." }], hint: { text: "Look for the dip in the enzyme.", target: "n1" }, replay: { text: "The substrate fits the active site.", target: "active" } }) as { mode?: string; options: Array<{ target?: string }>; hint?: { text: string }; replay?: { target?: string } };
  assert.equal(tap.mode, "tap");
  assert.deepEqual(tap.options.map((o) => o.target), ["active", "enzyme", "products"]);
  assert.equal(tap.hint?.text, "Look for the dip in the enzyme.");
  assert.equal(tap.replay?.target, "active");
});
