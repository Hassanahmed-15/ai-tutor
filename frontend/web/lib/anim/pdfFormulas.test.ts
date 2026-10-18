import test from "node:test";
import assert from "node:assert/strict";
import { isFormulaFragment, pageHasGarbledFormulas, rebuildFormulaBlocks } from "../pdfFormulas";

/* The Trunking Theory slides as the PDF parser returned them (PDF bench, 2026-10-18). */
const slide18 = [
  { id: "a", type: "list", heading: "Erlang C Formula", text: "The GOS is given by P(delay>t), where t is some" },
  { id: "b", type: "paragraph", heading: "Erlang C Formula", text: "by the Erlang C formula:" },
  { id: "c", type: "paragraph", heading: "Erlang C Formula", text: "( AN %( N %" },
  { id: "d", type: "table", heading: "Erlang C Formula", text: "& & # # &' | #$" },
  { id: "e", type: "paragraph", heading: "Erlang C Formula", text: "N! N − A" },
  { id: "f", type: "formula", heading: "Erlang C Formula", text: "C(A,N) = ' $" },
  { id: "g", type: "paragraph", heading: "∑ +&& ##&' #$", text: "k! N! N − A" },
];
const slide19 = [
  { id: "p", type: "paragraph", heading: "Page 19", text: "Alternative Expression for Erlang C • C(A,N) can be expressed in terms of the blocking probability B(A,N):" },
  { id: "q", type: "paragraph", heading: "Page 19", text: "NB(A,N)" },
  { id: "r", type: "formula", heading: "Page 19", text: "C(A,N) =" },
];

test("a page whose formula came out as jumble is found; prose, code and arithmetic pages are not", () => {
  assert.equal(pageHasGarbledFormulas(slide18), true);
  assert.equal(pageHasGarbledFormulas(slide19), true, "a formula cut at its '=' with the denominator missing");
  assert.equal(pageHasGarbledFormulas([{ id: "x", type: "paragraph", text: "Kernel = 3×3 of all 1s, times 1/9 → new pixel = average of 9 pixels." }]), false);
  assert.equal(pageHasGarbledFormulas([{ id: "y", type: "formula", text: "case 4 in Figure 4.36. Thus the code for balance in Figure 4.42 lines 28 and 34 uses >=" }]), false);
  assert.equal(pageHasGarbledFormulas([{ id: "z", type: "paragraph", text: "if( height( t->left ) - height( t->right ) > ALLOWED_IMBALANCE )" }]), false);
});

test("the fragments are replaced by the formulas read from the page, where they stood; prose stays", () => {
  const rebuilt = rebuildFormulaBlocks(slide19, ["C(A,N) = \\frac{N B(A,N)}{N - A[1 - B(A,N)]}"], 19);
  assert.deepEqual(rebuilt.map((b) => b.text), ["Alternative Expression for Erlang C • C(A,N) can be expressed in terms of the blocking probability B(A,N):", "C(A,N) = \\frac{N B(A,N)}{N - A[1 - B(A,N)]}"]);
  assert.equal(rebuilt[1].type, "formula");
  const s18 = rebuildFormulaBlocks(slide18, ["P(delay>0) = C(A,N)", "C(A,N) = \\frac{...}{...}"], 18);
  assert.deepEqual(s18.filter((b) => b.type !== "formula").map((b) => b.id), ["a", "b"], "the junk fragments are gone");
  assert.ok(!s18.some((b) => /[#$%&]/.test(b.heading ?? "")), "a heading made of symbol glyphs is repaired");
});

test("with no formula read, a marker stands in for them — nothing is guessed", () => {
  const rebuilt = rebuildFormulaBlocks(slide19, [], 19);
  assert.match(rebuilt[1].text!, /formula on page 19 — not readable as text/);
  assert.equal(isFormulaFragment({ id: "i", type: "paragraph", text: "by the Erlang C formula:" }), false);
});
