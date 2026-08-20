/**
 * Retrieval that keeps the rest of the document in view while the region stays the subject.
 *
 * All pure arithmetic over vectors, so none of it needs a key. The vectors here are hand-written
 * and tiny on purpose: a test whose expected value comes from the code it is testing proves nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  cosine, chunksFrom, rankChunks, contextPromptSection, RAG_RULES, type RagChunk,
} from "../ragRetrieve";
import type { SuprnotesLessonInput } from "../suprnotes";

/* ── the arithmetic ──────────────────────────────────────────────────────── */

test("cosine matches values worked out by hand", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  // [1,1] vs [1,0] is 45 degrees: cos 45 = 1/sqrt(2).
  assert.ok(Math.abs(cosine([1, 1], [1, 0]) - 1 / Math.SQRT2) < 1e-12);
  // Magnitude must not matter — only direction.
  assert.ok(Math.abs(cosine([3, 3], [1, 0]) - cosine([1, 1], [1, 0])) < 1e-12);
});

test("degenerate vectors give 0, never NaN", () => {
  // A NaN score sorts unpredictably and would silently scramble the ranking.
  for (const [a, b] of [[[0, 0], [1, 1]], [[1, 1], [0, 0]], [[], []], [[1, 2, 3], [1, 2]]]) {
    const score = cosine(a, b);
    assert.ok(Number.isFinite(score), `not finite for ${JSON.stringify([a, b])}`);
    assert.equal(score, 0);
  }
});

/* ── one shape for both formats ──────────────────────────────────────────── */

test("a PDF's blocks become labelled chunks", () => {
  const doc: SuprnotesLessonInput = {
    contentBlocks: [
      { id: "b1", pageNumber: 7, heading: "Distance", text: "d(x,y) is the Minkowski distance of order p between two feature vectors." },
      { id: "b2", pageNumber: 9, text: "Accuracy peaks near k = 7 on the iris dataset used throughout." },
      { id: "b3", pageNumber: 1, text: "tiny" },
    ],
  };
  const chunks = chunksFrom(doc, "");
  assert.deepEqual(chunks.map((c) => c.label), ["page 7", "page 9"]);
  assert.equal(chunks.length, 2, "a chunk too short to mean anything should be dropped");
});

test("a DECK's slide text becomes chunks with the same shape", () => {
  /*
   * The claim that this works for PowerPoint too. A deck with no embedded images never produces a
   * source document — it arrives as one string — and if it did not reduce to the same shape here,
   * "works for both" would need a second code path to drift out of sync.
   */
  const slides = [
    "Slide 1:\nFeature correlations across the benchmark dataset and their interpretation.",
    "Slide 2:\nGlucose shows the strongest association with the outcome variable overall.",
  ].join("\n");
  const chunks = chunksFrom(null, slides);
  assert.deepEqual(chunks.map((c) => c.label), ["slide 1", "slide 2"]);
  assert.match(chunks[1].text, /Glucose/);
});

test("nothing to retrieve from is not an error", () => {
  assert.deepEqual(chunksFrom(null, ""), []);
  assert.deepEqual(chunksFrom({ contentBlocks: [] }, ""), []);
});

/* ── ranking ─────────────────────────────────────────────────────────────── */

const chunk = (id: string, text = "some text long enough to survive the minimum length filter"): RagChunk =>
  ({ id, label: `page ${id}`, text });

test("the REGION drives retrieval when the question says almost nothing", () => {
  /*
   * The case that matters most. Once someone has drawn a box they type "explain this", which as a
   * query retrieves noise. The region's own text is the real query.
   */
  const chunks = [chunk("a"), chunk("b")];
  const vectors = [[1, 0], [0, 1]];
  const question = [0, 1];  // points at b
  const region = [1, 0];    // points at a

  const ranked = rankChunks(chunks, vectors, question, region);
  assert.equal(ranked[0].id, "a", "the question outvoted the region it was asked about");
});

test("with no region, the question alone ranks", () => {
  const ranked = rankChunks([chunk("a"), chunk("b")], [[1, 0], [0, 1]], [0, 1], null);
  assert.equal(ranked[0].id, "b");
});

test("with neither, nothing is retrieved rather than something arbitrary", () => {
  assert.deepEqual(rankChunks([chunk("a")], [[1, 0]], null, null), []);
});

test("unrelated chunks are left out instead of padding the prompt", () => {
  // An orthogonal chunk scores 0 — below the floor — and diluting the subject with it is worse
  // than sending nothing.
  const ranked = rankChunks([chunk("near"), chunk("far")], [[1, 0.05], [0, 1]], null, [1, 0]);
  assert.deepEqual(ranked.map((c) => c.id), ["near"]);
});

test("near-duplicates are collapsed", () => {
  /*
   * Papers repeat themselves — abstract, introduction and conclusion often say one sentence three
   * ways. Without this the top-k is three copies of one idea and the terms the region needs are
   * pushed out.
   */
  const chunks = [chunk("a1"), chunk("a2"), chunk("b")];
  const vectors = [[1, 0], [0.999, 0.01], [0.6, 0.8]];
  const ranked = rankChunks(chunks, vectors, null, [1, 0]);
  assert.equal(ranked.filter((c) => c.id.startsWith("a")).length, 1, "both copies were kept");
  assert.ok(ranked.some((c) => c.id === "b"), "the different idea was dropped");
});

test("the region's own chunks are excluded — it is already the subject", () => {
  // Retrieving the passage back as its own supporting context wastes a slot and reads as a stutter.
  const ranked = rankChunks([chunk("self"), chunk("other")], [[1, 0], [0.9, 0.1]], null, [1, 0], new Set(["self"]));
  assert.deepEqual(ranked.map((c) => c.id), ["other"]);
});

test("no more than TOP_K chunks come back", () => {
  /*
   * Each chunk shares a component with the query (so it clears the relevance floor) and has its own
   * private dimension (so no two look like duplicates of each other). A first attempt spread them
   * 0.05 radians apart in 2-D, which makes neighbours 0.999 similar — the duplicate filter collapsed
   * them and the test failed on behaviour that was entirely correct.
   */
  const n = 30;
  const many = Array.from({ length: n }, (_, i) => chunk(`c${i}`));
  const vectors = many.map((_, i) => {
    const v = new Array(n + 1).fill(0);
    v[0] = 0.5;        // shared with the query
    v[i + 1] = 0.866;  // unique to this chunk
    return v;
  });
  const query = [1, ...new Array(n).fill(0)];
  assert.equal(rankChunks(many, vectors, null, query).length, RAG_RULES.TOP_K);
});

test("mismatched vectors are refused rather than mis-ranked", () => {
  // Ranking chunk 3 by chunk 1's vector would be silently wrong, which is the worst kind.
  assert.deepEqual(rankChunks([chunk("a"), chunk("b")], [[1, 0]], null, [1, 0]), []);
});

/* ── what the model is told ──────────────────────────────────────────────── */

test("context is presented as SUPPORT, not as more syllabus", () => {
  /*
   * Six extra passages with no instruction is how a focused lecture drifts back into a survey —
   * the exact failure this feature exists to correct.
   */
  const section = contextPromptSection([
    { id: "b", label: "page 9", text: "Accuracy peaks near k = 7.", score: 0.5 },
  ]);
  assert.match(section, /SUPPORTING CONTEXT/);
  assert.match(section, /page 9/);
  assert.match(section, /Accuracy peaks near k = 7/);
  assert.match(section, /Do not teach these passages in their own right/i);
  assert.match(section, /do not\s*\n?\s*add beats to cover them/i);
});

test("no context means no section at all", () => {
  assert.equal(contextPromptSection([]), "");
});
