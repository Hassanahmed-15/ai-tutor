/**
 * For auditing a course against its source by eye (agents and people):
 *
 *   node --import tsx scripts/curriculum/audit-view.mts <courseId> outline            the course: grades → units → lessons → outcomes (with codes)
 *   node --import tsx scripts/curriculum/audit-view.mts <courseId> pages <from> <to>  the source PDF text of those pages (layout + reading order)
 *   node --import tsx scripts/curriculum/audit-view.mts <courseId> find <text>        source pages containing <text> (a code or phrase)
 *   node --import tsx scripts/curriculum/audit-view.mts <courseId> flags              outcomes verify.mts scored low against the source
 */
import fs from "node:fs";
import path from "node:path";
import type { CurriculumTree } from "../../lib/curriculum/types";
import { loadRegistry, pdfPages, readingOrderPages } from "./extract.mts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const [id, cmd, a, b] = process.argv.slice(2);
const entry = loadRegistry().find((e) => e.id === id);
if (!entry) throw new Error(`unknown course ${id}`);
const tree = JSON.parse(fs.readFileSync(path.join(ROOT, "data/curricula/trees", `${id}.json`), "utf8")) as CurriculumTree;

if (cmd === "outline") {
  console.log(`${tree.framework} · ${tree.subject} · source: ${tree.source.urls[0]} · ${entry.localFiles.join(", ")}`);
  for (const g of tree.grades) {
    console.log(`\n## GRADE ${g.grade}`);
    for (const u of g.units) {
      console.log(`  # ${u.title}`);
      for (const t of u.topics) {
        console.log(`    - ${t.title}`);
        for (const s of t.subtopics) {
          console.log(`      • lesson: ${s.title}`);
          for (const o of s.outcomes) console.log(`          [${o.code ?? "-"}] ${o.text}`);
        }
      }
    }
  }
} else if (cmd === "pages") {
  const layout = pdfPages(entry);
  const order = readingOrderPages(entry);
  console.log(`(${layout.length} pages)`);
  for (let p = Number(a); p <= Number(b ?? a) && p <= layout.length; p++) {
    console.log(`\n===== PAGE ${p} (layout) =====\n${layout[p - 1]}`);
    if (order[p - 1] && order[p - 1] !== layout[p - 1]) console.log(`\n----- PAGE ${p} (reading order) -----\n${order[p - 1]}`);
  }
} else if (cmd === "find") {
  const needle = process.argv.slice(4).join(" ").toLowerCase();
  const layout = pdfPages(entry);
  const order = readingOrderPages(entry);
  layout.forEach((p, i) => {
    for (const t of [p, order[i] ?? ""]) {
      const at = t.toLowerCase().indexOf(needle);
      if (at >= 0) { console.log(`page ${i + 1}: …${t.slice(Math.max(0, at - 150), at + 350).replace(/\s+/g, " ")}…`); break; }
    }
  });
} else if (cmd === "flags") {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, "data/curricula/verify/report.json"), "utf8")).courses[id];
  console.log(JSON.stringify({ kind: r.kind, outcomes: r.outcomes, verbatim: r.verbatim, meanRecall: r.meanRecall, codes: r.codes, lowRecall: r.lowRecall?.slice(0, 80) }, null, 1));
} else {
  console.log("commands: outline | pages <from> <to> | find <text> | flags");
}
