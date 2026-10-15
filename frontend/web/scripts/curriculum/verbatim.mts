/**
 * OFFICIAL WORDING FOR PDF COURSES (free: no model calls). Extraction reworded most outcomes; this
 * puts the syllabus's own statement back wherever it can be found unambiguously.
 *
 *   node --import tsx scripts/curriculum/verbatim.mts [--write] [<courseId>…]   (default: every PDF course in the menu; dry run)
 *
 * The source (reading-order text, which keeps wrapped table lines together) is cut into statements:
 * a statement starts at a line beginning with a marker — "1", "2.3", "(a)", "a)", "•", "-", or a
 * printed code — and runs until the next one. For each outcome, the candidates are the statements
 * near its code (or, uncoded, on the pages that match it best), each alone and with its lettered
 * sub-items. The outcome takes the best candidate's exact text when
 *   - the two share enough words (F1 ≥ MIN_F1) — it is the same statement, reworded, and
 *   - no other candidate comes close (best - second ≥ MARGIN) — it is not a guess between neighbours.
 * Everything else keeps its current text and is listed for review. Report: data/curricula/verify/verbatim.json
 */
import fs from "node:fs";
import path from "node:path";
import { buildMenu, menuCourseIds } from "../../lib/curriculum/curation";
import type { CurriculumTree } from "../../lib/curriculum/types";
import { loadRegistry, readingOrderPages, writeTree } from "./extract.mts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DATA = path.join(ROOT, "data/curricula");
const MIN_F1 = 0.7;
const MARGIN = 0.12;

const STOP = new Set("the a an and or of to in on for with by as at from is are be that this these those their its it which who can will into than then such".split(" "));
const words = (s: string) => (s.toLowerCase().replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? []).filter((w) => !STOP.has(w));
function f1(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const bs = new Map<string, number>();
  for (const w of b) bs.set(w, (bs.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of a) { const n = bs.get(w) ?? 0; if (n) { hit++; bs.set(w, n - 1); } }
  const p = hit / b.length, r = hit / a.length;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

const MARKER = /^\s*(?:\d{1,2}(?:\.\d{1,2})*[.)]?|\([a-z0-9]{1,4}\)|[a-z]\)|[ivx]{1,4}[.)]|[•●▪◦–-])\s+/i;
const SUB = /^\s*(?:\([a-z]{1,2}\)|[a-z]\)|[ivx]{1,4}[.)])\s+/i;
type Statement = { page: number; text: string; sub: boolean; at: number };

/** Statements of the source, in order, with their page. */
function statements(pages: string[], codeRe: RegExp | null): Statement[] {
  const out: Statement[] = [];
  pages.forEach((page, p) => {
    let cur: Statement | null = null;
    for (const raw of page.split("\n")) {
      const line = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
      if (!line) continue;
      // Column labels, running heads and footers end a statement and are never part of one.
      if (/^(core|supplement|extended|core and extended|foundation|higher|as level|a level|back to contents page|continued|.*www\.[a-z]+\.(org|com|gov)\S*.*|.*\bsyllabus\b.*\b20\d\d\b.*|\d{1,3})$/i.test(line)) {
        if (cur) out.push(cur);
        cur = null;
        continue;
      }
      const starts = MARKER.test(line) || (codeRe ? codeRe.test(line) : false);
      if (starts || !cur) {
        if (cur) out.push(cur);
        cur = { page: p, text: line, sub: SUB.test(line), at: out.length };
      } else cur.text += ` ${line}`;
    }
    if (cur) out.push(cur);
    cur = null;
  });
  return out.map((s, i) => ({ ...s, at: i }));
}

/** A statement as printed, minus its leading marker. */
const bare = (t: string) => t.replace(MARKER, "").replace(/\s+/g, " ").trim().replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl");

const catalog = JSON.parse(fs.readFileSync(path.join(DATA, "catalog.json"), "utf8"));
const registry = new Map(loadRegistry().map((e) => [e.id, e]));
const args = process.argv.slice(2);
const write = args.includes("--write");
const wanted = args.filter((a) => !a.startsWith("--"));
const ids = wanted.length ? wanted : menuCourseIds(buildMenu(catalog.entries)).filter((id) => registry.get(id)?.localFiles.length);

const report: Record<string, unknown> = {};
let total = 0, replaced = 0, already = 0;
for (const id of ids) {
  const entry = registry.get(id)!;
  const tree = JSON.parse(fs.readFileSync(path.join(DATA, "trees", `${id}.json`), "utf8")) as CurriculumTree;
  let pages: string[];
  try { pages = readingOrderPages(entry); } catch { report[id] = { error: "no text" }; continue; }
  const codeRe = entry.codePattern ? new RegExp(`^\\s*(?:${entry.codePattern})\\b`) : null;
  const sts = statements(pages, codeRe);
  const stWords = sts.map((s) => words(bare(s.text)));
  // A statement with its lettered sub-items after it, as one candidate too.
  const withSubs = sts.map((s, i) => {
    if (s.sub) return null;
    let j = i + 1, t = bare(s.text);
    while (j < sts.length && sts[j].sub) { t += ` ${sts[j].text.trim()}`; j++; }
    return j > i + 1 ? t : null;
  });
  const pageWords = pages.map((p) => new Set(words(p)));
  const changes: Array<{ code: string | null; from: string; to: string; f1: number }> = [];
  const unsure: Array<{ code: string | null; text: string; best: string | null; f1: number; second: number }> = [];
  let n = 0, rep = 0, same = 0;
  for (const g of tree.grades) for (const u of g.units) for (const t of u.topics) for (const s of t.subtopics) for (const o of s.outcomes) {
    n++;
    const ow = words(o.text);
    // Where to look: statements on pages that print the code; else the 3 pages most like the outcome.
    let near = new Set<number>();
    if (o.code) pages.forEach((p, i) => { if (p.includes(o.code!)) { near.add(i); near.add(i + 1); } });
    if (!near.size) {
      const scored = pageWords.map((pw, i) => [ow.filter((w) => pw.has(w)).length, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3);
      near = new Set(scored.map(([, i]) => i));
    }
    const cands: Array<{ text: string; f: number }> = [];
    // Score: half overlap (F1), half how much of the outcome the statement contains — an outcome that
    // shortened its statement still finds it, and gets the full official wording back.
    const score = (cw: string[]) => { const set = new Set(cw); const contain = ow.length ? ow.filter((w) => set.has(w)).length / ow.length : 0; return cw.length > ow.length * 4 + 12 ? 0 : 0.5 * f1(ow, cw) + 0.5 * contain; };
    const add = (text: string) => { if (!/[:–-]\s*$/.test(text)) cands.push({ text, f: score(words(text)) }); };
    sts.forEach((st, i) => {
      if (!near.has(st.page)) return;
      add(bare(st.text));
      if (withSubs[i]) add(withSubs[i]!);
      // "Describe … by describing:" + one of its lettered items.
      if (/:\s*$/.test(st.text)) for (let j = i + 1; j < sts.length && sts[j].sub; j++) add(`${bare(st.text)} ${sts[j].text.trim()}`);
    });
    cands.sort((a, b) => b.f - a.f);
    const best = cands[0], second = cands.find((c) => c.text !== best?.text)?.f ?? 0;
    const cleanBest = best?.text.replace(new RegExp(`^${(o.code ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`), "").replace(/\s+([,.;:])/g, "$1").trim();
    if (best && best.f >= 0.999 && cleanBest) { same++; continue; }
    if (best && cleanBest && best.f >= MIN_F1 && best.f - second >= MARGIN && cleanBest.length <= 600) {
      changes.push({ code: o.code ?? null, from: o.text, to: cleanBest, f1: Number(best.f.toFixed(2)), ref: o } as never);
    } else unsure.push({ code: o.code ?? null, text: o.text, best: cleanBest ?? null, f1: Number((best?.f ?? 0).toFixed(2)), second: Number(second.toFixed(2)) });
  }
  // Two outcomes claiming one statement: the course split it — leave both as they are (no duplicates).
  const claims = new Map<string, number>();
  for (const c of changes) claims.set(c.to, (claims.get(c.to) ?? 0) + 1);
  for (const c of changes) {
    const ref = (c as unknown as { ref: { text: string } }).ref;
    delete (c as { ref?: unknown }).ref;
    if (claims.get(c.to)! > 1) { unsure.push({ code: c.code, text: c.from, best: c.to, f1: c.f1, second: -1 }); continue; }
    if (write) ref.text = c.to;
    rep++;
  }
  const kept = changes.filter((c) => claims.get(c.to) === 1);
  changes.length = 0; changes.push(...kept);
  total += n; replaced += rep; already += same;
  report[id] = { outcomes: n, alreadyOfficial: same, replaced: rep, unsure: unsure.length, changes, unsureList: unsure };
  if (write && rep) writeTree(tree);
  console.log(`${id}: ${n} outcomes · already official ${same} · now official ${rep} · left for review ${unsure.length}`);
}
fs.mkdirSync(path.join(DATA, "verify"), { recursive: true });
fs.writeFileSync(path.join(DATA, "verify", "verbatim.json"), JSON.stringify(report, null, 1));
console.log(`\n${write ? "WROTE" : "DRY RUN"}: ${total} outcomes · already official ${already} · replaced ${replaced} · left ${total - already - replaced}`);
