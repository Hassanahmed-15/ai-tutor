import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assignListings, BOARD_CODE_CHARS, boardListingText, documentBoardLines, documentForCanvas, documentListings, documentPagesText, extraBoardsForListings, faithfulCodeLines, listingText, numberedLines, overlongCodeBoards, wrapCodeLine } from "../canvas/documentContext";
import { canvasEngineFor, canvasPlanRequest, documentExtraBoards, referenceDocumentOf } from "../canvas/lessonRequest";
import { validatePlan } from "../canvas/plan";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { SuprnotesLessonInput } from "../suprnotes";

/*
 * A REFERENCE-MODE PDF ON THE CANVAS reads its document whole (lib/canvas/documentContext.ts).
 *
 * The fixture is the real parse of the AVL chapter the student uploaded (2026-10-10), pages 1 and
 * 11-14: the code pages exactly as /api/parse-pdf shredded them — one table row per line, several
 * lines run together in a paragraph, a lone number for a blank line, the caption glued on the end.
 */
const avl = JSON.parse(readFileSync(join(process.cwd(), "lib", "anim", "fixtures", "avlCodePages.json"), "utf8")) as SuprnotesLessonInput;

test("numbered lines are read back in order, blank lines kept", () => {
  assert.deepEqual(numberedLines("1 /** 2 * Return the height. 3 */ 4 int height( AvlNode *t ) const 5 {"), ["/**", "* Return the height.", "*/", "int height( AvlNode *t ) const", "{"]);
  assert.deepEqual(numberedLines("1 a; 2 3 b;"), ["a;", "", "b;"]);
  assert.deepEqual(numberedLines("no numbers here"), []);
});

test("every AVL listing is found whole: node, height, insert+balance, single and double rotation, remove", () => {
  const listings = documentListings(avl);
  assert.deepEqual(listings.map((l) => l.caption.match(/Figure 4\.\d+/)?.[0]), ["Figure 4.40", "Figure 4.41", "Figure 4.42", "Figure 4.44", "Figure 4.46", "Figure 4.47"]);
  assert.deepEqual(listings.map((l) => l.lines.length), [13, 7, 40, 14, 11, 29]);
  const all = listings.map((l) => l.lines.join("\n")).join("\n");
  for (const routine of ["struct AvlNode", "int height( AvlNode *t ) const", "void insert(", "void balance(", "rotateWithLeftChild( t );", "void rotateWithLeftChild(", "void doubleWithLeftChild(", "void remove(", "delete oldNode;"]) {
    assert.ok(all.includes(routine), routine);
  }
  // The table separators are gone, the code's own operators are not.
  const remove = listings[5];
  assert.equal(remove.lines[15], "else if( t->left != nullptr && t->right != nullptr ) // Two children");
  assert.equal(remove.lines[27], "balance( t );");
  // A table block carries its rows twice (text and rows); each line is read once.
  assert.equal(remove.lines[9], "return; // Item not found; do nothing");
  assert.equal(remove.lines[25], "}");
  assert.equal(listings[0].lines[5], "int height;");
  assert.equal(listings[2].lines[13], "insert( x, t->right );");
  assert.equal(listings[1].lines[5], "return t == nullptr ? -1 : t->height;");
});

test("a listing is written out with its printed numbers, whole or a range", () => {
  const [, height, insert] = documentListings(avl);
  assert.match(listingText(height), /^ 1 {2}\/\*\*\n 2 {2}\* Return the height/);
  const balance = listingText(insert, 19, 40).split("\n");
  assert.equal(balance.length, 22);
  assert.match(balance[0], /^19 {2}static const int ALLOWED_IMBALANCE = 1;/);
});

test("the planner's document holds every page, every listing whole, and no running heads", () => {
  const text = documentForCanvas(avl);
  for (const page of [1, 11, 12, 13, 14]) assert.ok(text.includes(`[page ${page}]`), `page ${page}`);
  for (const n of [1, 2, 3, 4, 5, 6]) assert.ok(text.includes(`LISTING ${n}`), `listing ${n}`);
  assert.ok(text.includes("29  }"), "the end of remove() survives");
  assert.ok(!/Chapter 4 Trees/.test(text), "the running head is dropped");
  assert.ok(text.includes("An AVL (Adelson-Velskii and Landis) tree is a binary search tree"));
});

test("over budget, prose is trimmed evenly and the listings stay whole", () => {
  const full = documentForCanvas(avl);
  const small = documentForCanvas(avl, 6_000);
  assert.ok(small.length < full.length);
  assert.ok(small.length <= 6_500, `${small.length}`);
  for (const n of [1, 2, 3, 4, 5, 6]) assert.ok(small.includes(`LISTING ${n}`), `listing ${n}`);
  assert.ok(small.includes("29  }"));
  assert.ok(small.includes("[page 1]") && small.includes("An AVL"), "the first page keeps its start");
});

test("a board's pages are just those pages", () => {
  const text = documentPagesText(avl, [14]);
  assert.ok(text.includes("[page 14]") && text.includes("LISTING"));
  assert.ok(!text.includes("[page 12]"));
  assert.equal(documentPagesText(avl, []), "");
});

test("long listings add boards so each fits a code board", () => {
  // insert+balance is 40 lines (34 after its doc comment: 3 boards), remove 29 (23: 2 boards).
  assert.equal(extraBoardsForListings(documentListings(avl)), 3);
});

/* ── a reference-mode PDF is taught on the canvas ─────────────────────────────────────────────── */

const lecture = (over: Partial<ProgressiveLectureInput> = {}): ProgressiveLectureInput => ({
  topic: "AVL Trees",
  mood: "",
  sourceType: "pdf",
  mode: "standard",
  learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" },
  suprnotes: avl,
  documentId: "doc-1",
  transcript: "ocr text of the scanned pages",
  sourceScope: { breadth: { kind: "section", focus: "explain me AVL code" }, fidelity: "reference", documentLabels: [] },
  focus: "explain me AVL code",
  ...over,
});

test("a PDF used as a reference goes to the canvas; a boxed region, other uploads and the switch do not", () => {
  assert.equal(canvasEngineFor(lecture(), {}), true);
  assert.equal(canvasEngineFor(lecture({ sourceScope: { breadth: { kind: "whole" }, fidelity: "reference", documentLabels: [] } }), {}), true);
  // Strict is on the canvas too since 2026-10-10 (lib/canvas/sourceLessons.ts), but not as reference.
  assert.equal(canvasEngineFor(lecture({ sourceScope: { breadth: { kind: "whole" }, fidelity: "strict", documentLabels: [] } }), {}), true);
  assert.equal(canvasEngineFor(lecture({ sourceScope: undefined }), {}), false);
  assert.equal(canvasEngineFor(lecture({ selection: { pages: [3], transcript: "", description: "this area" } }), {}), false);
  assert.equal(canvasEngineFor(lecture({ sourceType: "youtube" }), {}), false, "videos are not touched");
  assert.equal(canvasEngineFor(lecture({ sourceType: "pptx" }), {}), false);
  assert.equal(canvasEngineFor(lecture({ suprnotes: { contentBlocks: [] } }), {}), false, "an empty document is not a document");
  assert.equal(canvasEngineFor(lecture(), { CANVAS_LECTURES: "0" }), false);
  assert.equal(referenceDocumentOf(lecture({ sourceScope: { breadth: { kind: "whole" }, fidelity: "strict", documentLabels: [] } })), null);
});

test("the planner reads the whole document, every listing, and the rule that 'the code' means all of it", () => {
  const outline = { topic: "AVL Trees", scope: "question" as const, subtopics: ["Node", "Height", "Insert", "Balance", "Rotation", "Double rotation", "Remove"].map((title) => ({ title, caption: "" })) };
  const request = canvasPlanRequest(lecture({ outline }));
  assert.match(request, /exactly 7 boards, one per part/);
  assert.match(request, /takes CONSECUTIVE boards.*at most 3 extra boards/);
  assert.match(request, /THE STUDENT'S DOCUMENT/);
  assert.match(request, /Listing 6 \(page 14, "Figure 4\.47 Deletion in an AVL tree"\): 29 lines/);
  assert.match(request, /EVERY listing above that the question covers/);
  assert.match(request, /never rewritten in Python/);
  assert.ok(request.includes("delete oldNode;"), "the deletion code itself is in the request");
  assert.equal(documentExtraBoards(lecture({ outline })), 3);
  // A typed prompt's request is untouched.
  const prompt = canvasPlanRequest(lecture({ sourceType: "prompt", suprnotes: undefined, documentId: undefined, transcript: undefined, sourceScope: undefined, outline }));
  assert.doesNotMatch(prompt, /DOCUMENT|LISTING|CONSECUTIVE|source/);
  assert.equal(documentExtraBoards(lecture({ sourceType: "prompt" })), 0);
});

test("a plan's source survives validation only when it is real", () => {
  const board = (source: unknown) => ({ title: "The remove routine", script: "First sentence here. Second sentence here.", stage: "code", objects: [], source });
  const plan = validatePlan({ beats: [board({ pages: [14, 14, 0, "x"], listing: 6, lines: [7, 29] }), board({ pages: [], listing: null, lines: null }), board({ pages: [12], listing: 3, lines: [30, 19] })] })!;
  assert.deepEqual(plan.beats[0].source, { pages: [14], listing: 6, lines: [7, 29] });
  assert.equal(plan.beats[1].source, undefined);
  assert.deepEqual(plan.beats[2].source, { pages: [12], listing: 3 }, "a backwards range is dropped");
});

test("a code board is handed its listing to copy, and every board its pages", () => {
  const code = documentBoardLines(avl, { stage: "code", source: { pages: [14], listing: 6, lines: [7, 29] } }).join("\n");
  assert.match(code, /LISTING 6 \(Figure 4\.47 Deletion in an AVL tree\), printed lines 7 to 29/);
  assert.match(code, / 7 {2}void remove\( const Comparable & x, AvlNode \* & t \)/);
  assert.match(code, /29 {2}\}/);
  assert.doesNotMatch(code.split("printed lines 7 to 29")[1].split("What the student's document says")[0], /Internal method to remove/, "the range starts at line 7");
  assert.match(code, /What the student's document says on page 14/);
  const picture = documentBoardLines(avl, { stage: "scene", source: { pages: [1] } }).join("\n");
  assert.doesNotMatch(picture, /THE CODE ON THIS BOARD/);
  assert.match(picture, /page 1/);
  assert.deepEqual(documentBoardLines(avl, { stage: "scene" }), [], "no source, nothing added");
});

test("a line too long for a code board reaches the board model already broken, never mid-word", () => {
  const ctor = "AvlNode( const Comparable & ele, AvlNode *lt, AvlNode *rt, int h = 0 )";
  const parts = wrapCodeLine(ctor);
  assert.deepEqual(parts, ["AvlNode( const Comparable & ele, AvlNode *lt, AvlNode *rt,", "int h = 0 )"]);
  assert.ok(parts.every((p) => p.length <= BOARD_CODE_CHARS));
  assert.deepEqual(wrapCodeLine("return t == nullptr ? -1 : t->height;"), ["return t == nullptr ? -1 : t->height;"]);
  const [node] = documentListings(avl);
  const text = boardListingText(node, 8, 9).split("\n");
  assert.equal(text.length, 3, "line 8 is broken in two, line 9 fits");
  assert.match(text[0], /^ 8 {2}AvlNode\( const Comparable/);
  assert.match(text[1], /^ {8}int h = 0 \)$/, "the continuation has no printed number and one more level");
  assert.match(text[2], /^ 9 {2}: element\{ ele \}/);
});

test("the planner is told never to read line numbers aloud, and never to split a statement", () => {
  const request = canvasPlanRequest(lecture());
  assert.match(request, /NEVER say a line number aloud/);
  assert.match(request, /never between an if or else and the line it controls/);
});

test("a code board that cannot hold its listing sends the plan back; one that can, does not", () => {
  // The run of 2026-10-10: remove() (lines 7-29) planned on one board lost its closing call to balance.
  const whole = overlongCodeBoards(avl, [{ id: "b8", stage: "code", source: { pages: [14], listing: 6 } }]);
  assert.equal(whole.length, 1);
  assert.match(whole[0], /b8 shows LISTING 6 lines 1 to 29: \d+ lines/);
  assert.deepEqual(overlongCodeBoards(avl, [
    { id: "b8", stage: "code", source: { pages: [14], listing: 6, lines: [7, 17] } },
    { id: "b9", stage: "code", source: { pages: [14], listing: 6, lines: [18, 29] } },
    { id: "b1", stage: "code", source: { pages: [11], listing: 1 } },
    { id: "b2", stage: "scene", source: { pages: [2] } },
  ]), [], "split pieces, a node struct that fits, and a picture board are all fine");
  assert.match(overlongCodeBoards(avl, [{ id: "b3", stage: "code" }])[0], /names no LISTING/);
});

test("a token the board model changed while copying is put back, its indentation kept", () => {
  const [node] = documentListings(avl);
  const copied = [
    "    AvlNode( Comparable && ele, AvlNode *lt, AvlNode *rt,",
    "        int h = 0 )",
    "        : element{ std::move( ele ) }, left{ lt }, right{ lt },",
    "        height{ h } { }",
    "};",
  ];
  const { lines, fixed } = faithfulCodeLines(copied, node, 11, 13);
  assert.equal(fixed, 1);
  assert.equal(lines[2], "        : element{ std::move( ele ) }, left{ lt }, right{ rt },");
  assert.deepEqual(lines.filter((_, i) => i !== 2), copied.filter((_, i) => i !== 2), "every other line is untouched");
  const untouched = faithfulCodeLines(["int height( AvlNode *t ) const", "{", "    return t == nullptr ? -1 : t->height;", "}"], documentListings(avl)[1], 4, 7);
  assert.equal(untouched.fixed, 0);
});

test("a line only a little too long is not broken just to strand a parenthesis", () => {
  assert.deepEqual(wrapCodeLine("if( height( t->right->right ) >= height( t->right->left ) )"), ["if( height( t->right->right ) >= height( t->right->left ) )"]);
});

test("a code board the plan left without its listing is given the one it is about", () => {
  const board = (title: string, script: string, source?: { pages: number[]; listing?: number; lines?: [number, number] }) => ({ stage: "code" as const, title, brief: "", script, ...(source ? { source } : {}) });
  const { beats, assigned } = assignListings(avl, [
    board("Node Declaration for AVL Trees", "Every node stores its element, two child pointers and its height."),
    board("Single Rotation Routine", "rotateWithLeftChild lifts k1 above k2."),
    board("Double Rotation Routine", "doubleWithLeftChild first rotates the left child, then the root."),
    board("Deletion in an AVL Tree", "Deletion finds the item, removes it, then calls balance on the way back."),
    board("Deletion in an AVL Tree, continued", "The node with two children takes the smallest item of its right subtree."),
    board("Insertion", "insert walks down", { pages: [12], listing: 3, lines: [1, 17] }),
  ]);
  assert.equal(assigned, 5);
  assert.deepEqual(beats.map((b) => b.source?.listing), [1, 4, 5, 6, 6, 3]);
  // The two deletion boards share remove() out, cut where a statement ends.
  const [a, b] = [beats[3].source!.lines!, beats[4].source!.lines!];
  assert.equal(a[0], 1);
  assert.equal(b[1], 29);
  assert.equal(b[0], a[1] + 1);
  assert.deepEqual(overlongCodeBoards(avl, beats.map((x, i) => ({ id: `b${i + 1}`, ...x }))), [], "every piece now fits");
});

test("a plan's source is read however the model wrote its numbers", () => {
  const board = (source: unknown) => ({ title: "Deletion", script: "First sentence here. Second sentence here.", stage: "code", objects: [], source });
  const plan = validatePlan({ beats: [board({ pages: ["14"], listing: "LISTING 6", lines: "7-17" }), board({ pages: 12, listing: 3 })] })!;
  assert.deepEqual(plan.beats[0].source, { pages: [14], listing: 6, lines: [7, 17] });
  assert.deepEqual(plan.beats[1].source, { pages: [12], listing: 3 });
});
