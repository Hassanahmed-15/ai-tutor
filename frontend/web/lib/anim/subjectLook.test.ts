import test from "node:test";
import assert from "node:assert/strict";
import { isLabLookTopic } from "../canvas/subjectLook";

test("maths and computer-science lectures get the lab look; every other subject keeps its own", () => {
  for (const t of ["Pythagoras' theorem and its proof", "Completing the square", "Solving quadratic equations", "Recursion in Python", "While loops", "Binary search", "Logic gates and truth tables", "Dijkstra's algorithm", "Converting denary to hexadecimal"]) assert.equal(isLabLookTopic(t), true, t);
  for (const t of ["Photosynthesis", "How does the human heart pump blood", "Fall of the Roman Empire", "How do vaccines work?", "Newton's second law", "Balancing chemical equations", "How do volcanoes erupt"]) assert.equal(isLabLookTopic(t), false, t);
});

test("a maths or CS lecture gets no generated picture; the same board elsewhere still can", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const mk = () => ({ id: "b1", title: "What a CPU looks like", script: "A CPU is a small chip on the motherboard with thousands of pins underneath.", stage: "illustration", brief: "What a CPU looks like", objects: [], inside: null, carry: [], interaction: null, overview: false }) as never;
  const plain = applyLessonVisualPolicy([mk()], { mode: "prompt", aiPictures: true });
  assert.equal(plain.beats[0].stage, "illustration", "without a maths/CS topic the picture is allowed");
  const cs = applyLessonVisualPolicy([mk()], { mode: "prompt", aiPictures: true, topic: "How a CPU runs a program" });
  assert.notEqual(cs.beats[0].stage, "illustration", "in a CS lecture it is drawn by code instead");
});

test("a misspelt maths topic is still a maths lecture once the planner's board titles are read", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const mk = (id: string, title: string, stage: string) => ({ id, title, script: `${title}. A short explanation.`, stage, brief: title, objects: [], inside: null, carry: [], interaction: null, overview: false }) as never;
  const out = applyLessonVisualPolicy([mk("b1", "Right-angled triangles and the hypotenuse", "illustration"), mk("b2", "Squares on each side", "flow"), mk("b3", "Finding a missing side with the theorem", "equation")], { mode: "prompt", aiPictures: true, topic: "pythogaras theorm" });
  assert.ok(!out.beats.some((b) => b.stage === "illustration"), "no generated picture");
  assert.ok(out.beats.some((b) => b.stage === "sketch"), out.beats.map((b) => b.stage).join(","));
});

test("maths/CS boards: exact figures first, a graph for 'graphical meaning', never an essay figure (QA batches 1–2)", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const mk = (title: string, script: string) => ({ id: "b1", title, script, stage: "flow", brief: title, objects: [], inside: null, carry: [], interaction: null, overview: false }) as never;
  const route = (topic: string, title: string, script: string) => { const b = applyLessonVisualPolicy([mk(title, script)], { mode: "prompt", aiPictures: true, topic }).beats[0]; return `${b.stage}${b.figure ? `:${b.figure}` : ""}`; };
  assert.equal(route("Probability tree diagrams", "Building the tree", "A probability tree diagram shows two coin tosses. Each branch has probability one half. The first toss splits into heads and tails, and each splits again, giving four paths."), "figure:probabilityTree");
  assert.equal(route("Vectors in two dimensions", "Scaling and reversing vectors", "Multiplying a vector by a scalar changes its magnitude. If b = (−2, 5), then 3b = (−6, 15). The vector −b points the opposite way."), "equation:vectors", "its working (3b = (−6, 15)) is written beside the vector figure (2026-10-22)");
  assert.equal(route("Simultaneous linear equations", "The graphical meaning", "Each linear equation is a straight line on a coordinate grid. The lines 2x + y = 11 and x − y = 1 cross at (4, 3), the solution."), "sketch");
  assert.equal(route("Logic gates and truth tables", "AND, OR and NOT gates", "An AND gate outputs 1 only when both inputs are 1. An OR gate outputs 1 when at least one input is 1."), "figure:logicCircuit", "logic gates get the exact gate figure, drawn by code");
});

test("more maths topics are recognised; other subjects still are not", () => {
  for (const t of ["Complex numbers", "Venn diagrams and sets", "Permutations and combinations", "The normal distribution", "Standard deviation", "Prime factors", "Similar triangles", "Proof by induction", "Matrices and determinants"]) assert.equal(isLabLookTopic(t), true, t);
  for (const t of ["The Industrial Revolution", "Osmosis in plant cells", "Ionic bonding", "Climate change", "Shakespeare's Macbeth"]) assert.equal(isLabLookTopic(t), false, t);
});

test("maths benchmark routing: named points are plotted; trees get the tree; flows stay flows otherwise", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const mk = (id: string, title: string, stage: string, script: string, figure?: string) => ({ id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: null, overview: false, ...(figure ? { figure, plannedFigure: figure } : {}) }) as never;
  const route = (topic: string, beat: never) => { const b = applyLessonVisualPolicy([beat], { mode: "prompt", aiPictures: true, topic }).beats[0] as { stage: string; figure?: string }; return `${b.stage}${b.figure ? `:${b.figure}` : ""}`; };
  assert.equal(route("Vectors: proving three points are collinear", mk("b1", "Recognising collinear points", "figure", "With A(1,2), B(3,5), and C(5,8), AB = (2,3) and BC = (2,3), so A, B and C are collinear.", "vectors")), "equation:coordinateGrid", "the points plotted, the working (AB = (2,3), BC = (2,3)) written beside them");
  assert.equal(route("Conditional probability with tree diagrams", mk("b1", "Building a probability tree", "flow", "A bag has 3 red and 2 blue counters. The first branches are red 3/5 and blue 2/5; each splits again.")), "figure:probabilityTree");
  assert.equal(route("Proof of Pythagorean Theorem", mk("b1", "The route through the proofs", "flow", "We will first identify the triangle parts, then ask how similar shapes prove it, then areas and algebra.")), "flow");
  const { figureComponent } = await import("../figures/registry");
  const v = figureComponent("vectors")!.build({ a: "3,2", components: true, ticks: true });
  const texts = v.shapes.filter((s) => s.t === "text").map((s) => String((s as { text: unknown }).text));
  assert.ok(!texts.includes("4") && !texts.includes("6") || texts.length < 12, "no axis numbers beside the components");
});
