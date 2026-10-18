import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry } from "./catalog";

/**
 * THE OFFICIAL OUTCOMES OF THE TOPIC A STUDENT ASKED FOR. A typed "explain transport in animals igcse
 * biology" was planned from a checklist web research built, which stopped after the heart: the named
 * blood vessels and the whole of "9.4 Blood" were never taught, and a student wrote that the key ideas
 * were missing (feedback, 2026-10-18). The course catalogue (data/curricula, checked trees from the
 * official syllabi) has every outcome of "9 Transport in animals". When the student's syllabus is known
 * and the request names one of its units or topics, those outcomes are the checklist.
 */

type Outcome = { code?: string | null; text: string };
type TreeTopic = { id: string; title: string; subtopics: Array<{ id: string; title: string; outcomes: Outcome[] }> };
type TreeUnit = { id: string; title: string; topics: TreeTopic[] };
export type Tree = { id: string; framework: string; subject: string; qualification?: string | null; grades: Array<{ grade: string; units: TreeUnit[] }> };

const DATA = path.join(process.cwd(), "data/curricula");
let catalog: CatalogEntry[] | null = null;
const words = (t: string) => (t.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1);
const COMMON = new Set("the and of in for to a an with how what why explain teach me about igcse gcse level levels as cambridge international syllabus biology chemistry physics mathematics maths".split(" "));

async function loadCatalog(): Promise<CatalogEntry[]> {
  if (catalog) return catalog;
  const raw = JSON.parse(await readFile(path.join(DATA, "catalog.json"), "utf8")) as { entries?: CatalogEntry[] };
  catalog = raw.entries ?? [];
  return catalog;
}

/** The catalogue course a curriculum name means ("Cambridge IGCSE Biology" → cie-igcse-biology-0610). */
export function matchSyllabus(entries: CatalogEntry[], curriculum: string): CatalogEntry | null {
  const want = new Set(words(curriculum));
  if (!want.size) return null;
  const code = curriculum.match(/\b\d{4}\b/)?.[0];
  const scored = entries.map((e) => {
    const has = new Set(words(`${e.board ?? ""} ${e.qualification ?? ""} ${e.subject} ${e.framework} ${e.syllabusCode ?? ""}`));
    // The subject must match: "Cambridge IGCSE Biology" is never the IGCSE Chemistry course.
    const subjectHit = words(e.subject).some((w) => want.has(w));
    let score = [...want].filter((w) => has.has(w)).length;
    if (code && e.syllabusCode === code) score += 5;
    if (/^cie-/.test(e.id) && want.has("cambridge")) score += 1;
    // "A Level Mathematics" is 9709, never Further Mathematics: every word of the course's subject must be asked for.
    score -= words(e.subject).filter((w) => !want.has(w)).length * 2;
    // "Cambridge IGCSE Biology" is 0610; the 9–1 graded 0970 only when the name says 9–1.
    if (/9\s*[-–]\s*1/.test(e.qualification ?? "") && !/9\s*[-–]\s*1/.test(curriculum)) score -= 1;
    return { e, score: subjectHit ? score : 0 };
  }).filter((x) => x.score >= 2);
  scored.sort((a, b) => b.score - a.score || b.e.id.localeCompare(a.e.id));
  return scored[0]?.e ?? null;
}

/**
 * The outcomes of the unit (or topic) the request is about: the unit when the request names it
 * ("transport in animals" → all of "9 Transport in animals"), a topic when that fits better
 * ("blood vessels" → "9.3 Blood vessels"). Null when nothing in the syllabus clearly matches.
 */
export type SyllabusOutcomes = { framework: string; title: string; outcomes: string[]; addresses: string[]; text?: string };
type Evidence = { page: number; code: string | null; text: string };

/** The syllabus pages behind these lessons, each page once, in page order. */
export function syllabusTextFor(lessons: Record<string, Evidence[]>, addresses: string[], maxChars = 4_000): string {
  const pages = new Map<number, string>();
  for (const a of addresses) for (const e of lessons[a] ?? []) if (!pages.has(e.page)) pages.set(e.page, e.text);
  return [...pages.entries()].sort((a, b) => a[0] - b[0]).map(([page, text]) => `--- syllabus page ${page} ---\n${text.replace(/\u0007/g, "").replace(/[ \t]+/g, " ").trim()}`).join("\n\n").slice(0, maxChars);
}

export async function syllabusOutcomesFor(curriculum: string, request: string): Promise<SyllabusOutcomes | null> {
  try {
    const entry = matchSyllabus(await loadCatalog(), curriculum);
    if (!entry) return null;
    const tree = JSON.parse(await readFile(path.join(DATA, "trees", `${entry.id}.json`), "utf8")) as Tree;
    const found = outcomesFromTree(tree, request);
    if (!found) return null;
    try {
      const sources = JSON.parse(await readFile(path.join(DATA, "sources", `${entry.id}.json`), "utf8")) as { lessons: Record<string, Evidence[]> };
      found.text = syllabusTextFor(sources.lessons, found.addresses) || undefined;
    } catch { /* outcomes alone */ }
    return found;
  } catch {
    return null;
  }
}

export function outcomesFromTree(tree: Tree, request: string): SyllabusOutcomes | null {
  const asked = words(request).filter((w) => !COMMON.has(w));
  if (!asked.length) return null;
  const strip = (title: string) => words(title.replace(/^[\d.]+\s*/, "")).filter((w) => !COMMON.has(w));
  // Same word, give or take an ending ("animal"/"animals", "vessel"/"vessels") — "transport" is not "transpiration".
  const same = (a: string, b: string) => { const n = Math.max(4, Math.min(a.length, b.length) - 2); return a.slice(0, n) === b.slice(0, n); };
  const fit = (title: string) => { const t = strip(title); return t.length ? t.filter((w) => asked.some((a) => same(a, w))).length / t.length : 0; };
  const outcomesOf = (topics: TreeTopic[]) => topics.flatMap((t) => t.subtopics.flatMap((s) => s.outcomes.map((o) => o.text.trim()))).filter(Boolean);
  // The addresses of their lessons in data/curricula/sources ("IGCSE/<unit>/<topic>/<subtopic>").
  const addressesOf = (grade: string, unit: TreeUnit, topics: TreeTopic[]) => topics.flatMap((t) => t.subtopics.map((s) => `${grade}/${unit.id}/${t.id}/${s.id}`));
  let best: { title: string; outcomes: string[]; addresses: string[]; score: number } | null = null;
  for (const grade of tree.grades) for (const unit of grade.units) {
    const u = fit(unit.title);
    if (u > (best?.score ?? 0)) best = { title: unit.title, outcomes: outcomesOf(unit.topics), addresses: addressesOf(grade.grade, unit, unit.topics), score: u };
    for (const topic of unit.topics) {
      const t = fit(topic.title);
      // A topic wins only when it fits the request better than its unit does.
      if (t > u && t > (best?.score ?? 0)) best = { title: topic.title, outcomes: outcomesOf([topic]), addresses: addressesOf(grade.grade, unit, [topic]), score: t };
    }
  }
  // Every word of the unit's or topic's name must be in the request: "transport in animals" ≠ "transport in plants".
  if (!best || best.score < 1 || !best.outcomes.length) return null;
  return { framework: tree.framework, title: best.title, outcomes: best.outcomes.slice(0, 30), addresses: best.addresses };
}
