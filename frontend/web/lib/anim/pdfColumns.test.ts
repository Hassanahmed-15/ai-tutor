import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pageGutters, structurePdfPage, type PdfTextSpan } from "../pdfLessonPipeline";

/* A page set in columns is read column by column (2026-10-16: the statement-blocks lecture). */

type Page = { pageNumber: number; width: number; height: number; spans: PdfTextSpan[] };
const sheet = (): Page[] => JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "anim", "fixtures-python-sheet-spans.json"), "utf8"));

test("a reference sheet's three columns are three columns, not one table across the page", () => {
  const [p1] = sheet();
  const gutters = pageGutters(p1.spans, p1.width, p1.height);
  // The Boolean Logic | Statements Blocks | Modules & Conditional Statement columns.
  assert.ok(gutters.some((g) => g.x > 175 && g.x < 192 && g.top <= 575 && g.bottom >= 790), JSON.stringify(gutters));
  assert.ok(gutters.some((g) => g.x > 318 && g.x < 335 && g.top <= 575 && g.bottom >= 790), JSON.stringify(gutters));
  const blocks = structurePdfPage(p1.spans, 1, p1.width, p1.height);
  const holding = (words: string) => blocks.filter((b) => (b.text ?? "").includes(words));
  const elif = holding("Can go with several elif");
  assert.equal(elif.length, 1);
  assert.ok(elif[0].bbox!.x > 0.54, `the Conditional Statement text is in its own column: ${JSON.stringify(elif[0].bbox)}`);
  assert.ok(!(elif[0].text ?? "").includes("True and False constants"), "and does not carry the Boolean Logic column's words");
  const constants = holding("True and False constants");
  assert.ok(constants.length === 1 && constants[0].bbox!.x + constants[0].bbox!.width < 0.32, `"True and False constants" stays in the first column: ${JSON.stringify(constants[0]?.bbox)}`);
  // Before: 43 blocks wider than 70% of the page, highlighting whole rows of the sheet. Now only the
  // "Sequence Containers Indexing" box, which does span the page.
  assert.ok(blocks.filter((b) => b.bbox!.width > 0.7).every((b) => b.bbox!.y < 0.66));
});

test("a real table keeps its rows: its cells share their baselines", () => {
  const spans: PdfTextSpan[] = [];
  for (let r = 0; r < 14; r++) {
    const top = 120 + r * 16;
    spans.push({ text: `Sample measurement ${r}`, x: 60, top, width: 150, height: 10, fontSize: 10 });
    spans.push({ text: `${(r * 1.7).toFixed(1)} grams per litre`, x: 300, top, width: 120, height: 10, fontSize: 10 });
  }
  assert.deepEqual(pageGutters(spans, 595, 842), []);
  const blocks = structurePdfPage(spans, 1, 595, 842);
  assert.ok(blocks.some((b) => b.type === "table" && (b.text ?? "").includes("Sample measurement 3 | 5.1 grams per litre")));
});
