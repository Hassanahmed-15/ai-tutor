import test from "node:test";
import assert from "node:assert/strict";
import { boardFacts, parseBoardReview } from "../canvas/boardReview";
import type { CanvasBoardSpec } from "../canvas/types";

test("board facts say what is DRAWN: a box plot's own numbers, a graph's values, a flow's bare boxes", () => {
  const box = { v: 1, heading: "Summary", notes: [], cues: [], stage: { kind: "figure", component: "boxPlot", params: { data: "2, 4, 4, 5, 10" }, parts: [{ id: "median", name: "Median = 4", s: 0 }] } } as unknown as CanvasBoardSpec;
  const facts = boardFacts(box);
  assert.match(facts, /data = 2, 4, 4, 5, 10/);
  assert.match(facts, /"Median = 4" → part median/);
  const graph = { v: 1, heading: "Nephron", notes: [], cues: [], stage: { kind: "graph", x: { label: "Nephron sequence", min: 0, max: 6 }, y: { label: "Relative depth", min: 0, max: 10 }, curves: [{ id: "c", expr: "x + 1", label: "Depth path", s: 0 }] } } as unknown as CanvasBoardSpec;
  assert.match(boardFacts(graph), /y axis "Relative depth"/);
  assert.match(boardFacts(graph), /\(6, 7\)/);
  const flow = { v: 1, heading: "Mean and SD", notes: [], cues: [], stage: { kind: "flow", arrangement: "chain", nodes: [{ id: "a", label: "Frequency table" }, { id: "b", label: "Mean formula" }], arrows: [{ id: "x", from: "a", to: "b" }] } } as unknown as CanvasBoardSpec;
  assert.match(boardFacts(flow), /Boxes: "Frequency table", "Mean formula"/);
});

test("a review verdict holds a board back only with a concrete problem", () => {
  assert.equal(parseBoardReview({ ship: false, problems: [] }).ship, true);
  assert.equal(parseBoardReview({ ship: false, problems: [{ kind: "contradicts-narration", detail: "median shows 4, narration says 5" }] }).ship, false);
  assert.equal(parseBoardReview(null).ship, true);
});

test("text that does not fit is reported whole and ended at a break, never with \"…\"", async () => {
  const { validateCanvasSpec, validationCuts } = await import("../canvas/validate");
  const spec = validateCanvasSpec({ heading: "Substitution", stage: { kind: "flow", arrangement: "chain", nodes: [{ id: "codon", label: "Codons", sub: "methionine–glutamic acid–serine then stop", s: 0 }, { id: "chain", label: "Polypeptide", s: 1 }], arrows: [{ id: "x", from: "codon", to: "chain", s: 1 }] } }, 3);
  assert.ok(spec);
  const token = spec!.stage.kind === "flow" ? spec!.stage.nodes[0].sub ?? "" : "";
  assert.ok(!/glutami$/.test(token) && !token.endsWith("…") && token.length <= 32, `ended at a break: ${token}`);
  assert.ok(validationCuts().some((c) => /methionine–glutamic acid–serine then stop/.test(c)));
});

test("the backup board keeps the narration's own spelling and says something", async () => {
  const { asSaid, fallbackSpec } = await import("../canvas/fallback");
  const script = "RNA polymerase reads the template strand of DNA. It builds mRNA from free nucleotides. Predict: which base pairs with adenine? Uracil pairs with adenine. Now try a new strand of your own.";
  assert.equal(asSaid("mrna", script), "mRNA");
  assert.equal(asSaid("rna-polymerase", script), "RNA polymerase");
  const spec = fallbackSpec({ id: "b1", title: "Transcription", script, stage: "flow", brief: "", objects: ["dna", "rna-polymerase", "mrna"], inside: null, carry: [], interaction: "quiz", overview: false } as never);
  assert.equal(spec.stage.kind, "flow");
  if (spec.stage.kind === "flow") assert.deepEqual(spec.stage.nodes.map((n) => n.label), ["DNA", "RNA polymerase", "mRNA"]);
  assert.ok(spec.notes.length >= 1);
});

test("protein synthesis is computed from the sequence: codons, anticodons, amino acids, stop", async () => {
  const { proteinSynthesisData } = await import("../figures/components/proteinSynthesis");
  const fromTemplate = proteinSynthesisData({ dna: "3'-TAC CGA TTT ACT-5'", strand: "template" });
  assert.deepEqual(fromTemplate.codons, ["AUG", "GCU", "AAA", "UGA"]);
  assert.deepEqual(fromTemplate.aminoAcids, ["Met", "Ala", "Lys", "Stop"]);
  assert.deepEqual(fromTemplate.anticodons.slice(0, 3), ["UAC", "CGA", "UUU"]);
  const fromMrna = proteinSynthesisData({ mrna: "AUG GAA UCG UAA" });
  assert.deepEqual(fromMrna.aminoAcids, ["Met", "Glu", "Ser", "Stop"]);
  assert.deepEqual(proteinSynthesisData({ dna: "ATG TTT TGA", strand: "coding" }).aminoAcids, ["Met", "Phe", "Stop"]);
});
