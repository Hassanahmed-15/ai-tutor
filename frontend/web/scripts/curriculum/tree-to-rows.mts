/**
 * An existing course tree back into editable rows (data/curricula/rows/<id>.json), for courses built
 * by the model path that have no rows file — e.g. to rename lessons, then rebuild with
 * `from-rows.mts <id> --replace`. Refuses to overwrite an existing rows file.
 *   node --import tsx scripts/curriculum/tree-to-rows.mts <id> [<id>…]
 */
import fs from "node:fs";
import path from "node:path";
import type { CurriculumTree, ExtractedRow } from "../../lib/curriculum/types";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
for (const id of process.argv.slice(2)) {
  const out = path.join(ROOT, "data/curricula/rows", `${id}.json`);
  if (fs.existsSync(out)) { console.log(`${id}: rows file already exists`); continue; }
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, "data/curricula/trees", `${id}.json`), "utf8")) as CurriculumTree;
  const rows: ExtractedRow[] = [];
  for (const g of t.grades) for (const u of g.units) for (const tp of u.topics) for (const s of tp.subtopics) for (const o of s.outcomes) {
    rows.push({ grade: g.grade, unit: u.title, topic: tp.title, subtopic: s.title, code: o.code, outcome: o.text });
  }
  fs.writeFileSync(out, JSON.stringify(rows, null, 0));
  console.log(`${id}: ${rows.length} rows`);
}
