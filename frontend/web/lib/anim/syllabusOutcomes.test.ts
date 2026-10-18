import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { CatalogEntry } from "../curriculum/catalog";
import { matchSyllabus, outcomesFromTree, syllabusTextFor, type Tree } from "../curriculum/syllabusOutcomes";

const DATA = path.join(process.cwd(), "data/curricula");
const entries = (JSON.parse(readFileSync(path.join(DATA, "catalog.json"), "utf8")) as { entries: CatalogEntry[] }).entries;
const tree = (id: string) => JSON.parse(readFileSync(path.join(DATA, "trees", `${id}.json`), "utf8")) as Tree;

test("a curriculum name finds its catalogue course, subject first", () => {
  assert.match(matchSyllabus(entries, "Cambridge IGCSE Biology")?.id ?? "", /^cie-igcse-biology-0610/);
  assert.match(matchSyllabus(entries, "Cambridge IGCSE Chemistry")?.id ?? "", /^cie-igcse-chemistry/);
  assert.equal(matchSyllabus(entries, "general"), null);
  assert.match(matchSyllabus(entries, "Cambridge International AS & A Level Mathematics")?.id ?? "", /^cie-alevel-mathematics-9709/);
  assert.match(matchSyllabus(entries, "Cambridge International AS & A Level Further Mathematics")?.id ?? "", /further/);
});

test("'transport in animals' gets every outcome of the IGCSE unit — vessels and blood included", () => {
  const id = matchSyllabus(entries, "Cambridge IGCSE Biology")!.id;
  const found = outcomesFromTree(tree(id), "explain transport in animals igcse biology");
  assert.ok(found);
  assert.match(found.title, /Transport in animals/);
  const all = found.outcomes.join(" | ");
  assert.match(all, /double circulation/i);
  assert.match(all, /main vessels to and from the heart/i);
  assert.match(all, /red (blood )?cells/i);
  assert.ok(found.outcomes.length >= 15, `${found.outcomes.length} outcomes`);
  // The outcomes are in our own words; the official text names every vessel and blood component.
  const lessons = (JSON.parse(readFileSync(path.join(DATA, "sources", `${id}.json`), "utf8")) as { lessons: Record<string, Array<{ page: number; code: string | null; text: string }>> }).lessons;
  const text = syllabusTextFor(lessons, found.addresses);
  for (const term of ["vena cava", "aorta", "pulmonary artery", "pulmonary vein", "platelets", "plasma", "double circulation"]) assert.match(text, new RegExp(term, "i"), term);
});

test("a narrower request gets its topic; an unmatched one gets nothing", () => {
  const id = matchSyllabus(entries, "Cambridge IGCSE Biology")!.id;
  assert.match(outcomesFromTree(tree(id), "blood vessels")?.title ?? "", /Blood vessels/);
  assert.notEqual(outcomesFromTree(tree(id), "transport in plants")?.title.match(/animals/i), true);
  assert.equal(outcomesFromTree(tree(id), "quantum entanglement"), null);
});
