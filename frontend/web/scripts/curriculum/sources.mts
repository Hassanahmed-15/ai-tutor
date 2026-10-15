/**
 * THE APPROVED EVIDENCE FOR EVERY LESSON: for each lesson of the courses students can open, the
 * official syllabus text it comes from, with page numbers. Read at lesson time by
 * /api/curricula/lesson, so a lecture is written from the syllabus itself, never from a model's
 * idea of what the curriculum contains — and retrieval can only ever return the lesson's own
 * document (no cross-country, cross-year or cross-level mix-ups: the lookup is by course id and
 * lesson address, not by similarity).
 *
 *   node --import tsx scripts/curriculum/sources.mts [<courseId>…]     (default: every course in the menu)
 *
 * Coded outcomes are located by their printed code; uncoded ones by the page whose words match the
 * lesson's goals best. Output: data/curricula/sources/<courseId>.json —
 *   { courseId, builtAt, lessons: { "<grade>/<unit>/<topic>/<lesson>": [{ page, code, text }] } }
 * Free: no model calls (pdftotext / cached OCR text only).
 */
import fs from "node:fs";
import path from "node:path";
import { buildMenu, menuCourseIds } from "../../lib/curriculum/curation";
import { lessonKey } from "../../lib/curriculum/mastery";
import type { CatalogEntry } from "../../lib/curriculum/catalog";
import type { CurriculumTree } from "../../lib/curriculum/types";
import { loadRegistry, pdfPages, readingOrderPages, squeeze } from "./extract.mts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = path.join(ROOT, "data/curricula/sources");
const WINDOW_BEFORE = 160;
const WINDOW_AFTER = 1100;
const MAX_PER_LESSON = 3;

const STOP = new Set("the and for with that this from into their them they how what when where which while about using use able will can are was were has have its your our between explain describe identify understand know students student".split(" "));
const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOP.has(w));

function windowAround(page: string, at: number): string {
  const text = squeeze(page);
  const i = Math.max(0, at);
  return text.slice(Math.max(0, i - WINDOW_BEFORE), i + WINDOW_AFTER).replace(/\s+\n/g, "\n").trim();
}

const registry = new Map(loadRegistry().map((e) => [e.id, e]));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data/curricula/catalog.json"), "utf8")) as { entries: CatalogEntry[] };
const wanted = process.argv.slice(2);
const ids = wanted.length ? wanted : menuCourseIds(buildMenu(catalog.entries));
fs.mkdirSync(OUT, { recursive: true });

let total = 0;
for (const id of ids) {
  const entry = registry.get(id);
  const treeFile = path.join(ROOT, "data/curricula/trees", `${id}.json`);
  if (!entry || !fs.existsSync(treeFile) || !entry.localFiles.length) {
    console.log(`${id}: no local source (structured data or missing) — skipped`);
    continue;
  }
  const tree = JSON.parse(fs.readFileSync(treeFile, "utf8")) as CurriculumTree;
  let texts: string[][];
  try {
    texts = [pdfPages(entry), readingOrderPages(entry)];
  } catch (err) {
    console.log(`${id}: could not read source — ${(err as Error).message.slice(0, 80)}`);
    continue;
  }
  const pages = texts[0];
  const flat = texts.map((t) => t.map((p) => p.replace(/[‐-―−]/g, "-")));
  const pageWords = pages.map((p) => new Set(words(p)));

  // Every place the code is printed is a candidate (MDCAT reuses "3.4" in each subject; a section
  // number also appears in contents tables): the one whose surrounding words match the lesson wins.
  const findCode = (code: string, goals: string[]): { page: number; at: number; text: string[] } | null => {
    const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\w.])${esc}(?![\\w]|\\.\\d)`, "g");
    const want = new Set(goals.flatMap(words));
    let best: { page: number; at: number; text: string[]; score: number } | null = null;
    for (let k = 0; k < flat.length; k++) {
      for (let p = 0; p < flat[k].length; p++) {
        for (const m of flat[k][p].matchAll(re)) {
          const around = new Set(words(flat[k][p].slice(Math.max(0, m.index! - 200), m.index! + 900)));
          let score = 0;
          for (const w of want) if (around.has(w)) score++;
          if (!best || score > best.score) best = { page: p, at: m.index!, text: flat[k], score };
        }
      }
    }
    return best;
  };
  const bestPage = (goals: string[]): number => {
    const ws = new Set(goals.flatMap(words));
    let best = -1;
    let score = 0;
    pageWords.forEach((pw, i) => {
      let s = 0;
      for (const w of ws) if (pw.has(w)) s++;
      if (s > score) { score = s; best = i; }
    });
    return score >= Math.min(3, ws.size) ? best : -1;
  };

  const lessons: Record<string, Array<{ page: number; code: string | null; text: string }>> = {};
  for (const g of tree.grades) for (const u of g.units) for (const t of u.topics) for (const s of t.subtopics) {
    const out: Array<{ page: number; code: string | null; text: string }> = [];
    const seenPages = new Set<number>();
    for (const o of s.outcomes) {
      if (!o.code || out.length >= MAX_PER_LESSON) continue;
      const hit = findCode(o.code, [s.title, o.text]);
      if (hit && !seenPages.has(hit.page)) {
        seenPages.add(hit.page);
        out.push({ page: hit.page + 1, code: o.code, text: windowAround(hit.text[hit.page], hit.at) });
      }
    }
    if (!out.length) {
      const p = bestPage(s.outcomes.map((o) => `${s.title} ${o.text}`));
      if (p >= 0) out.push({ page: p + 1, code: null, text: squeeze(pages[p]).slice(0, WINDOW_BEFORE + WINDOW_AFTER) });
    }
    if (out.length) lessons[lessonKey(g.grade, u.id, t.id, s.id)] = out;
  }
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ courseId: id, builtAt: new Date().toISOString(), lessons }));
  const n = Object.keys(lessons).length;
  const all = tree.grades.reduce((a, g) => a + g.units.reduce((b, u) => b + u.topics.reduce((c, t) => c + t.subtopics.length, 0), 0), 0);
  total += n;
  console.log(`${id}: evidence for ${n}/${all} lessons`);
}
console.log(`done — ${total} lessons with evidence`);
