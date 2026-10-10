import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canvasEngineFor, canvasPlanRequest, referenceDocumentOf, strictDocumentOf, videoDocumentOf } from "../canvas/lessonRequest";
import { codeSentenceBlocks, groundSourcePlan, strictBoardLines, ungroundedInPlan, videoBoardLines, videoForCanvas, videoParts, videoPlanSection } from "../canvas/sourceLessons";
import { documentForCanvas, documentListings, documentPageMap, substantivePages, uncoveredPages } from "../canvas/documentContext";
import { validatePlan } from "../canvas/plan";
import { buildLessonInputFromVideo, type VideoChapterNotes, type VideoWindow } from "../youtube/videoSource";
import { buildDocumentContext } from "../lessonChatContext";
import { DOCUMENT_LIMITS, exceedsTextLimit, tooMuchTextMessage } from "../documentLimits";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { SuprnotesLessonInput } from "../suprnotes";
import type { SourceScope } from "../sourceScope";

/*
 * STRICT PDFs AND VIDEOS ON THE CANVAS (lib/canvas/sourceLessons.ts), 2026-10-10. The AVL fixture is
 * the real parse of the student's chapter (pages 1 and 11-14), as in documentCanvas.test.ts.
 */
const avl = JSON.parse(readFileSync(join(process.cwd(), "lib", "anim", "fixtures", "avlCodePages.json"), "utf8")) as SuprnotesLessonInput;
const strict = (breadth: SourceScope["breadth"] = { kind: "whole" }): SourceScope => ({ breadth, fidelity: "strict", documentLabels: [] });

const lecture = (over: Partial<ProgressiveLectureInput> = {}): ProgressiveLectureInput => ({
  topic: "AVL Trees",
  mood: "",
  sourceType: "pdf",
  mode: "standard",
  learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" },
  suprnotes: avl,
  documentId: "doc-1",
  sourceScope: strict(),
  learnerPersona: "Loves cricket and bakes bread on weekends.",
  ...over,
});

/* ── routing ──────────────────────────────────────────────────────────────────────────────────── */

test("a strict PDF and a video go to the canvas; reference stays as it was; a boxed region and a deck do not", () => {
  assert.equal(canvasEngineFor(lecture(), {}), true);
  assert.ok(strictDocumentOf(lecture()));
  assert.equal(referenceDocumentOf(lecture()), null, "strict is not reference");
  assert.equal(strictDocumentOf(lecture({ sourceScope: { breadth: { kind: "whole" }, fidelity: "reference", documentLabels: [] } })), null);
  assert.equal(canvasEngineFor(lecture({ selection: { pages: [3], transcript: "", description: "this area" } }), {}), false);
  assert.equal(canvasEngineFor(lecture({ sourceType: "pptx" }), {}), false);
  assert.equal(canvasEngineFor(lecture(), { CANVAS_LECTURES: "0" }), false);
  assert.equal(canvasEngineFor(videoLecture(), {}), true);
  assert.ok(videoDocumentOf(videoLecture()));
  assert.equal(videoDocumentOf(lecture()), null);
});

/* ── the strict plan request ──────────────────────────────────────────────────────────────────── */

test("the strict planner reads every passage by id, the question, and the rule that strict limits content — not animation", () => {
  const request = canvasPlanRequest(lecture({ sourceScope: strict({ kind: "section", focus: "explain me deletion code" }), focus: "explain me deletion code" }));
  assert.match(request, /taught STRICTLY FROM IT/);
  assert.match(request, /Strict limits what is taught, never how well it is drawn/);
  assert.match(request, /The student asked: "explain me deletion code"/);
  assert.match(request, /ANSWERS ONE QUESTION: "explain me deletion code"/);
  assert.match(request, /\{p14-b2\}|LISTING 6 — Figure 4\.47[^\n]*\{p14-b5/, "passages and listings carry their block ids");
  assert.match(request, /"sentenceBlocks"/);
  assert.ok(request.includes("delete oldNode;"));
  assert.doesNotMatch(request, /cricket/, "a strict lesson brings in no persona interests");
  assert.doesNotMatch(request, /Answer it on ONE board/);
  const whole = canvasPlanRequest(lecture());
  assert.match(whole, /No question was asked: this lecture teaches ALL of the selected pages, in their order/);
});

test("the reference and typed-prompt requests are untouched by strict mode", () => {
  const reference = canvasPlanRequest(lecture({ sourceScope: { breadth: { kind: "whole" }, fidelity: "reference", documentLabels: [] } }));
  assert.doesNotMatch(reference, /STRICTLY|sentenceBlocks|\{p1[1-4]-b\d+\}/);
  assert.match(reference, /cricket/, "reference keeps the persona, as before");
  assert.equal(documentForCanvas(avl), documentForCanvas(avl, 60_000, {}), "block ids are off unless asked for");
  const prompt = canvasPlanRequest(lecture({ sourceType: "prompt", suprnotes: undefined, documentId: undefined, sourceScope: undefined }));
  assert.doesNotMatch(prompt, /STRICTLY|THE VIDEO|DOCUMENT/);
});

/* ── grounding the plan before any board is drawn ─────────────────────────────────────────────── */

test("a sentence bringing in outside material is deleted before the board is drawn, and each sentence keeps its passage", () => {
  const plan = validatePlan({
    beats: [{
      title: "The remove routine",
      stage: "code",
      objects: [],
      script: "The remove routine first checks whether t is a null pointer and returns. Banks in Paris store customer accounts in AVL trees every night. Otherwise it calls remove recursively on the left or right child. Finally it calls balance on t.",
      source: { pages: [14], listing: 6, lines: [7, 29], blocks: ["p14-b5", "nope"] },
      sentenceBlocks: ["p14-b6", "p14-b8", "p14-b8", "p14-b10"],
    }],
  })!;
  const grounded = groundSourcePlan(avl, plan.beats, "strict");
  const [beat] = grounded.beats;
  assert.equal(grounded.removed, 1);
  assert.doesNotMatch(beat.script, /Paris/);
  assert.equal(beat.sentenceBlocks!.length, 3, "one passage per remaining sentence");
  assert.deepEqual(beat.sentenceBlocks, ["p14-b6", "p14-b8", "p14-b10"], "the deleted sentence's passage went with it");
  assert.ok(beat.source!.blocks!.includes("p14-b5") && !beat.source!.blocks!.includes("nope"), "only real ids, plus the listing's");
  assert.ok(beat.source!.blocks!.includes("p14-b11"), "the listing's caption block too");
});

test("explaining code in words is not 'outside material'", () => {
  const plan = validatePlan({
    beats: [{
      title: "Single rotation",
      stage: "code",
      objects: [],
      script: "The routine rotate with left child receives the pointer k2 by reference. It stores k2's left child in a new pointer variable named k1. Then it updates both heights and returns k1 as the new root through the reference.",
      source: { pages: [13], listing: 4 },
    }],
  })!;
  const grounded = groundSourcePlan(avl, plan.beats, "strict");
  assert.equal(grounded.removed, 0, grounded.log.join(" | "));
  assert.equal(grounded.beats[0].sentenceBlocks!.length, 3);
});

test("a board with too little left speaks its passages' own sentences", () => {
  const plan = validatePlan({ beats: [{ title: "Intro", stage: "scene", objects: [], script: "Hogwarts wizards adore enchanted broomsticks daily. Dragons guard treasure inside volcanic caverns.", source: { pages: [1], blocks: ["p1-b4"] } }] })!;
  const grounded = groundSourcePlan(avl, plan.beats, "strict");
  assert.match(grounded.beats[0].script, /An AVL \(Adelson-Velskii and Landis\) tree is a binary search tree/);
  assert.ok(grounded.beats[0].sentenceBlocks!.every((id) => id === "p1-b4"));
});

test("a strict board reads its passages' exact text, and its code listing on a code board", () => {
  const code = strictBoardLines(avl, { stage: "code", source: { pages: [14], listing: 6, lines: [7, 29], blocks: ["p14-b5", "p14-b8"] } }).join("\n");
  assert.match(code, /THE CODE ON THIS BOARD is the student's own listing — LISTING 6/);
  assert.match(code, /THIS BOARD TEACHES these passages/);
  assert.match(code, /\{p14-b8\}/);
  assert.match(code, /as richly as any board/);
  assert.deepEqual(strictBoardLines(avl, { stage: "scene" }), []);
});

/* ── video ────────────────────────────────────────────────────────────────────────────────────── */

const notes = (title: string, startSec: number, points: string[]): VideoChapterNotes => ({
  chapter: { title, startSec, endSec: startSec + 120 },
  sections: [{ heading: title, points: points.map((text, i) => ({ text, startSec: startSec + i * 20 })) }],
  leftOut: [],
});
const WINDOWS: VideoWindow[] = [
  { startSec: 0, endSec: 240, segments: [{ startSec: 5, text: "Inorder visits the left subtree, then the node, then the right subtree." }, { startSec: 130, text: "Preorder visits the node first." }], onScreen: [{ startSec: 10, kind: "code", content: "void inorder(Node* n) { if (!n) return; inorder(n->left); visit(n); inorder(n->right); }" }] },
];
const video = buildLessonInputFromVideo({
  videoId: "abc12345678",
  url: "https://www.youtube.com/watch?v=abc12345678",
  title: "Tree traversals",
  durationSec: 240,
  chapters: [
    notes("Inorder traversal", 0, ["Inorder visits the left subtree first.", "Then it visits the node itself.", "Then it visits the right subtree."]),
    notes("Preorder traversal", 120, ["Preorder visits the node before its subtrees.", "It then visits the left subtree and the right subtree."]),
  ],
  windows: WINDOWS,
}).document;
function videoLecture(): ProgressiveLectureInput {
  return { ...lecture(), sourceType: "youtube", suprnotes: video, documentId: undefined };
}

test("a video is read part by part, with times, key-point ids and what was said and shown", () => {
  const parts = videoParts(video);
  assert.equal(parts.length, 2);
  const text = videoForCanvas(video);
  assert.match(text, /PART b1 — Inorder traversal \[0:00–2:00\]/);
  assert.match(text, /PART b2 — Preorder traversal \[2:00–4:00\]/);
  assert.match(text, /\{v1-s0-b1\}|\{v\d+-s\d+-b\d+\}/);
  assert.match(text, /void inorder\(Node\* n\)/, "code shown on screen reaches the planner");
  const section = videoPlanSection(video);
  assert.match(section, /Exactly 2 boards, b1 to b2, one per PART/);
  const request = canvasPlanRequest(videoLecture());
  assert.match(request, /THE VIDEO/);
  assert.doesNotMatch(request, /cricket/);
});

test("each video board is given its part's key points, and reads them with the stretch of the video", () => {
  const plan = validatePlan({
    beats: [
      { title: "Inorder", stage: "code", objects: [], script: "Inorder visits the left subtree first. Then it visits the node itself. Then it visits the right subtree." },
      { title: "Preorder", stage: "flow", objects: [], script: "Preorder visits the node before its subtrees. It then visits the left subtree and the right subtree." },
    ],
  })!;
  const grounded = groundSourcePlan(video, plan.beats, "video");
  assert.equal(grounded.removed, 0, grounded.log.join(" | "));
  assert.deepEqual(grounded.beats.map((b) => b.source!.blocks), videoParts(video).map((p) => p.sourceBlockIds));
  const lines = videoBoardLines(video, grounded.beats[0]).join("\n");
  assert.match(lines, /THIS BOARD TEACHES this part of the video/);
  assert.match(lines, /void inorder/);
});

/* ── the chat ─────────────────────────────────────────────────────────────────────────────────── */

test("a strict lesson's chat leads with the question, then the chosen pages, then the rest of the PDF", () => {
  const full = "[page 1] Trees are hierarchical.\n\n[page 2] AVL trees stay balanced.\n\n[page 3] Deletion calls balance.";
  const context = buildDocumentContext(avl, "", "", full, [], { question: "explain deletion", pages: [3] });
  const q = context.indexOf("THE STUDENT'S QUESTION");
  const focus = context.indexOf("FOCUS — the pages the student selected for this lesson (3)");
  const rest = context.indexOf("THE REST OF THE PDF");
  assert.ok(q === 0 && focus > q && rest > focus, context);
  assert.ok(context.indexOf("[page 3] Deletion calls balance.") < rest);
  assert.ok(context.indexOf("[page 1] Trees are hierarchical.") > rest);
  const all = buildDocumentContext(avl, "", "", full, [], { question: "", pages: [] });
  assert.match(all, /^THE WHOLE DOCUMENT \(every page is part of this lesson\)/);
  assert.equal(buildDocumentContext(avl, "", "", full, []), buildDocumentContext(avl, "", "", full), "without a focus nothing changes");
});

/* ── the 30,000-character limit ───────────────────────────────────────────────────────────────── */

test("a PDF over 30,000 characters is refused with the numbers", () => {
  assert.equal(DOCUMENT_LIMITS.MAX_PDF_TEXT_CHARS, 30_000);
  assert.equal(exceedsTextLimit(25_393), false, "the AVL chapter fits");
  assert.equal(exceedsTextLimit(30_000), false);
  assert.equal(exceedsTextLimit(30_001), true);
  assert.match(tooMuchTextMessage(41_250), /41,250 characters of text, and the limit is 30,000/);
});

test("on a code board the PDF box follows the lit lines down the printed listing", () => {
  const listing = documentListings(avl).find((l) => l.n === 6)!;
  assert.equal(listing.lineBlocks.length, 29);
  assert.equal(listing.lineBlocks[8], "p14-b6", "line 9 (the null check) is read from the table block starting at 9");
  assert.equal(listing.lineBlocks[11], "p14-b8", "line 12 (the comparisons) from the block starting at 12");
  assert.equal(listing.lineBlocks[27], "p14-b10", "line 28 (balance) from its own block");
  const code = {
    lines: ["void remove( const Comparable & x, AvlNode * & t )", "{", "    if( t == nullptr )", "        return; // Item not found; do nothing", "    if( x < t->element )", "        remove( x, t->left );"],
    steps: [{ s: 0, lines: [1] }, { s: 1, lines: [3, 4] }, { s: 2, lines: [5, 6] }],
  };
  const beat = { script: "The remove routine takes x and t. It first checks for a null pointer and returns. Then it compares x with the element and recurses left.", source: { pages: [14], listing: 6, lines: [7, 15] as [number, number] } };
  assert.deepEqual(codeSentenceBlocks(avl, beat, code), ["p14-b5", "p14-b6", "p14-b8"]);
  assert.equal(codeSentenceBlocks(avl, { script: "x.", source: { pages: [1] } }, code), null, "no listing, no mapping");
});

test("a code explanation in plain words ('smaller', 'the minimum', 'replaces') is grounded in the code it reads", () => {
  const plan = validatePlan({
    beats: [{
      title: "Deletion",
      stage: "code",
      objects: [],
      script: "When x is smaller than the element, it searches the left subtree. When the node has two children, it replaces its element with the minimum of the right subtree. Then it frees the old node and balances t.",
      source: { pages: [14], listing: 6, lines: [7, 29] },
    }],
  })!;
  assert.deepEqual(ungroundedInPlan(avl, plan.beats, "strict"), []);
  assert.equal(groundSourcePlan(avl, plan.beats, "strict").removed, 0);
});

test("only straying sentences are offered for a rewrite, each with its passages", () => {
  const plan = validatePlan({ beats: [{ title: "Deletion", stage: "code", objects: [], script: "The remove routine checks for a null pointer and returns. Spotify uses this to rank songs for listeners in Sweden.", source: { pages: [14], listing: 6 } }] })!;
  const flagged = ungroundedInPlan(avl, plan.beats, "strict");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].index, 1);
  assert.match(flagged[0].passages, /\{p14-b\d+\}/);
});

test("a passage spoken as the fallback has its LaTeX read as words", () => {
  const doc: SuprnotesLessonInput = { contentBlocks: [{ id: "p2-b1", pageNumber: 2, text: "The height of an empty tree is defined to be $-1$. The height is at most roughly $1.44 \\log(N + 2) - 1.328$." }] };
  const plan = validatePlan({ beats: [{ title: "Height", stage: "scene", objects: [], script: "Wizards ride enchanted brooms daily. Dragons hoard gold in caves.", source: { pages: [2], blocks: ["p2-b1"] } }] })!;
  const [beat] = groundSourcePlan(doc, plan.beats, "strict").beats;
  assert.doesNotMatch(beat.script, /\$|\\log/);
  assert.match(beat.script, /defined to be -1\. The height is at most roughly 1\.44 log\(N \+ 2\) - 1\.328\./);
});

test("a strict request has no lesson-history refresher", () => {
  const knowledge = { mastered: ["Binary search trees"], shaky: [{ label: "Recursion", for: "AVL trees" }], earlier: [{ label: "BST deletion", topic: "BSTs" }] };
  const request = canvasPlanRequest(lecture(), knowledge as never);
  assert.doesNotMatch(request, /WHAT THIS STUDENT ALREADY KNOWS|refresher/);
  const reference = canvasPlanRequest(lecture({ sourceScope: { breadth: { kind: "whole" }, fidelity: "reference", documentLabels: [] } }), knowledge as never);
  assert.match(reference, /WHAT THIS STUDENT ALREADY KNOWS/, "reference keeps it, as before");
});

test("with no question, a strict lecture must teach every selected page — a plan that skips one is caught", () => {
  assert.deepEqual(substantivePages(avl), [1, 11, 12, 13, 14]);
  const map = documentPageMap(avl);
  assert.deepEqual(map.find((p) => p.page === 14)!.listings, [5, 6]);
  const request = canvasPlanRequest(lecture());
  assert.match(request, /teaches ALL of the selected pages, in their order/);
  assert.match(request, /PAGE MAP \(the selected pages, in order\):\n- page 1/);
  assert.match(request, /- page 14[^\n]*\(code: LISTING 5, 6\)/);
  // A plan about the code alone leaves page 1 (what an AVL tree is) untaught.
  const codeOnly = [11, 12, 13, 14].map((p) => ({ source: { pages: [p] } }));
  assert.deepEqual(uncoveredPages(avl, codeOnly), [1]);
  assert.deepEqual(uncoveredPages(avl, [...codeOnly, { source: { pages: [], blocks: ["p1-b4"] } }]), [], "a passage on page 1 covers it");
  assert.deepEqual(uncoveredPages(avl, [{ source: { pages: [1], listing: 1 } }, { source: { pages: [12, 13, 14] } }]), [], "a listing covers its own page");
  // A question is answered, not surveyed: no page map.
  assert.doesNotMatch(canvasPlanRequest(lecture({ sourceScope: strict({ kind: "section", focus: "explain deletion" }) })), /PAGE MAP/);
});

test("a sentence the document says on another page is kept, and that page's passage joins the board", () => {
  const plan = validatePlan({
    beats: [{
      title: "Writing the routines",
      stage: "scene",
      objects: [],
      script: "We are ready to write the AVL routines, starting with the AvlNode class. The Adelson-Velskii and Landis condition keeps the depth of the tree O(logN). Penguins in Antarctica slide down icy hills for fun.",
      source: { pages: [11], blocks: ["p11-b12"] },
    }],
  })!;
  const grounded = groundSourcePlan(avl, plan.beats, "strict");
  const [beat] = grounded.beats;
  assert.equal(grounded.removed, 1, "only the penguins go");
  assert.match(beat.script, /Adelson-Velskii and Landis condition keeps the depth/);
  assert.ok(beat.source!.blocks!.includes("p1-b4"), "page 1's passage joins the board");
  assert.equal(beat.sentenceBlocks![1], "p1-b4", "and is what that sentence boxes");
  assert.equal(ungroundedInPlan(avl, plan.beats, "strict").length, 1);
});
