/**
 * Finding the passage a PDF question is about.
 *
 * The reported failure: upload a KNN paper, ask "explain the formula on page 7", get a general
 * lecture about KNN with the formula never quoted. Every test here is a piece of that sentence.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePageRefs, wantedKind, scoreBlock, focusPassages, focusFromTranscript, focusPromptSection,
  focusedLectureTitle, focusedUserMessage, isPointingPhrase, isWeakSlideTitle, subjectFromFocus, FOCUS_RULES,
} from "../pdfFocus";
import type { SuprnotesContentBlock, SuprnotesLessonInput } from "../suprnotes";

/** A stand-in for the paper in the bug report. */
const block = (over: Partial<SuprnotesContentBlock>): SuprnotesContentBlock => ({
  id: over.id ?? "b", sourceOrder: 0, ...over,
});

const KNN_DOC: SuprnotesLessonInput = {
  contentBlocks: [
    block({ id: "b1", pageNumber: 1, sourceOrder: 1, heading: "Introduction",
            text: "K-nearest neighbours is a simple non-parametric classifier used widely in practice." }),
    block({ id: "b2", pageNumber: 2, sourceOrder: 2, heading: "Related work",
            text: "Earlier surveys compare instance-based learners across many benchmark datasets." }),
    block({ id: "b3", pageNumber: 7, sourceOrder: 3, heading: "Distance metric",
            text: "d(x, y) = sqrt( Σ_i (x_i − y_i)^2 ) where x and y are feature vectors and i indexes dimensions." }),
    block({ id: "b4", pageNumber: 7, sourceOrder: 4, heading: "Choosing k",
            text: "Small k gives a jagged boundary; large k oversmooths. Odd k avoids ties in binary problems." }),
    block({ id: "b5", pageNumber: 12, sourceOrder: 5, heading: "Results",
            rows: [["dataset", "accuracy"], ["iris", "0.96"]] }),
  ],
};

/* ── which page ──────────────────────────────────────────────────────────── */

test("page references are read the way people actually write them", () => {
  assert.deepEqual(parsePageRefs("explain the formula on page 7"), [7]);
  assert.deepEqual(parsePageRefs("what is on p.12?"), [12]);
  assert.deepEqual(parsePageRefs("see pg 3"), [3]);
  assert.deepEqual(parsePageRefs("pages 3-5 please"), [3, 4, 5]);
  assert.deepEqual(parsePageRefs("pages 2, 4 and 6"), [2, 4, 6]);
  assert.deepEqual(parsePageRefs("slide 4"), [4]);
});

test("a bare number is NOT a page", () => {
  // "explain k=5" must not pin the lecture to page 5 — the commonest way this kind of parser
  // silently answers a different question than the one asked.
  assert.deepEqual(parsePageRefs("explain k=5 and why odd values help"), []);
  assert.deepEqual(parsePageRefs("what does 0.96 accuracy mean"), []);
});

test("an absurd range is a misparse, not a request", () => {
  assert.deepEqual(parsePageRefs("pages 1-9999"), []);
});

/* ── which kind of thing ─────────────────────────────────────────────────── */

test("the question says what kind of thing it wants", () => {
  assert.equal(wantedKind("explain the formula on page 7"), "formula");
  assert.equal(wantedKind("walk me through the equation"), "formula");
  assert.equal(wantedKind("what does the table on p.12 show"), "table");
  assert.equal(wantedKind("describe figure 3"), "figure");
  assert.equal(wantedKind("teach me this paper"), null);
});

test("asking about a formula prefers the block that CONTAINS mathematics", () => {
  /*
   * The heart of the bug. A paragraph that says the word "formula" scored the same as the line that
   * is the formula, so the model had no reason to prefer the one the student meant.
   */
  const prose = block({ id: "p", text: "We now derive the distance formula used by the classifier." });
  const maths = block({ id: "m", text: "d(x, y) = sqrt( Σ_i (x_i − y_i)^2 )" });
  const q = ["distance", "formula"];
  assert.ok(scoreBlock(maths, q, "formula") > scoreBlock(prose, q, "formula"),
            "the prose about the formula outscored the formula itself");
});

/* ── finding the passage ─────────────────────────────────────────────────── */

test("the reported case: the formula on page 7 is found and quoted", () => {
  const focus = focusPassages("explain the formula on page 7", KNN_DOC)!;
  assert.ok(focus, "no passage found for the exact question from the bug report");
  assert.deepEqual(focus.pages, [7]);
  assert.equal(focus.passages[0].blockId, "b3", "the top passage is not the formula");
  assert.match(focus.passages[0].text, /d\(x, y\)/, "the formula's own text was not carried through");
});

test("a named page HARD-FILTERS — nothing from other pages leaks in", () => {
  // A well-written introduction on page 1 is not what "page 7" asked for, however well it scores.
  const focus = focusPassages("explain the formula on page 7", KNN_DOC)!;
  for (const p of focus.passages) assert.equal(p.pageNumber, 7, `page ${p.pageNumber} leaked in`);
});

test("everything on a named page is eligible, even with no shared vocabulary", () => {
  /*
   * "The formula on page 7" shares almost no words with the text of page 7. If a named page were
   * filtered by score as well, the passage would be dropped for having failed to repeat the
   * question back.
   */
  const focus = focusPassages("what is going on here on page 7", KNN_DOC)!;
  assert.ok(focus.passages.length >= 1, "a named page returned nothing");
  assert.ok(focus.passages.every((p) => p.pageNumber === 7));
});

test("a page the student does not have is REPORTED, not ignored", () => {
  const focus = focusPassages("explain the formula on page 99", KNN_DOC)!;
  assert.deepEqual(focus.missingPages, [99]);
  assert.match(focusPromptSection(focus), /page 99[\s\S]*not in what they uploaded/);
});

test("without a page, the question still finds its passage by content", () => {
  const focus = focusPassages("how do I choose k?", KNN_DOC)!;
  assert.ok(focus, "no passage for a content-only question");
  assert.equal(focus.passages[0].blockId, "b4");
});

test("a VAGUE question grounds nothing, so uploads are not all narrowed to one paragraph", () => {
  /*
   * The failure mode opposite to the bug: if grounding always fires, every upload becomes a lecture
   * about whichever paragraph scored highest, and "teach me this paper" stops working.
   */
  assert.equal(focusPassages("teach me this paper", KNN_DOC), null);
  assert.equal(focusPassages("", KNN_DOC), null);
  assert.equal(focusPassages("explain the formula on page 7", null), null);
  assert.equal(focusPassages("anything", { contentBlocks: [] }), null);
});

test("at most a handful of passages are pinned", () => {
  const many: SuprnotesLessonInput = {
    contentBlocks: Array.from({ length: 30 }, (_, i) =>
      block({ id: `x${i}`, pageNumber: 7, sourceOrder: i, text: "distance metric formula d(x,y) = 1" })),
  };
  const focus = focusPassages("explain the formula on page 7", many)!;
  assert.ok(focus.passages.length <= FOCUS_RULES.MAX_PASSAGES,
            `pinned ${focus.passages.length} passages — the grounding stops being pointed`);
});

/* ── what the model is told ──────────────────────────────────────────────── */

test("the prompt section states the passage IS the subject, and quotes it exactly", () => {
  const section = focusPromptSection(focusPassages("explain the formula on page 7", KNN_DOC));
  assert.match(section, /d\(x, y\) = sqrt/, "the formula is not in the prompt verbatim");
  assert.match(section, /explain the formula on page 7/, "the student's own question is missing");
  assert.match(section, /page 7/);
  assert.match(section, /Never paraphrase a formula/i);
  // The instruction that reverses the reported behaviour must be explicit, not implied.
  assert.match(section, /Do not write a broad introduction/i);
});

test("no focus means no grounding section at all", () => {
  assert.equal(focusPromptSection(null), "");
  assert.equal(focusPromptSection(focusPassages("teach me this paper", KNN_DOC)), "");
});


/* ── the override that reverses the reported behaviour ───────────────────── */

test("a focused question OVERRIDES the whole-document beat plan", () => {
  /*
   * The half of the fix that grounding alone does not achieve. The PDF contract orders one beat per
   * planned block, in order, covering the document — so pinning the passage while that contract
   * still stands produces a grounded survey, which is the reported bug with extra steps.
   */
  const focus = focusPassages("explain the formula on page 7", KNN_DOC)!;
  const msg = focusedUserMessage({ base: 'Teach this topic live: "KNN".', focus, documentJson: "{}" });

  assert.match(msg, /lessonPlan\/suggestedLecturePlan beat order and targetBeatCount DO NOT APPLY/);
  assert.match(msg, /Ignore them/);
  assert.match(msg, /not a syllabus to cover/);
  // The passage still has to be in there verbatim, above everything else.
  // The closing line is now "Answer now." — a focused request became a direct ANSWER rather than a
  // shortened lecture. The structural claim is unchanged: the passage precedes the instructions.
  assert.ok(msg.indexOf("d(x, y) = sqrt") < msg.indexOf("Answer now."),
            "the passage is not stated before the instructions that use it");
  assert.ok(msg.indexOf("Answer now.") > 0, "the closing instruction is missing entirely");
  assert.match(msg, /must appear in the lecture exactly as written/);
  /*
   * THIS ASSERTION WAS INVERTED ON PURPOSE.
   *
   * It used to require "AT LEAST 130 spoken words", because the depth guard rejected a focused PDF
   * lecture averaging under 125 and aiming at the boundary landed on both sides of it. That was the
   * right rule while a focused request still meant a shortened LECTURE.
   *
   * It no longer does. A focused request is now a direct ANSWER — someone asking how many
   * professors are in a list is owed a number, not five hundred words arriving at one. The guard was
   * taught the same shape (see assertInputLectureDepth's concise branch), so the two cannot
   * disagree; asking for 130 words here would now be the contradiction.
   */
  assert.match(msg, /2 to 3 teaching beats/);
  assert.match(msg, /180-260 spoken words/);
  assert.match(msg, /LEAD WITH THE ANSWER/);
  assert.match(msg, /GO DEEP/);
  // Neither the whole-document floor nor the over-corrected short one belongs here.
  assert.doesNotMatch(msg, /AT LEAST 130 spoken words/);
  assert.doesNotMatch(msg, /40-70 spoken words/);
});

test("the focused message leads with the passage, not the topic", () => {
  // Order matters: the model reads a topic line first and starts planning a survey around it.
  const focus = focusPassages("explain the formula on page 7", KNN_DOC)!;
  const msg = focusedUserMessage({ base: 'Teach this topic live: "KNN".', focus, documentJson: "{}" });
  assert.ok(msg.indexOf("THE STUDENT ASKED ABOUT ONE SPECIFIC THING") < msg.indexOf("Teach this topic live"),
            "the topic line comes before the question the student actually asked");
});


/* ── a transcript beats retrieval ────────────────────────────────────────── */

test("a TRANSCRIPT of the page becomes the passage, verbatim", () => {
  /*
   * The case retrieval cannot serve. `contentBlocks` come from the text objects a PDF declares; a
   * formula drawn as vector strokes or a figure pasted as an image leaves none behind, so the
   * content is absent from the haystack entirely. Reading the pixels is the only way to get it.
   */
  const read = "D_p(x,y) = \left( \sum_{i=1}^{n} |x_i - y_i|^p \right)^{1/p}";
  const focus = focusFromTranscript("explain this formula", read, [7])!;
  assert.ok(focus, "a transcript produced no focus");
  assert.equal(focus.passages.length, 1);
  assert.match(focus.passages[0].text, /sum_\{i=1\}\^\{n\}/, "the LaTeX was not carried through intact");
  assert.deepEqual(focus.pages, [7]);
  assert.match(focusPromptSection(focus), /D_p\(x,y\)/);
});

test("an empty transcript falls back rather than pinning nothing", () => {
  assert.equal(focusFromTranscript("explain this", "", [7]), null);
  assert.equal(focusFromTranscript("explain this", "   " + String.fromCharCode(10) + "  ", [7]), null);
});

test("a transcript with no question still has a subject", () => {
  // Selecting an area IS the question; requiring words as well would discard a clear request.
  const focus = focusFromTranscript("", "Table II: DT 0.7078 SVM 0.7013", [5])!;
  assert.ok(focus, "an area selected with no typed question produced no focus");
  assert.match(focus.question, /\S/);
});

test("a transcript gets more room than a retrieved block", () => {
  // It is one contiguous reading of what the student pointed at; truncating a formula's definitions
  // off the end of it defeats the point of having read them.
  const long = "y".repeat(FOCUS_RULES.MAX_PASSAGE_CHARS * 3);
  const focus = focusFromTranscript("explain", long, [1])!;
  assert.ok(focus.passages[0].text.length > FOCUS_RULES.MAX_PASSAGE_CHARS,
            "the transcript was cut to a single block's budget");
});

test("THE DELL FIXTURE: a two-page OCR upload narrows to node 2 deletion only", () => {
  const transcript = [
    "--- page 1 ---",
    "Figure 19.3 Deletion of node 5 with one child: (a) before and (b) after.",
    "If the node has only one child, adjust its parent's child link to bypass the node.",
    "",
    "--- page 2 ---",
    "Figure 19.4 Deletion of node 2 with two children: (a) before and (b) after.",
    "",
    "The complicated case deals with a node having two children. Replace the item in this node with the smallest item in the right subtree and then remove that node. We replace node 2 with the smallest node (3) in its right subtree and then remove 3 from the right subtree.",
    "",
    "19.1.2 C++ Implementation",
    "In principle, the binary search tree is easy to implement. The BinaryNode class keeps its fields private and uses a friend declaration.",
  ].join("\n");
  const focus = focusFromTranscript(
    "I am confused how does 2 node deletion work in a binary search tree",
    transcript,
  );
  assert.ok(focus);
  assert.deepEqual(focus.pages, [2], "the one-child page leaked into the focused answer");
  const answerSource = focus.passages.map((passage) => passage.text).join(" ");
  assert.match(answerSource, /smallest item in the right subtree/i);
  assert.match(answerSource, /replace node 2.*node \(3\)/i);
  assert.doesNotMatch(answerSource, /only one child|C\+\+ Implementation|friend declaration/i);
  assert.equal(focusedLectureTitle(focus), "Deletion of node 2 with two children");
});

test("a particular-example request retrieves that example rather than the selected-page survey", () => {
  const transcript = [
    "--- page 4 ---",
    "Definition: a binary search tree keeps smaller keys on the left.",
    "",
    "Worked Example: Delete node 2, which has two children.",
    "Replace 2 with the smallest key in its right subtree, node 3, then remove the old node 3.",
    "",
    "Complexity: deletion follows the height of the tree.",
  ].join("\n");
  const focus = focusFromTranscript("Explain this particular example", transcript)!;
  const selected = focus.passages.map((passage) => passage.text).join(" ");
  assert.match(selected, /Worked Example.*Delete node 2/i);
  assert.match(selected, /smallest key in its right subtree/i);
  assert.doesNotMatch(selected, /Definition:|Complexity:/i);
});

test("a particular-example request admits only one example when a page contains several", () => {
  const focus = focusFromTranscript(
    "Explain this particular example",
    [
      "--- page 5 ---",
      "Worked Example: Delete node 2 by replacing it with node 3.",
      "",
      "Worked Example: Delete leaf node 9 directly.",
    ].join("\n"),
  )!;
  const selected = focus.passages.map((passage) => passage.text).join(" ");
  assert.match(selected, /node 2/i);
  assert.doesNotMatch(selected, /node 9/i);
});

test("an approved focused plan is carried into generation without broadening the scope", () => {
  const focus = focusFromTranscript(
    "Explain this particular example",
    "Worked Example: Replace node 2 with node 3, then remove the old node 3.",
  )!;
  const msg = focusedUserMessage({
    base: 'Teach this topic live: "BST deletion".',
    focus,
    documentJson: "{}",
    outline: {
      topic: "Two-child deletion example",
      subtopics: [
        { title: "Identify the case", caption: "Establish why node 2 has two children." },
        { title: "Choose node 3", caption: "Trace the smallest key in the right subtree." },
      ],
    },
  });
  assert.match(msg, /QUESTION-SPECIFIC APPROVED PLAN/);
  assert.match(msg, /Identify the case/);
  assert.match(msg, /do not add any topic outside this plan/i);
});

test("raw figure/page locators are rejected as slide titles", () => {
  for (const title of ["Figure 19.4", "Fig. 3", "Page 2", "Slide 4", "?"]) {
    assert.equal(isWeakSlideTitle(title), true, `${title} should not reach the student`);
  }
  assert.equal(isWeakSlideTitle("Deletion of Node 2 with Two Children"), false);
});


/* ── a pointing phrase is not a topic ────────────────────────────────────── */

test("the words people type after drawing a box are recognised as POINTING", () => {
  /*
   * Reported verbatim: "if i select particular part and than in prompt explain me this it create a
   * lec on explain me this". The build screen said "Designing a live lesson on explain me this…".
   * Grounding was firing; the lecture was simply titled after a pronoun.
   */
  for (const phrase of [
    "explain me this", "explain this", "what is this", "explain this part",
    "tell me about this section", "what's this", "explain the highlighted region", "this",
    /*
     * Padded with fillers. "just explain me this eg" reached generation as a SUBJECT, so the lecture
     * came back titled "just explain me this eg" — every pointing word in it was already stripped,
     * and the two leftovers ("just", "eg") were enough to make it look like it named something.
     */
    "just explain me this eg", "pls explain this", "can you just explain this bit",
    "explain this thing quickly", "give me a bit more detail on this",
  ]) {
    assert.equal(isPointingPhrase(phrase), true, `"${phrase}" should be pointing`);
  }
});

test("a real subject is NOT treated as pointing", () => {
  // Overreaching here would throw away a perfectly good topic the student did supply.
  for (const phrase of [
    "explain the Minkowski distance formula",
    "what is the correlation between glucose and outcome",
    "explain this SMOTETomek resampling step",
    "how does k affect the decision boundary",
  ]) {
    assert.equal(isPointingPhrase(phrase), false, `"${phrase}" names a subject`);
  }
});

test("an empty prompt points at whatever was selected", () => {
  // "Select a region and press enter" — with no words at all, the region is the whole request.
  assert.equal(isPointingPhrase(""), true);
  assert.equal(isPointingPhrase("   "), true);
});

test("the subject is taken from what was READ, not from the phrase", () => {
  const focus = focusFromTranscript("explain me this",
    "--- page 4, selected region ---\nFeature Correlation Heatmap\nGlucose 0.47 Outcome", [4])!;
  const subject = subjectFromFocus(focus);
  assert.match(subject, /Feature Correlation Heatmap/);
  assert.doesNotMatch(subject, /page 4|-{3}/, "the transcript's own page marker leaked into the title");
});

test("a HEADING is preferred over a row of data", () => {
  /*
   * Taking the transcript's first line outright titled a lecture "Pregnancies Glucose
   * BloodPressure SkinThickness Insulin BMI DiabetesPedigreeFunction Age Outcome" — the matrix's
   * header row, seen on screen in a real run.
   */
  const focus = focusFromTranscript("explain this",
    ["--- page 4, selected region ---",
     "Pregnancies Glucose BloodPressure SkinThickness Insulin BMI DiabetesPedigreeFunction Age Outcome",
     "Feature Correlation Heatmap",
     "Glucose 0.13 1.00 0.22 0.19 0.22 0.28 0.15 0.27 0.47"].join(String.fromCharCode(10)), [4])!;
  assert.equal(subjectFromFocus(focus), "Feature Correlation Heatmap");
});

test("MARKUP is never chosen as the subject", () => {
  /*
   * Seen on screen: "Designing a live lesson on \begin{array}{l|l|l|}…". A transcribed table
   * starts with its own scaffolding, and a line that is mostly braces and pipes names nothing.
   */
  const focus = focusFromTranscript("explain this",
    ["--- page 2, selected region ---",
     "\begin{array}{l|l|l|}",
     "| Model | Accuracy |",
     "Ablation results by classifier",
     "\end{array}"].join(String.fromCharCode(10)), [2])!;
  const subject = subjectFromFocus(focus);
  assert.doesNotMatch(subject, /begin\{array\}/, `markup became the subject: ${subject}`);
  assert.match(subject, /Ablation results/);
});

test("no focus yields no subject, so the caller keeps what it had", () => {
  assert.equal(subjectFromFocus(null), "");
});
