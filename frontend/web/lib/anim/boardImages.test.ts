/**
 * Board images searched for "other CS" lessons (lib/canvas/boardImages.ts, owner 2026-11-11). DSA, OS and
 * networking lessons must never reach it: their own board types draw them.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { isOtherCsLesson } from "../canvas/csLessons";
import { applyBoardImage, boardTakesImage, pictureScriptPrompt, conceptWords, inAnotherLanguage, decideUse, fallbackQueries, licenseOk, parseVerdict, rankCandidates, type ImageCandidate } from "../canvas/boardImages";
import type { CanvasPlanBeat } from "../canvas/types";

test("DSA, OS and networking lessons keep their own boards", () => {
  for (const topic of [
    "How the TCP three-way handshake and connection teardown work",
    "How DNS resolution works",
    "Process scheduling in operating systems",
    "Paging and virtual memory",
    "Binary search trees: insertion and deletion",
    "How a min-heap works",
    "Dijkstra's shortest path algorithm",
    "Hash tables and collision handling",
    "Dynamic programming with memoization",
  ]) assert.equal(isOtherCsLesson(topic), false, topic);
});

test("other computer-science lessons search for board images", () => {
  for (const topic of ["How CPU pipelining works", "How public-key encryption works", "How a compiler works"]) {
    assert.equal(isOtherCsLesson(topic), true, topic);
  }
});

test("lessons that are not computing never do", () => {
  for (const topic of ["Photosynthesis", "The causes of the First World War", "Completing the square"]) {
    assert.equal(isOtherCsLesson(topic), false, topic);
  }
});

test("only licences a lesson may show and adapt are kept", () => {
  for (const ok of ["CC BY-SA 4.0", "CC BY 3.0", "CC0", "Public domain", "CC BY 2.5", "PDM"]) assert.equal(licenseOk(ok), true, ok);
  for (const no of ["CC BY-NC 4.0", "CC BY-ND 2.0", "CC BY-NC-SA 3.0", "All rights reserved", ""]) assert.equal(licenseOk(no), false, no);
});

test("queries without a model still name the board's concept", () => {
  const queries = fallbackQueries("How CPU pipelining works", { title: "Data hazards and forwarding" });
  assert.ok(queries.length >= 1);
  assert.ok(queries.every((q) => /hazards/.test(q) && /diagram/.test(q)), queries.join(" | "));
});

const candidate = (title: string, description = ""): ImageCandidate => ({ title, imageUrl: `https://x/${title}.png`, pageUrl: `https://x/${title}`, creator: "A", license: "CC BY-SA 4.0", provider: "Wikimedia Commons", description, query: "q" });

test("candidates that share the board's words come first, and repeats are dropped", () => {
  const ranked = rankCandidates([candidate("Cat photo"), candidate("Five stage pipeline diagram"), candidate("Cat photo")], "the five stage instruction pipeline");
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].title, "Five stage pipeline diagram");
});

const beat = (stage: string, extra: Partial<CanvasPlanBeat> = {}) => ({ id: "b2", title: "Pipeline stages", brief: "", script: "", stage, objects: [], ...extra }) as unknown as CanvasPlanBeat;
const flowDiagram = { teaches: true, kind: "flow", title: "Compiler phases", boxes: ["Lexer", "Parser", "Code generator"], arrows: [{ from: "Lexer", to: "Parser" }, { from: "Parser", to: "Code generator" }] };

test("a diagram the board can draw is redrawn; anything else is shown", () => {
  const redraw = decideUse(beat("flow"), parseVerdict({ relevant: true, score: 0.9, diagram: flowDiagram }, { pageUrl: "https://x", provider: "Wikimedia Commons" }));
  assert.equal(redraw.use, "redraw");
  assert.equal(redraw.diagram?.kind, "flow");
  const table = decideUse(beat("flow"), parseVerdict({ relevant: true, score: 0.9, diagram: null }, { pageUrl: "https://x", provider: "Wikimedia Commons" }));
  assert.equal(table.use, "show");
  // A board planned as a message sequence is never turned into a flow chart.
  assert.equal(decideUse(beat("sequence"), parseVerdict({ relevant: true, score: 0.9, diagram: flowDiagram }, { pageUrl: "https://x", provider: "Wikimedia Commons" })).use, "show");
});

test("a shown image makes its board an illustration; a redraw keeps the board's own drawing", () => {
  const shown = beat("flow");
  applyBoardImage(shown, { candidate: candidate("Pipeline timing chart"), verdict: parseVerdict({ relevant: true, score: 0.9, shows: "A timing chart", labels: ["IF", "ID"] }, { pageUrl: "https://x", provider: "Wikimedia Commons" }), use: "show" });
  assert.equal(shown.stage, "illustration");
  assert.deepEqual(shown.foundImage?.labels, ["IF", "ID"]);
  assert.equal(shown.imageSource?.license, "CC BY-SA 4.0");

  const drawn = beat("cards");
  const verdict = parseVerdict({ relevant: true, score: 0.9, diagram: flowDiagram }, { pageUrl: "https://x/page", provider: "Wikimedia Commons" });
  applyBoardImage(drawn, { candidate: candidate("Compiler phases"), verdict, use: "redraw", diagram: verdict.diagram! });
  assert.equal(drawn.stage, "flow");
  assert.equal(drawn.sourceDiagram?.kind, "flow");
  assert.equal(drawn.foundImage, undefined);
});

test("the opening map, code, structure and exam boards keep their own picture", () => {
  assert.equal(boardTakesImage(beat("flow"), 0), false);
  for (const stage of ["code", "structure", "exam", "equation", "graph"]) assert.equal(boardTakesImage(beat(stage), 3), false, stage);
  assert.equal(boardTakesImage(beat("flow"), 3), true);
  assert.equal(boardTakesImage(beat("flow", { overview: true } as Partial<CanvasPlanBeat>), 3), false);
});

test("library files in another language are skipped, English ones kept", () => {
  for (const t of ["Digital Signature diagram fr", "Five stage pipeline datapath tr", "Public key encryption canto", "Man in the middle attack he"]) assert.equal(inAnotherLanguage(t), true, t);
  for (const t of ["Digital Signature diagram", "Five stage pipeline datapath", "Compiler scheme (en)", "Public key encryption keys"]) assert.equal(inAnotherLanguage(t), false, t);
});

test("a candidate that shares none of the board's concept words is never judged", () => {
  const concept = conceptWords("How a compiler works", "Linking");
  const ranked = rankCandidates([candidate("Orbit diagram of S2 around black hole"), candidate("Phase diagram of water"), candidate("Static linking of object files")], "linking object files into an executable", concept);
  assert.deepEqual(ranked.map((c) => c.title), ["Static linking of object files"]);
});

test("a diagram in another language is redrawn by the image model, never transcribed onto the board", () => {
  const dutch = parseVerdict({ relevant: true, score: 0.9, labels: ["Broncode", "Doelcode"], english_labels: ["Source code", "Target code"], diagram: flowDiagram }, { pageUrl: "https://x", provider: "Wikimedia Commons" });
  assert.equal(decideUse(beat("flow"), dutch, "Compiler nl").use, "show");
  assert.equal(decideUse(beat("flow"), dutch, "Compiler").use, "show", "translated labels mean another language");
  const english = parseVerdict({ relevant: true, score: 0.9, labels: ["Lexer"], english_labels: ["Lexer"], diagram: flowDiagram }, { pageUrl: "https://x", provider: "Wikimedia Commons" });
  assert.equal(decideUse(beat("flow"), english, "Compiler phases").use, "redraw");
});

test("the narration rewrite is asked to teach from the picture and its labels", () => {
  const prompt = pictureScriptPrompt("How CPU pipelining works", "Data hazards", "A data hazard happens when…", "A timing chart with and without forwarding", ["stall", "8 cycles"]);
  assert.match(prompt, /"stall", "8 cycles"/);
  assert.match(prompt, /teaches FROM this picture/);
  assert.match(prompt, /which part of the picture it belongs to/);
});
