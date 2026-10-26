import test from "node:test";
import assert from "node:assert/strict";
import { CODE_FLOOR_SIZE, fitValue, layoutPanel } from "../canvas/layout";
import { CODE_LINE_MAX, codeLine, validateCanvasSpec } from "../canvas/validate";
import { dsaTeachingProblem, edgeKey, isDataStructureTopic, isGraphAlgorithmTopic, layoutStructure, parseOps, parseStructure, runStructure } from "../canvas/structure";
import { lineReferenceIssues } from "../canvas/cardKinds";
import { isTypedDsaTopic } from "../canvas/csLessons";
import { cardQuestions, GOAL_TAB, MEANING_TAB, type IntakePart } from "../intake";
import { cardChecksVoiceLine } from "../planningFeedback";
import type { CanvasBoardSpec, DsStart, QuizInteraction } from "../canvas/types";

/* visual-clarity-labels-DSA (owner, 2026-10-23): text that fits, DSA boards that show what they say, the card. */

// ── 1. text fits its area ──────────────────────────────────────────────────────────────────────

test("a long variable value fits its room: one line if it can, else two lines broken after a comma", () => {
  assert.deepEqual(fitValue("[A, B]", 300, 36), { lines: ["[A, B]"], size: 16 });
  // The owner's screenshot: a colours dictionary that ran off the board.
  const colours = "{Lahore: 0, Karachi: 1, Islamabad: 1, Multan: None}";
  const fit = fitValue(colours, 290, 36);
  assert.equal(fit.lines.length, 2);
  assert.ok(fit.lines.every((l) => l.length * 0.6 * fit.size <= 290), `each line fits: ${JSON.stringify(fit)}`);
  assert.equal(fit.lines.join(" "), colours, "nothing is lost: the break is at a comma's space");
  assert.ok(fit.size >= 9);
});

test("a code line is kept whole when the board can draw it, and never cut mid-word when it cannot", () => {
  const ok = "graph = {Lahore: [Karachi, Islamabad], Karachi: [Lahore, Multan]}";
  assert.equal(codeLine(ok), ok);
  const long = "graph = {Lahore: [Karachi, Islamabad], Karachi: [Lahore, Multan], Islamabad: [Lahore], Multan: [Karachi]}";
  const cut = codeLine(long);
  assert.ok(cut.length <= CODE_LINE_MAX, cut);
  assert.ok(cut.endsWith(" …"), "a cut line says so");
  assert.ok(!/Islama …|Isla …/.test(cut), `never mid-word: ${cut}`);
});

test("a long line beside a structure: the code card is wide enough for its text, and never overlaps the structure", () => {
  const spec = validateCanvasSpec({
    heading: "BFS colouring",
    notes: [],
    stage: {
      kind: "code", language: "python",
      lines: ["graph = {A: [B, C], B: [A, D], C: [A, D], D: [B, C], E: [D, F]}", "color = {}", "queue = [A]", "color[A] = 0", "while queue:", "    v = queue.pop(0)"],
      structure: { kind: "graph", nodes: [{ id: "a", value: "A" }, { id: "b", value: "B" }, { id: "c", value: "C" }, { id: "d", value: "D" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }] },
      steps: [{ s: 0, lines: [1], ops: [] }, { s: 1, lines: [4], ops: [{ op: "group", id: "a", group: 0 }] }, { s: 2, lines: [6], ops: [{ op: "group", id: "b", group: 1 }] }],
    },
  }, 3);
  assert.ok(spec && spec.stage.kind === "code");
  const layout = layoutPanel(spec);
  const code = layout.marks.find((m) => m.type === "code") as unknown as { rect: { x: number; w: number }; size: number; gutter: number; lines: string[] };
  const structure = layout.marks.find((m) => m.type === "structure") as unknown as { rect: { x: number } };
  const longest = Math.max(...code.lines.map((l) => l.length));
  assert.ok(code.size >= CODE_FLOOR_SIZE);
  assert.ok(code.gutter + 14 + longest * 0.6 * code.size <= code.rect.w + 1, `text ${code.gutter + 14 + longest * 0.6 * code.size} fits card ${code.rect.w} at ${code.size}px`);
  assert.ok(code.rect.x + code.rect.w <= structure.rect.x, "code and structure never overlap");
});

// ── 2. DSA boards draw what Aria says ──────────────────────────────────────────────────────────

const graph = (): DsStart => parseStructure({
  kind: "graph",
  nodes: ["A", "B", "C", "D", "E"].map((v) => ({ id: v.toLowerCase(), value: v })),
  edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }, { from: "c", to: "e" }, { from: "d", to: "e" }],
})!;

test("two-colouring: a vertex is put in Set A or Set B, and a same-set edge is marked a conflict", () => {
  const ops = parseOps([{ op: "group", id: "a", group: 0 }, { op: "color", id: "b", set: "B" }, { op: "edge", from: "a", to: "b", as: "tree" }]);
  assert.deepEqual(ops.map((o) => o.op), ["group", "group", "edge"]);
  const steps = [
    { s: 1, ops: ops.slice(0, 1) },
    { s: 2, ops: ops.slice(1) },
    { s: 3, ops: parseOps([{ op: "group", id: "d", group: 0 }, { op: "group", id: "c", group: 1 }, { op: "group", id: "e", group: 1 }, { op: "edge", from: "e", to: "c", as: "conflict" }]) },
  ];
  const { frames, problem } = runStructure(graph(), steps);
  assert.equal(problem, null);
  assert.deepEqual(frames[1].groups, { a: 0 });
  assert.deepEqual(frames[2].groups, { a: 0, b: 1 }, "a set stays from step to step");
  assert.equal(frames[2].edgeMarks[edgeKey("graph", undefined, "a", "b")], "tree");
  // Undirected: "e → c" is the edge c – e.
  assert.equal(frames[3].edgeMarks[edgeKey("graph", undefined, "c", "e")], "conflict");
  // Marking an edge that is not there is a problem the writer is told about.
  const bad = runStructure(graph(), [{ s: 1, ops: parseOps([{ op: "edge", from: "a", to: "e", as: "conflict" }]) }]);
  assert.match(bad.problem ?? "", /no edge/);
});

test("a pointer set to None is drawn pointing at null, beside the list", () => {
  const list = parseStructure({ kind: "list", nodes: [{ id: "n1", value: 1 }, { id: "n2", value: 2 }, { id: "n3", value: 3 }], edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }], pointers: [{ name: "prev", to: null }, { name: "curr", to: "n1" }] })!;
  const steps = [
    { s: 1, ops: parseOps([{ op: "link", from: "n1", to: "n2" }, { op: "unlink", from: "n1", to: "n2" }]) },
    { s: 2, ops: parseOps([{ op: "point", name: "prev", to: "n1" }, { op: "point", name: "curr", to: null }]) },
  ];
  const { frames, problem } = runStructure(list, steps);
  assert.equal(problem, null);
  assert.deepEqual(frames[0].nulls, ["prev"], "prev = None at the start is on the board");
  assert.deepEqual(frames[2].nulls, ["curr"], "and curr = None at the end");
  const layout = layoutStructure(list, frames, { x: 0, y: 0, w: 500, h: 300 });
  assert.equal(layout.frames[0].nulls?.[0]?.name, "prev");
  assert.ok((layout.frames[0].nulls?.[0]?.at.x ?? 0) > 0);
});

test("a board that says colours but never draws them, or flips a link only in words, is sent back", () => {
  const said = ["We start BFS at A and give it color 0.", "Its neighbours B and C get the opposite colour, color 1."];
  assert.match(dsaTeachingProblem(graph(), [{ s: 0, ops: [] }, { s: 1, ops: [] }], said) ?? "", /group/);
  assert.equal(dsaTeachingProblem(graph(), [{ s: 0, ops: parseOps([{ op: "group", id: "a", group: 0 }]) }], said), null);
  const list = parseStructure({ kind: "list", nodes: [{ id: "n1", value: 1 }, { id: "n2", value: 2 }], edges: [{ from: "n1", to: "n2" }] })!;
  const flip = ["Now curr.next = prev, so node 1 points back to None."];
  assert.match(dsaTeachingProblem(list, [{ s: 0, ops: parseOps([{ op: "point", name: "curr", to: "n1" }]) }], flip) ?? "", /link/);
  assert.equal(dsaTeachingProblem(list, [{ s: 0, ops: parseOps([{ op: "unlink", from: "n1", to: "n2" }]) }], flip), null);
});

test("graph algorithms the shared list misses count as DSA for typed prompts only", () => {
  assert.equal(isDataStructureTopic("BFT in Bipartite Graphs"), false, "the shared detector (PDF, video, course) is unchanged");
  assert.equal(isGraphAlgorithmTopic("BFT in Bipartite Graphs"), true);
  assert.equal(isTypedDsaTopic("How can we detect if a graph is bipartite"), true);
  assert.equal(isTypedDsaTopic("Reversing a linked list"), true);
  assert.equal(isTypedDsaTopic("Graph of y = x squared"), false, "a function's graph is maths");
});

// ── 3. a check card names only lines on its board ──────────────────────────────────────────────

test("a card naming a line the board does not show is sent back", () => {
  const spec = { heading: "Reverse", notes: [], stage: { kind: "code", language: "python", lines: ["prev = None", "curr = head", "while curr:", "    nxt = curr.next", "    curr.next = prev"], steps: [{ s: 0, lines: [1] }] } } as unknown as CanvasBoardSpec;
  const card = (q: string) => ({ kind: "quiz", question: q, options: [{ text: "1", correct: true, feedback: "" }, { text: "2", correct: false, feedback: "" }, { text: "None", correct: false, feedback: "" }] }) as unknown as QuizInteraction;
  assert.equal(lineReferenceIssues(card("After line 5 runs, what does curr.next hold?"), spec).length, 0);
  assert.match(lineReferenceIssues(card("After line 6 (prev, curr = curr, nxt) runs, what does curr hold?"), spec)[0] ?? "", /only 5 lines/);
});

// ── 4. the question card, as Claude asks ───────────────────────────────────────────────────────

test("the card: Which one first (when ambiguous), the parts (loading while written), the checks, then the goal", () => {
  const loading = cardQuestions({ parts: [], known: [], loadingParts: true });
  assert.deepEqual(loading.map((q) => q.id), ["parts"]);
  assert.equal(loading[0].loading, true);
  const parts: IntakePart[] = [
    { id: "part-1", label: "BFS order", about: "visiting vertices level by level", check: { question: "In BFS, which structure holds the waiting vertices?", options: ["A stack", "A queue", "A tree"], answer: 1 } },
    { id: "part-2", label: "Two colours", check: null },
  ];
  const full = cardQuestions({ parts, known: ["part-1"], meaning: { question: "Which do you mean?", options: ["Graph theory", "Matching"] }, goal: { question: "What is it for?", options: ["An exam", "Writing the code"] } });
  assert.deepEqual(full.map((q) => q.id), [MEANING_TAB, "parts", "check-part-1", GOAL_TAB]);
  assert.equal(full[1].options[0].description, "visiting vertices level by level", "a part's line is shown under it");
});

test("after Submit, a right check is praised and a wrong one corrected with the right answer", () => {
  const parts = [
    { id: "p1", check: { question: "In BFS, which structure holds the waiting vertices?", options: ["A stack", "A queue", "A tree"], answer: 1 } },
    { id: "p2", check: { question: "In a bipartite graph, where can an edge go?", options: ["Within a set", "Between the sets", "Anywhere"], answer: 1 } },
  ];
  const line = cardChecksVoiceLine(parts, { p1: "right", p2: "wrong" }, { p1: "A queue", p2: "Within a set" });
  assert.match(line, /Right: "In BFS/);
  assert.match(line, /they chose "Within a set", but the answer is "Between the sets"/);
  assert.equal(cardChecksVoiceLine(parts, { p1: "unsure", p2: "unsure" }, {}), "", "not sure is not judged");
});

test("a board's variables panel holds at most five variables over all its steps", async () => {
  const { capStateNames } = await import("../canvas/validate");
  const steps = [
    { s: 0, lines: [1], state: [{ name: "INF", value: "∞" }, { name: "dist", value: "[0, ∞]" }, { name: "unvisited", value: "[A, B]" }] },
    { s: 1, lines: [2], state: [{ name: "u", value: "A" }, { name: "v", value: "B" }, { name: "w", value: "4" }, { name: "candidate", value: "0 + 4" }] },
  ];
  const capped = capStateNames(steps);
  const names = new Set(capped.flatMap((st) => (st.state ?? []).map((v) => v.name)));
  assert.deepEqual([...names], ["INF", "dist", "unvisited", "u", "v"]);
});
