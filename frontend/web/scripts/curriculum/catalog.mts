/**
 * Rebuilds data/curricula/catalog.json from every tree in data/curricula/trees/.
 *   node --import tsx scripts/curriculum/catalog.mts
 */
import fs from "node:fs";
import path from "node:path";
import { catalogEntry, type CatalogEntry } from "../../lib/curriculum/catalog";
import type { CurriculumTree } from "../../lib/curriculum/types";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TREES = path.join(ROOT, "data/curricula/trees");
const OUT = path.join(ROOT, "data/curricula/catalog.json");

const entries: CatalogEntry[] = [];
for (const f of fs.readdirSync(TREES).filter((x) => x.endsWith(".json")).sort()) {
  const tree = JSON.parse(fs.readFileSync(path.join(TREES, f), "utf8")) as CurriculumTree;
  if (!tree.grades?.length) continue;
  entries.push(catalogEntry(tree));
}
// A course the content audit found real problems in (data/curricula/verify/audit-agents.json:
// missing sections, distorted or misplaced statements) is not presented as finished, whatever its
// code coverage says.
const AUDIT = path.join(path.dirname(OUT), "verify/audit-agents.json");
if (fs.existsSync(AUDIT)) {
  const flagged = new Set((JSON.parse(fs.readFileSync(AUDIT, "utf8")) as { pdf: Array<{ id: string; verdict: string }> }).pdf.filter((c) => c.verdict === "problems").map((c) => c.id));
  // …unless it has since been re-extracted and re-checked (verify/fixed.json).
  const FIXED = path.join(path.dirname(OUT), "verify/fixed.json");
  const fixed = new Set<string>(fs.existsSync(FIXED) ? (JSON.parse(fs.readFileSync(FIXED, "utf8")) as { ids: string[] }).ids : []);
  for (const e of entries) if (flagged.has(e.id) && !fixed.has(e.id)) e.quality = "review";
}
fs.writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), entries }, null, 1));
const lessons = entries.reduce((n, e) => n + e.lessons, 0);
const outcomes = entries.reduce((n, e) => n + e.outcomes, 0);
console.log(`${entries.length} courses · ${lessons} lessons · ${outcomes} outcomes → ${path.relative(ROOT, OUT)}`);
