import test from "node:test";
import assert from "node:assert/strict";
import { linesSaid, sentenceFocus } from "../pdfSentenceFocus";
import { assignFigures, documentFigures, figureBoardLines, figureIndex, printedFigureName, speakableFigureRefs } from "../canvas/pdfFigures";
import { applyCoverage, coverBoard, coverageRequests, splicedRewrite, spokenCoverage } from "../canvas/boardCoverage";
import { blockingTextRegions, withFigureLabels } from "../pdfFigureBox";
import { documentSections, inPageOrder } from "../canvas/documentContext";
import { applyGlobalSourceOrder, runningFurniture, structurePdfPage } from "../pdfLessonPipeline";
import { profileFromIntake } from "../intake";
import { validClosing, withClosing, writeClosing } from "../canvas/closingWords";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { validatePlan } from "../canvas/plan";
import { validateCanvasSpec } from "../canvas/validate";
import type { SuprnotesLessonInput } from "../suprnotes";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";

/*
 * PDF LESSONS, 2026-11-25 (owner): a reference PDF shows its own cropped figures on the boards that teach
 * them; strict mode never does, and its PDF panel highlights exactly the lines being read, or boxes the
 * figure being explained; non-maths/CS PDFs get the course board types; whatever is on a board is said.
 */

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const TREE_DOC: SuprnotesLessonInput = {
  schemaVersion: "suprnotes.lesson_input.v1",
  lesson: { title: "Data Structures.pdf" },
  contentBlocks: [
    { id: "p1-b1", type: "caption", role: "caption", pageNumber: 1, text: "Figure 19.3 Deletion of node 5 with one child: (a) before and (b) after." },
    {
      id: "p1-b2", type: "paragraph", role: "paragraph", pageNumber: 1,
      text: "If a node has one child, it can be removed by having its parent bypass it. The root is a special case because it does not have a parent.",
      bbox: { x: 0.1, y: 0.6, width: 0.8, height: 0.06 },
      lines: [
        { text: "If a node has one child, it can be removed by having its", bbox: { x: 0.1, y: 0.6, width: 0.8, height: 0.018 } },
        { text: "parent bypass it. The root is a special case because it", bbox: { x: 0.1, y: 0.62, width: 0.8, height: 0.018 } },
        { text: "does not have a parent.", bbox: { x: 0.1, y: 0.64, width: 0.3, height: 0.018 } },
      ],
    },
  ],
  assets: [
    { id: "p1-figure-2", type: "image", url: PNG, pageNumber: 1, caption: "Figure 19.3 Deletion of node 5 with one child: (a) before and (b) after.", description: "Two binary search trees: node 5 with child 3, then 3 attached to 2.", bbox: { x: 0.05, y: 0.34, width: 0.58, height: 0.2 } },
    { id: "p1-figure-1", type: "image", url: PNG, pageNumber: 1, caption: "Figure 19.2 Binary search trees before and after the insertion of 6.", description: "Two trees rooted at 7.", bbox: { x: 0.07, y: 0.1, width: 0.56, height: 0.17 } },
    { id: "p2-table", type: "table", url: PNG, pageNumber: 2, caption: "Table 19.1 Costs", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 } },
    { id: "p3-page", type: "image", url: PNG, pageNumber: 3, caption: "Whole page", bbox: { x: 0, y: 0, width: 1, height: 0.95 } },
    { id: "p4-none", type: "image", pageNumber: 4, caption: "No crop kept" },
  ],
};

const beat = (id: string, over: Partial<CanvasPlanBeat>): CanvasPlanBeat => ({
  id, title: "", script: "One. Two.", stage: "structure", brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false, ...over,
});

// ---- the strict panel: lines and figures --------------------------------------------------------

test("a sentence lights up only the printed lines it says, not the whole paragraph", () => {
  const lines = TREE_DOC.contentBlocks![1].lines!;
  assert.deepEqual(linesSaid(lines, "The root is a special case, because it does not have a parent."), [1, 2]);
  assert.deepEqual(linesSaid(lines, "A node with one child is removed by having its parent bypass it."), [0, 1]);
  assert.deepEqual(linesSaid(lines, "Photosynthesis needs light."), []);
});

test("the strict panel boxes the figure a sentence explains, and highlights lines otherwise", () => {
  const figure = sentenceFocus(TREE_DOC, "p1-b1", "Figure 19.3 shows node 5 being deleted: before in (a) and after in (b).", [1]);
  assert.equal(figure?.kind, "figure");
  assert.deepEqual(figure && figure.kind === "figure" ? figure.rect : null, TREE_DOC.assets![0].bbox);
  const lines = sentenceFocus(TREE_DOC, "p1-b2", "The root is a special case because it does not have a parent.", [1]);
  assert.equal(lines?.kind, "lines");
  assert.equal(lines && lines.kind === "lines" ? lines.rects.length : 0, 2);
  // A passage with no line boxes (an older upload) keeps the passage's own box: null.
  const old: SuprnotesLessonInput = { ...TREE_DOC, contentBlocks: [{ ...TREE_DOC.contentBlocks![1], lines: undefined }] };
  assert.equal(sentenceFocus(old, "p1-b2", "The root is a special case because it does not have a parent.", [1]), null);
});

test("a figure's printed labels box the drawing they label", () => {
  const doc: SuprnotesLessonInput = {
    contentBlocks: [{ id: "p2-b4", role: "figure-labels", pageNumber: 2, text: "Diagram labels: nucleus, cell wall", labelRegions: [
      { text: "nucleus", bbox: { x: 0.5, y: 0.3, width: 0.1, height: 0.02 } },
      { text: "cell wall", bbox: { x: 0.2, y: 0.5, width: 0.1, height: 0.02 } },
    ] }],
  };
  const f = sentenceFocus(doc, "p2-b4", "The nucleus sits inside the cell wall.", [2]);
  assert.equal(f?.kind, "figure");
  assert.equal(f?.pageNumber, 2);
});

// ---- reference crops on the board ----------------------------------------------------------------

test("only real figure crops are offered: no tables, whole pages or figures without a crop", () => {
  const figures = documentFigures(TREE_DOC);
  assert.deepEqual(figures.map((f) => f.assetId), ["p1-figure-1", "p1-figure-2"], "page order, top to bottom");
  assert.deepEqual(figures.map((f) => f.id), ["F1", "F2"]);
  const index = figureIndex(figures);
  assert.match(index, /\[F2\] page 1 — Figure 19\.3/);
  assert.match(index, /"figure": "F2"/);
  assert.equal(figureIndex([]), "");
});

test("the planner's source.figure is read, and that board shows the crop", () => {
  const plan = validatePlan({ title: "BST", beats: [
    { title: "Deleting a node with one child", stage: "structure", script: "Look at the figure. Node 5 has one child.", source: { pages: [1], figure: "f2" } },
    { title: "Code", stage: "code", script: "Here is remove. It recurses.", source: { pages: [2], figure: "F1" } },
  ] });
  assert.ok(plan);
  assert.equal(plan!.beats[0].source?.figure, "F2");
  const { beats } = assignFigures(plan!.beats, documentFigures(TREE_DOC));
  assert.equal(beats[0].stage, "illustration");
  assert.equal(beats[0].pdfFigure?.assetId, "p1-figure-2");
  assert.equal(beats[1].stage, "code", "a code board never takes a figure");
  assert.equal(beats[1].pdfFigure, undefined);
});

test("a figure the planner left out goes to the board that teaches its page and words, never a structure board", () => {
  const figures = documentFigures(TREE_DOC);
  const beats = [
    beat("b1", { title: "Inserting 6 into the tree", stage: "flow", script: "We insert 6 into the binary search tree rooted at 7. Six goes right of 5.", source: { pages: [1] } }),
    beat("b2", { title: "Deleting node 5 with one child", stage: "structure", script: "Node 5 has one child, 3. Its parent bypasses it.", source: { pages: [1] } }),
  ];
  const out = assignFigures(beats, figures);
  assert.equal(out.beats[0].pdfFigure?.id, "F1");
  assert.equal(out.beats[1].pdfFigure, undefined, "a drawn structure is kept unless the planner chose the figure");
  assert.ok(out.log.some((l) => /F1/.test(l)));
  assert.match(figureBoardLines(out.beats[0].pdfFigure!).join(" "), /cropped from page 1/);
  // A planner that chose a figure left the others out on purpose: no fallback then.
  const chosen = assignFigures([{ ...beats[0], source: { pages: [1], figure: "F2" } }, beat("b3", { title: "Inserting 6", stage: "flow", script: "We insert 6 into the binary search tree rooted at 7. Six goes right.", source: { pages: [1] } })], figures);
  assert.equal(chosen.beats[0].pdfFigure?.id, "F2");
  assert.equal(chosen.beats[1].pdfFigure, undefined);
});

test("the visual policy keeps a figure board as an illustration, in reference and course-look lessons alike", () => {
  const figureBeat = beat("b1", { title: "Deleting node 5", stage: "illustration", script: "Node 5 goes. Its child moves up.", pdfFigure: { id: "F2", assetId: "p1-figure-2", pageNumber: 1, caption: "Figure 19.3", description: "" }, visualType: "concept" });
  for (const options of [{ mode: "reference" as const, topic: "BST deletion" }, { mode: "reference" as const, topic: "The spread of Islam", courseBoards: true }]) {
    const out = applyLessonVisualPolicy([figureBeat, beat("b2", { title: "Routes", stage: "flow", script: "Trade carried it. Rulers carried it.", visualType: "sequence" })], options);
    assert.equal(out.beats[0].stage, "illustration");
    assert.ok(out.beats[0].pdfFigure);
  }
});

test("a non-maths, non-CS PDF in the course look gets the course board types", () => {
  const out = applyLessonVisualPolicy([
    beat("b1", { title: "Routes of spread", stage: "flow", script: "Islam spread by trade. It spread by conquest.", visualType: "sequence" }),
    beat("b2", { title: "The Alhambra", stage: "scene", script: "This is the Alhambra palace. Its courts are famous.", visualType: "thing" }),
  ], { mode: "strict", topic: "Spread of Islam in Europe and Asia", courseBoards: true, aiPictures: true });
  assert.ok(out.beats.every((b) => b.course), "course boards: the marker writes them");
  assert.equal(out.beats[0].written, true, "a sequence is Aria's notes written as she says them");
  assert.equal(out.beats[1].stage, "illustration", "something to SEE gets a picture");
  // Without the option a strict lesson is unchanged.
  const plain = applyLessonVisualPolicy([beat("b1", { title: "Routes of spread", stage: "flow", script: "Islam spread by trade. It spread by conquest." })], { mode: "strict", topic: "Spread of Islam" });
  assert.equal(plain.beats[0].course, undefined);
  assert.equal(plain.beats[0].stage, "flow");
});

// ---- a PDF lecture ends, it does not stop -------------------------------------------------------------

test("the last board closes with two sentences, once, and a bad closing falls back to the plain one", async () => {
  const boards = [{ title: "Bypassing a node", script: "Node 5 has one child, 3. Its parent 2 bypasses it." }];
  const good = await writeClosing(async () => ({ json: { closing: ["You can now delete a node in any of the three cases.", "Nicely done — a short check comes next when you're ready."] }, costUsd: 0.0002 }), { topic: "BST deletion", boards, strict: false });
  assert.equal(good.fallback, false);
  assert.equal(good.closing.length, 2);
  // A number the lesson never said, a question, or a list of three sentences is refused.
  assert.equal(validClosing({ closing: ["There are 7 cases.", "Well done."] }, "Node 5 has one child, 3."), null);
  assert.equal(validClosing({ closing: ["You learned deletion.", "Ready for a check?"] }, ""), null);
  const bad = await writeClosing(async () => { throw new Error("down"); }, { topic: "BST deletion", boards, strict: true });
  assert.equal(bad.fallback, true);
  assert.match(bad.closing[0], /end of BST deletion/);
  const once = withClosing("It works. It is fast.", good.closing);
  assert.equal(withClosing(once, good.closing), once, "a board written again is not closed twice");
  assert.ok(once.endsWith("ready."));
});

// ---- whatever is on the board is said ---------------------------------------------------------------

const board = (notes: Array<{ s: number; text: string }>, labels: string[]): CanvasBoardSpec =>
  validateCanvasSpec({
    heading: "Routes of spread",
    notes: notes.map((n, i) => ({ id: `n${i}`, ...n })),
    stage: { kind: "flow", nodes: labels.map((label, i) => ({ id: `p${i}`, label, s: i })), arrows: labels.slice(1).map((_, i) => ({ from: `p${i}`, to: `p${i + 1}`, s: i + 1 })) },
    cues: [],
  }, 12)!;

test("coverage counts what is on the board that the narration says", () => {
  const spec = board([{ s: 0, text: "Trade routes" }, { s: 1, text: "Sufi missionaries" }], ["Arabia", "Persia", "Spain"]);
  const script = "Islam spread from Arabia along trade routes. It reached Persia. Then it reached Spain.";
  const c = spokenCoverage(spec, script);
  assert.equal(c.items, 5);
  assert.equal(c.said, 4);
  assert.deepEqual(c.unsaid.map((u) => u.text), ["Sufi missionaries"]);
  assert.deepEqual(coverageRequests(c.unsaid, 3), [{ s: 1, items: ["Sufi missionaries"] }]);
});

test("a rewrite is used only when it says the item, keeps its numbers and stays one sentence", () => {
  const script = "It reached Persia in 651. Then it reached Spain.";
  const asked = [{ s: 0, items: ["Sufi missionaries"] }];
  assert.equal(applyCoverage(script, asked, [{ i: 0, text: "Sufi missionaries carried it to Persia in 651." }]).rewritten, 1);
  assert.equal(applyCoverage(script, asked, [{ i: 0, text: "Sufi missionaries carried it to Persia." }]).rewritten, 0, "a number was lost");
  assert.equal(applyCoverage(script, asked, [{ i: 0, text: "It reached Persia in 651. Missionaries helped." }]).rewritten, 0, "two sentences");
});

test("a board under the target: unsaid notes come off first, with no words spliced into Aria's sentences", async () => {
  const spec = board([{ s: 0, text: "Trade routes" }, { s: 1, text: "Sufi missionaries" }, { s: 2, text: "Tolerance of other faiths" }], ["Arabia", "Persia", "Spain"]);
  const script = "Islam spread from Arabia along trade routes. It reached Persia. Then it reached Spain.";
  let called = 0;
  const out = await coverBoard(async () => { called++; return { json: {}, costUsd: 0 }; }, spec, script);
  assert.ok(out.before.share < 0.8);
  assert.equal(called, 0, "notes alone never cost a rewrite");
  assert.deepEqual(out.removed, ["Sufi missionaries", "Tolerance of other faiths"], "a note never said comes off");
  assert.equal(out.script, script, "her words are untouched");
  assert.equal(out.after.share, 1);
});

test("an unsaid diagram label is named only by a natural rewrite; a spliced one is refused", async () => {
  const spec = board([], ["Arabia", "Persia", "Spain", "Sicily", "Crete"]);
  const script = "Islam spread from Arabia. It reached Persia. Then it reached Spain.";
  const spliced = await coverBoard(async () => ({ json: { sentences: [{ i: 2, text: "Then it reached Spain, and this part here is the Sicily and Crete." }] }, costUsd: 0 }), spec, script);
  assert.equal(spliced.rewritten, 0, "a tacked-on pointing clause is refused");
  assert.equal(spliced.script, script);
  const natural = await coverBoard(async () => ({ json: { sentences: [{ i: 2, text: "Then it reached Spain, Sicily and Crete." }] }, costUsd: 0 }), spec, script);
  assert.equal(natural.rewritten, 1);
  assert.equal(natural.after.share, 1);
  assert.ok(splicedRewrite("Electric impulses form here.", "Electric impulses form as this creates electric impulses."), "a word said twice is spliced");
});

test("a figure's crop takes its labels and caption, never the page's prose", () => {
  const blocks = [
    { id: "p1-b1", role: "paragraph", pageNumber: 1, text: "The ear has three parts. Sound enters the outer ear and travels down the ear canal.", bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.08 }, lines: [{ text: "The ear has three parts. Sound enters the outer ear and travels down", bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.02 } }, { text: "the ear canal.", bbox: { x: 0.1, y: 0.12, width: 0.2, height: 0.02 } }] },
    { id: "p1-b2", role: "paragraph", pageNumber: 1, text: "Eardrum Cochlea", bbox: { x: 0.62, y: 0.32, width: 0.15, height: 0.1 }, lines: [{ text: "Eardrum", bbox: { x: 0.62, y: 0.32, width: 0.1, height: 0.02 } }, { text: "Cochlea", bbox: { x: 0.62, y: 0.4, width: 0.1, height: 0.02 } }] },
    { id: "p1-b3", role: "caption", pageNumber: 1, text: "Figure 1: The parts of the ear", bbox: { x: 0.2, y: 0.53, width: 0.4, height: 0.02 } },
  ];
  const blockers = blockingTextRegions(blocks as never);
  assert.equal(blockers.length, 1, "only the prose blocks the crop; labels and caption are the figure's");
  const grown = withFigureLabels({ x: 0.2, y: 0.25, width: 0.4, height: 0.26 }, blocks as never);
  assert.ok(grown.x + grown.width >= 0.72, "the labels beside the drawing are inside the crop");
  assert.ok(grown.y + grown.height >= 0.55, "so is its caption");
  assert.ok(grown.y > 0.14, "the paragraph above is not");
});

test("the planner's figure ids are never spoken, but a document's own F1 is kept", () => {
  const figures = documentFigures(TREE_DOC);
  assert.equal(speakableFigureRefs("Look at Figure F2 now.", figures), "Look at Figure 19.3 now.");
  assert.equal(speakableFigureRefs("As F1 (F1) shows, it grows.", figures), "As Figure 19.2 shows, it grows.");
  assert.equal(speakableFigureRefs("The F1 generation is tall.", figures, "Crossing gives the F1 generation."), "The F1 generation is tall.");
  assert.equal(printedFigureName({ caption: "Parts of the ear" }), "the figure");
});

test("a whole-document lesson keeps the document's page order; a PDF lesson generates no picture", () => {
  const order = inPageOrder([beat("b1", { source: { pages: [2] } }), beat("b2", { source: { pages: [1] } }), beat("b3", {}), beat("b4", { source: { pages: [1] } })]);
  assert.ok(order.moved);
  assert.deepEqual(order.beats.map((b) => b.id), ["b2", "b3", "b4", "b1"], "a board with no page stays with the one before it (b3 after b2)");
  const out = applyLessonVisualPolicy([
    beat("b1", { title: "The ear", stage: "illustration", script: "The ear collects sound. It funnels it inward." }),
    beat("b2", { title: "Ear figure", stage: "illustration", script: "Look at the ear. Its drum vibrates.", pdfFigure: { id: "F1", assetId: "a", pageNumber: 1, caption: "Figure 1", description: "" } }),
  ], { mode: "reference", topic: "Hearing", aiPictures: false, noPictures: true });
  assert.notEqual(out.beats[0].stage, "illustration", "no generated picture in a PDF lesson");
  assert.equal(out.beats[1].stage, "illustration", "its own figure stays");
  assert.equal(out.audit.illustrations, 1);
});

test("a document-type page header is not a topic", () => {
  const doc = { lesson: { title: "Hearing.pdf" }, contentBlocks: [
    { id: "a", heading: "Fact Sheet", text: "x" }, { id: "b", heading: "How we hear", text: "y" }, { id: "c", heading: "Hearing", text: "z" }, { id: "d", heading: "Protecting your hearing", text: "w" },
  ] } as SuprnotesLessonInput;
  assert.deepEqual(documentSections(doc), ["How we hear", "Protecting your hearing"]);
});

test("a covered board stays covered", async () => {
  // A board already said in full is left alone, with no call made.
  let called = false;
  const full = await coverBoard(async () => { called = true; return { json: {}, costUsd: 0 }; }, board([], ["Arabia", "Persia"]), "It began in Arabia. It grew into Persia.");
  assert.equal(called, false);
  assert.equal(full.after.share, 1);
});

// ---- re-test 2026-11-25: page furniture, two-line titles, column order, "shaky" ---------------------------

const span = (text: string, x: number, top: number, fontSize = 11, width = text.length * 5.5) => ({ text, x, top, width, height: fontSize * 1.2, fontSize });
const twoColumnPage = (pageNumber: number) => {
  const spans = [
    span("Fact Sheet", 30, 20, 20), span("For Grades 6-8", 420, 20, 20),
    span("How does the", 30, 80, 24), span("brain work?", 30, 110, 24),
    span("Visit Dana.org", 450, 760, 10),
  ];
  // Left column: the opening; right column: what comes after it. Both start at the same height.
  for (let i = 0; i < 6; i++) spans.push(span(`Left column opening sentence number ${i + 1} reads first.`, 30, 160 + i * 15, 11, 250));
  for (let i = 0; i < 6; i++) spans.push(span(`Right column later sentence number ${i + 1} reads after.`, 320, 160 + i * 15, 11, 250));
  return { spans, pageNumber, pageWidth: 600, pageHeight: 800 };
};

test("running headers and footers are left out, a two-line title is one heading, and columns keep their order", () => {
  const pages = [twoColumnPage(1), twoColumnPage(2)];
  const furniture = runningFurniture(pages);
  assert.ok(furniture.has("fact sheet") && furniture.has("for grades") && furniture.has("visit dana org"));
  const blocks = pages.flatMap((p) => structurePdfPage(p.spans, p.pageNumber, p.pageWidth, p.pageHeight, furniture));
  applyGlobalSourceOrder(blocks);
  blocks.sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  const all = blocks.map((b) => `${b.heading} ${b.text}`).join(" ");
  assert.ok(!/Fact Sheet|For Grades|Dana/.test(all), "no header or footer text");
  assert.equal(blocks[0].heading, "How does the brain work?");
  const first = blocks.filter((b) => b.pageNumber === 1);
  assert.match(first[0].text ?? "", /^Left column/, "the left column is read first, though both start at the same height");
  // A one-page document keeps its top band: nothing repeats, nothing is dropped.
  assert.equal(runningFurniture([twoColumnPage(1)]).size, 0);
});

test("a part the student marked new is not 'shaky'", () => {
  const profile = profileFromIntake("Hearing", [{ label: "Ears", status: "new" }, { label: "Sound", status: "shaky" }, { label: "Brain", status: "known" }]);
  assert.deepEqual(profile.weakConcepts, ["Sound"]);
  assert.deepEqual(profile.masteredConcepts, ["Brain"]);
});
