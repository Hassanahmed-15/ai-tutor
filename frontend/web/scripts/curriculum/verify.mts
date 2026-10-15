/**
 * INDEPENDENT CHECK OF EVERY MENU COURSE AGAINST ITS OFFICIAL SOURCE (free: no model calls).
 *
 *   node --import tsx scripts/curriculum/verify.mts            → data/curricula/verify/report.json
 *
 * Standards data (Common Standards Project, cached in .curricula-raw/.api): every leaf statement of
 * every set must be an outcome, word for word, under the grade the set is for; and every outcome
 * must be such a statement (nothing added). Re-derived here from the raw sets, not from the build.
 *
 * PDF syllabi: every code in the course must be printed in the PDF, every code the PDF prints must
 * be in the course, and each outcome's wording is scored against the source text where its code
 * (or, uncoded, its best-matching page) is printed: `verbatim` = the outcome's words appear in that
 * order in the source; `recall` = share of its content words found there.
 */
import fs from "node:fs";
import path from "node:path";
import { buildMenu, menuCourseIds } from "../../lib/curriculum/curation";
import { codesInText } from "../../lib/curriculum/build";
import type { CurriculumTree } from "../../lib/curriculum/types";
import { loadRegistry, pdfPages, readingOrderPages } from "./extract.mts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DATA = path.join(ROOT, "data/curricula");
const API = path.join(ROOT, ".curricula-raw/.api");
const OUT = path.join(DATA, "verify");

const norm = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/[‐-―−]/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().replace(/[\s;.,:]+$/, "").toLowerCase();
const STOP = new Set("the a an and or of to in on for with by as at from is are be that this these those their its it which who can will into than then such".split(" "));
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? []).filter((w) => !STOP.has(w));

type Outcome = { grade: string; unit: string; topic: string; lesson: string; code: string | null; text: string };
function outcomesOf(t: CurriculumTree): Outcome[] {
  return t.grades.flatMap((g) => g.units.flatMap((u) => u.topics.flatMap((tp) => tp.subtopics.flatMap((s) => s.outcomes.map((o) => ({ grade: g.grade, unit: u.title, topic: tp.title, lesson: s.title, code: o.code ?? null, text: o.text }))))));
}

/* ── standards data ─────────────────────────────────────────────────────────────────────── */

type Std = { id: string; position: number; parentId?: string | null; ancestorIds?: string[] | null; statementNotation?: string | null; statementLabel?: string | null; description?: string | null };
type Set_ = { id: string; title: string; subject: string; educationLevels?: string[]; standards: Record<string, Std> };

function gradeOfSet(levels: string[]): string[] {
  const ORDER = ["PK", "K", ...Array.from({ length: 12 }, (_, i) => String(i + 1))];
  const n = [...new Set(levels.map((l) => (/^pre-?k|^pk$/i.test(l) ? "PK" : /^k$/i.test(l) ? "K" : l.replace(/^0+(?=\d)/, ""))))]
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return n.length === 1 ? [n[0]] : n.length ? [`${n[0]}-${n[n.length - 1]}`] : ["all"];
}

function setsFor(urls: string[], subject: string): Set_[] {
  let ids = urls.filter((u) => u.includes("/standard_sets/")).map((u) => u.split("/standard_sets/")[1]);
  if (!ids.length) {
    const j = urls.find((u) => u.includes("/jurisdictions/"));
    if (j) {
      const idx = JSON.parse(fs.readFileSync(path.join(API, `csp-j-${j.split("/jurisdictions/")[1]}.json`), "utf8")) as { data: { standardSets: Array<{ id: string; subject: string }> } };
      const want = subject.trim().toLowerCase();
      ids = idx.data.standardSets.filter((s) => { const got = s.subject.trim().toLowerCase(); return got === want || got.includes(want) || want.includes(got); }).map((s) => s.id);
    }
  }
  return ids.map((id) => (JSON.parse(fs.readFileSync(path.join(API, `csp-${id}.json`), "utf8")) as { data: Set_ }).data);
}

/** The statements a set asks students to meet: standards with nothing under them (not headings). */
function leafStatements(set: Set_): Array<{ code: string | null; text: string }> {
  const all = Object.values(set.standards).sort((a, b) => a.position - b.position);
  const parentOf = (s: Std) => s.parentId || s.ancestorIds?.[s.ancestorIds.length - 1] || null;
  const parents = new Set(all.map(parentOf).filter(Boolean));
  const out: Array<{ code: string | null; text: string }> = [];
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    if (parents.has(s.id)) continue;
    // A notation that prefixes the next sibling's ("5.2" before "5.2.A") is that group's heading.
    const n = s.statementNotation?.trim();
    const next = all[i + 1];
    const m = next && parentOf(next) === parentOf(s) ? next.statementNotation?.trim() : undefined;
    if (n && m && (m.startsWith(`${n}.`) || (m.startsWith(n) && /^[A-Za-z(]/.test(m.slice(n.length))))) continue;
    const text = (s.description ?? s.statementLabel ?? "").replace(/<[^>]+>/g, " ").trim();
    // "Not applicable." / "No standard at this level." mark an empty slot, not a statement to teach.
    if (text && !/^(not applicable|n\/?a|none|no standards? (at|for) this (level|grade)( level)?|intentionally (left )?blank|incorporated into\b.*|see\s+[A-Z0-9][\w.-]*)\.?$/i.test(text.replace(/\s+/g, " "))) out.push({ code: n || null, text });
  }
  return out;
}

function checkStandards(tree: CurriculumTree, urls: string[]) {
  const outs = outcomesOf(tree);
  const inTree = new Map<string, Set<string>>(); // text → grades it is taught in
  for (const o of outs) { const k = norm(o.text); inTree.set(k, (inTree.get(k) ?? new Set()).add(o.grade)); }
  const headings = new Set(outs.flatMap((o) => [o.unit, o.topic, o.lesson].map(norm)));
  const inSource = new Map<string, Set<string>>();
  let statements = 0;
  const missing: string[] = [];
  const wrongGrade: string[] = [];
  for (const set of setsFor(urls, tree.subject)) {
    const [grade] = gradeOfSet(set.educationLevels ?? []);
    for (const st of leafStatements(set)) {
      statements++;
      const k = norm(st.text);
      inSource.set(k, (inSource.get(k) ?? new Set()).add(grade));
      const g = inTree.get(k);
      if (!g) { if (!headings.has(k)) missing.push(`${st.code ?? ""} ${st.text}`.trim().slice(0, 160)); }
      else if (!g.has(grade) && ![...g].some((x) => x.toLowerCase() === grade.toLowerCase())) wrongGrade.push(`${st.code ?? ""} [source ${grade}, course ${[...g].join("/")}] ${st.text}`.slice(0, 160));
    }
  }
  const added = [...inTree.keys()].filter((k) => !inSource.has(k)).map((k) => k.slice(0, 160));
  return { statements, outcomes: outs.length, missing, added, wrongGrade, verbatim: outs.length ? outs.filter((o) => inSource.has(norm(o.text))).length / outs.length : 1 };
}

/* ── PDF syllabi ────────────────────────────────────────────────────────────────────────── */

function checkPdf(tree: CurriculumTree, entry: ReturnType<typeof loadRegistry>[number]) {
  const outs = outcomesOf(tree);
  const layout = pdfPages(entry);
  const order = readingOrderPages(entry);
  const texts = [layout, order];
  const flat = texts.map((t) => t.map((p) => p.replace(/[‐-―−]/g, "-")));
  const joined = flat.map((t) => norm(t.join(" ")));
  // Codes, both ways.
  let codeCheck: { notInSource: string[]; notInCourse: string[] } | null = null;
  if (entry.codePattern) {
    const printed = new Set<string>();
    for (const t of flat) for (const c of codesInText(t, entry.codePattern).keys()) printed.add(c);
    const treeCodes = new Set(outs.map((o) => o.code).filter(Boolean) as string[]);
    const skip = new Set(tree.build.missingCodes); // already reported by the build as missing
    codeCheck = {
      notInSource: [...treeCodes].filter((c) => !printed.has(c) && !joined.some((j) => j.includes(c.toLowerCase()))),
      notInCourse: [...printed].filter((c) => !treeCodes.has(c) && !skip.has(c)),
    };
  }
  // Wording.
  const pageWords = flat[0].map((p) => new Set(words(p)));
  const scored = outs.map((o) => {
    const ow = words(o.text);
    let windows: string[] = [];
    if (o.code) for (const t of flat) for (const p of t) { let at = p.indexOf(o.code); while (at >= 0) { windows.push(p.slice(Math.max(0, at - 300), at + 1500)); at = p.indexOf(o.code, at + 1); } }
    if (!windows.length) {
      // Uncoded: the page whose words cover the outcome best, with its neighbours.
      let best = -1, bestScore = -1;
      pageWords.forEach((pw, i) => { const s = ow.filter((w) => pw.has(w)).length; if (s > bestScore) { bestScore = s; best = i; } });
      windows = best >= 0 ? [flat[0][best - 1] ?? "", flat[0][best], flat[0][best + 1] ?? "", flat[1][best] ?? ""] : [];
    }
    const recall = Math.max(0, ...windows.map((w) => { const ws = new Set(words(w)); return ow.length ? ow.filter((x) => ws.has(x)).length / ow.length : 1; }));
    const verbatim = joined.some((j) => j.includes(norm(o.text)));
    return { o, recall, verbatim };
  });
  const low = scored.filter((s) => s.recall < 0.6).map((s) => ({ grade: s.o.grade, code: s.o.code, text: s.o.text, recall: Number(s.recall.toFixed(2)) }));
  return {
    outcomes: outs.length,
    codes: codeCheck,
    verbatim: scored.filter((s) => s.verbatim).length / Math.max(1, outs.length),
    meanRecall: scored.reduce((a, s) => a + s.recall, 0) / Math.max(1, outs.length),
    lowRecall: low,
  };
}

/* ── run ────────────────────────────────────────────────────────────────────────────────── */

const catalog = JSON.parse(fs.readFileSync(path.join(DATA, "catalog.json"), "utf8"));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : menuCourseIds(buildMenu(catalog.entries));
const registry = new Map(loadRegistry().map((e) => [e.id, e]));
const report: Record<string, unknown> = {};
for (const id of ids) {
  const entry = registry.get(id)!;
  const tree = JSON.parse(fs.readFileSync(path.join(DATA, "trees", `${id}.json`), "utf8")) as CurriculumTree;
  try {
    if (entry.sourceKind === "api" && entry.sourceUrls.some((u) => u.includes("commonstandardsproject"))) report[id] = { kind: "standards", ...checkStandards(tree, entry.sourceUrls) };
    else if (entry.localFiles.length) report[id] = { kind: entry.codePattern ? "pdf-coded" : "pdf-uncoded", ...checkPdf(tree, entry) };
    else report[id] = { kind: "unchecked", reason: `source kind ${entry.sourceKind}` };
  } catch (err) {
    report[id] = { kind: "error", error: (err as Error).message.slice(0, 200) };
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ checkedAt: new Date().toISOString(), courses: report }, null, 1));
console.log(`checked ${ids.length} courses → data/curricula/verify/report.json`);
