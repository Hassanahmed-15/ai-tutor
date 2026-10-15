/**
 * Rows written by hand (or by an agent) → a checked curriculum tree. No model calls, no cost.
 *
 *   node --import tsx scripts/curriculum/from-rows.mts <id> [<id>…]
 *
 * Reads data/curricula/rows/<id>.json — an array of
 *   { "grade", "unit", "topic", "subtopic" (= the lesson), "code" (or null), "outcome" (our words) }
 * in document order — and runs the same checks as the AI path: codes not printed in the source are
 * dropped, the grade is read from the code when the codes carry it, and coverage is measured
 * against every code the source contains. Prints the report; writes data/curricula/trees/<id>.json.
 */
import fs from "node:fs";
import path from "node:path";
import { assembleTree, codeInSource, codesInText, gradesFromCodes, inferGradeFromCode, mergeRows } from "../../lib/curriculum/build";
import type { ExtractedRow } from "../../lib/curriculum/types";
import { loadRegistry, pdfPages, readingOrderPages, writeTree } from "./extract.mts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const registry = loadRegistry();
const TREES_DIR = process.env.CURRICULUM_TREES_DIR ?? path.join(ROOT, "data/curricula/trees");
const replace = process.argv.includes("--replace");
for (const id of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const entry = registry.find((e) => e.id === id);
  const file = path.join(ROOT, "data/curricula/rows", `${id}.json`);
  if (!entry || !fs.existsSync(file)) {
    console.log(`${id}: ${entry ? "no rows file" : "unknown id"}`);
    continue;
  }
  let raw: ExtractedRow[];
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.log(`${id}: rows file is not valid JSON — ${(err as Error).message}`);
    continue;
  }
  const bad = raw.findIndex((r) => !r || typeof r.outcome !== "string" || typeof r.unit !== "string" || typeof r.topic !== "string");
  if (bad >= 0) {
    console.log(`${id}: row ${bad} is missing unit/topic/outcome`);
    continue;
  }
  const rows = raw.map((r) => ({ grade: String(r.grade ?? "all"), unit: r.unit, topic: r.topic, subtopic: r.subtopic ?? "", code: r.code ?? null, outcome: r.outcome }));
  // Codes are looked for in BOTH texts when a document was OCR'd: Urdu OCR reads the Urdu but can
  // garble the Latin codes beside it, while the plain extraction keeps the codes.
  const hasText = entry.sourceKind === "pdf" || entry.localFiles.length > 0;
  const pages = hasText ? pdfPages(entry) : [];
  const plain = hasText ? pdfPages(entry, { raw: true }) : [];
  const texts = JSON.stringify(plain) === JSON.stringify(pages) ? [pages] : [pages, plain];
  // Reading order joins codes a table wrapped over two lines.
  if (hasText) texts.push(readingOrderPages(entry));
  let expectedMap: Map<string, number[]> | null = null;
  if (entry.codePattern && pages.length) {
    expectedMap = new Map();
    for (const t of texts) for (const [c, at] of codesInText(t, entry.codePattern)) if (!expectedMap.has(c)) expectedMap.set(c, at);
  }
  // A code whose printed text is only a placeholder ("Extended content only.", C3's "D2.Civ.4.K-2.
  // Begins in grades 3–5") has nothing to teach.
  const placeholder = (c: string) => texts.some((t) => t.some((page) => {
    const at = page.indexOf(c);
    return at >= 0 && /^[\s|.:–-]*(extended content only|supplement only|core only|not used|begins in grades?\b)/i.test(page.slice(at + c.length, at + c.length + 60));
  }));
  // A code found only as the tail of a longer printed code is a piece of it, not a code of its own:
  // NGSS "K-2-ETS1-3" wrapped as "K-" / "2-ETS1-3" yields a phantom "2-ETS1-3". Hyphen joins only —
  // "1.5" inside "6.1.5" can be a real section of its own.
  const fragment = (c: string, all: string[]) => all.some((d) => d !== c && d.endsWith(c) && d[d.length - c.length - 1] === "-");
  const found = expectedMap ? [...expectedMap.keys()] : [];
  const expected = expectedMap ? found.filter((c) => !placeholder(c) && !fragment(c, found)) : null;
  const printers = texts.filter((t) => t.length).map((t) => codeInSource(t));
  const printed = printers.length ? (c: string) => printers.some((p) => p(c)) : null;
  const isReal = printed ? (c: string) => (expectedMap?.has(c) ?? false) || printed(c) : null;
  const merged = mergeRows(rows, isReal);
  const warnings: string[] = [];
  if (merged.invented.length) warnings.push(`${merged.invented.length} code(s) not printed in the source were dropped: ${[...new Set(merged.invented)].slice(0, 10).join(", ")}`);
  const dupes = rows.filter((r) => r.code).length - merged.rows.filter((r) => r.code).length - merged.invented.length;
  if (dupes > 0) warnings.push(`${dupes} duplicate code row(s) dropped`);
  const pattern = entry.gradeFromCode ?? inferGradeFromCode(entry.sampleCodes, entry.grades);
  if (pattern) {
    const moved = gradesFromCodes(merged.rows, pattern, entry.grades);
    if (moved) warnings.push(`${moved} outcome(s) moved to the grade their code names`);
  }
  const tree = assembleTree(entry, merged.rows, { expected, model: "claude-agent", usd: 0, builtAt: new Date().toISOString(), extraWarnings: warnings });
  // Every version of the rows is kept, and a better existing course is never replaced by a weaker one.
  const history = path.join(ROOT, "data/curricula/rows/.history");
  fs.mkdirSync(history, { recursive: true });
  fs.copyFileSync(file, path.join(history, `${id}.${Date.now()}.json`));
  const existingFile = path.join(TREES_DIR, `${id}.json`);
  if (fs.existsSync(existingFile) && !replace) {
    const old = JSON.parse(fs.readFileSync(existingFile, "utf8")) as { build: { coverage: number | null; counts: { outcomes: number }; model: string } };
    const better = (old.build.coverage ?? 0) > (tree.build.coverage ?? 0) + 0.001 || (old.build.coverage === tree.build.coverage && old.build.counts.outcomes > tree.build.counts.outcomes * 1.2);
    if (better) {
      console.log(`${id}: NOT SAVED — the existing course is better (${old.build.coverage === null ? "no codes" : `${(old.build.coverage * 100).toFixed(1)}%`}, ${old.build.counts.outcomes} outcomes). Another worker already did this document; move on. (--replace to force.)`);
      continue;
    }
  }
  writeTree(tree);
  const c = tree.build.counts;
  const cov = tree.build.coverage === null ? "no codes in source" : `${(tree.build.coverage * 100).toFixed(1)}% of ${tree.build.expectedCodes} codes`;
  console.log(`${id}: ${cov} · ${c.grades} grades ${c.units} units ${c.topics} topics ${c.subtopics} lessons ${c.outcomes} outcomes`);
  if (tree.build.missingCodes.length) console.log(`  MISSING (${tree.build.missingCodes.length}): ${tree.build.missingCodes.slice(0, 60).join(" ")}${tree.build.missingCodes.length > 60 ? " …" : ""}`);
  for (const w of tree.build.warnings.slice(0, 12)) console.log(`  warning: ${w}`);
}
