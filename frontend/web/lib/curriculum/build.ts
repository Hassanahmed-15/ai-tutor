import type { BuildReport, CurriculumTree, ExtractedRow, GradeBlock, Outcome, RegistryEntry } from "./types";

/**
 * THE CHECKED PART of the curriculum pipeline, as pure functions (tests:
 * lib/anim/curriculumBuild.test.ts). The model reads pages into flat rows; everything that decides
 * whether the result is complete and trustworthy happens here, in code:
 *
 *   - `codesInText` lists every outcome code the source really contains (the registry's pattern),
 *     so "100% of the syllabus" is a number, not a feeling;
 *   - `mergeRows` keeps one row per code and drops any code the source does not contain (a model
 *     that invents "P-09-Z-99" is caught here);
 *   - `buildTree` groups rows into grade → unit → topic → subtopic in the order the source gives.
 */

/**
 * Same code however a PDF or a model spelled it: plain hyphens, no brackets, no spaces around a
 * hyphen or dot ("M- 9-A- 01" and "U-01-A-[02" are printed that way in NCP tables).
 */
export function normalizeCode(code: string): string {
  return code
    .replace(/[‐-―−]/g, "-")
    .replace(/[[\]{}()]/g, "")
    .replace(/\s*([-.])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every distinct code the pattern finds, in order of first appearance, with the pages it is on (0-based). */
export function codesInText(pages: string[], pattern: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const re = new RegExp(pattern, "g");
  pages.forEach((page, i) => {
    // Codes are matched on dash-normalised text, so "P–09–A–01" in one table counts as "P-09-A-01".
    const text = page.replace(/[‐-―−]/g, "-");
    for (const m of text.matchAll(re)) {
      const code = normalizeCode(m[0]);
      const at = found.get(code);
      if (!at) found.set(code, [i]);
      else if (at[at.length - 1] !== i) at.push(i);
    }
  });
  return found;
}

/** Lowercase letters and digits only: "Unit 1: Forces" and "UNIT 1 – forces" are one heading. */
export function headingKey(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
}

export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/**
 * One row per code; rows without a code de-duplicated by their place and wording. With `expected`
 * (the codes the source contains), a row whose code is not in the source is dropped and counted.
 */
export function mergeRows(rows: ExtractedRow[], expected?: Set<string> | ((code: string) => boolean) | null): { rows: ExtractedRow[]; invented: string[] } {
  const real = expected instanceof Set ? (c: string) => expected.has(c) : expected;
  const seenCodes = new Set<string>();
  const seenText = new Set<string>();
  const out: ExtractedRow[] = [];
  const invented: string[] = [];
  for (const raw of rows) {
    const row: ExtractedRow = {
      grade: cleanTitle(raw.grade),
      unit: cleanTitle(raw.unit),
      topic: cleanTitle(raw.topic),
      subtopic: cleanTitle(raw.subtopic) || cleanTitle(raw.topic),
      code: raw.code ? normalizeCode(raw.code) : null,
      outcome: cleanTitle(raw.outcome),
    };
    if (!row.unit || !row.topic || !row.outcome) continue;
    if (row.code) {
      if (real && !real(row.code)) {
        invented.push(row.code);
        continue;
      }
      if (seenCodes.has(row.code)) continue;
      seenCodes.add(row.code);
    } else {
      const key = [row.grade, row.unit, row.topic, row.subtopic, row.outcome].map(headingKey).join("|");
      if (seenText.has(key)) continue;
      seenText.add(key);
    }
    out.push(row);
  }
  return { rows: out, invented };
}

/** A url-safe id from a title, unique among its siblings. */
export function slugId(title: string, taken: Set<string>): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

type Node<C> = { title: string; children: Map<string, C>; ids: Set<string> };

/**
 * Rows → grade → unit → topic → subtopic, in the order each heading first appears. A heading that
 * reappears later (the model carried context across a page break) joins its first occurrence.
 * Grades follow `gradeOrder` when given (the registry's list), else first appearance.
 */
export function buildTree(rows: ExtractedRow[], gradeOrder?: string[]): GradeBlock[] {
  type Sub = { title: string; outcomes: Outcome[] };
  type Top = Node<Sub>;
  type Uni = Node<Top>;
  const grades = new Map<string, Map<string, Uni>>();
  for (const row of rows) {
    const g = row.grade || "all";
    if (!grades.has(g)) grades.set(g, new Map());
    const units = grades.get(g)!;
    const uk = headingKey(row.unit);
    if (!units.has(uk)) units.set(uk, { title: row.unit, children: new Map(), ids: new Set() });
    const unit = units.get(uk)!;
    const tk = headingKey(row.topic);
    if (!unit.children.has(tk)) unit.children.set(tk, { title: row.topic, children: new Map(), ids: new Set() });
    const topic = unit.children.get(tk)!;
    const sk = headingKey(row.subtopic);
    if (!topic.children.has(sk)) topic.children.set(sk, { title: row.subtopic, outcomes: [] });
    topic.children.get(sk)!.outcomes.push({ code: row.code, text: row.outcome });
  }
  const order = [...grades.keys()];
  if (gradeOrder?.length) {
    const rank = (g: string) => {
      const i = gradeOrder.indexOf(g);
      return i === -1 ? gradeOrder.length + order.indexOf(g) : i;
    };
    order.sort((a, b) => rank(a) - rank(b));
  }
  return order.map((grade) => {
    const unitIds = new Set<string>();
    return {
      grade,
      units: [...grades.get(grade)!.values()].map((u) => {
        const topicIds = new Set<string>();
        return {
          id: slugId(u.title, unitIds),
          title: u.title,
          topics: [...u.children.values()].map((t) => {
            const subIds = new Set<string>();
            return {
              id: slugId(t.title, topicIds),
              title: t.title,
              subtopics: [...t.children.values()].map((s) => ({ id: slugId(s.title, subIds), title: s.title, outcomes: s.outcomes })),
            };
          }),
        };
      }),
    };
  });
}

export function countTree(grades: GradeBlock[]): BuildReport["counts"] {
  const c = { grades: grades.length, units: 0, topics: 0, subtopics: 0, outcomes: 0 };
  for (const g of grades) {
    c.units += g.units.length;
    for (const u of g.units) {
      c.topics += u.topics.length;
      for (const t of u.topics) {
        c.subtopics += t.subtopics.length;
        for (const s of t.subtopics) c.outcomes += s.outcomes.length;
      }
    }
  }
  return c;
}

/** Codes in the tree, for the coverage check. */
export function treeCodes(grades: GradeBlock[]): Set<string> {
  const codes = new Set<string>();
  for (const g of grades) for (const u of g.units) for (const t of u.topics) for (const s of t.subtopics) for (const o of s.outcomes) if (o.code) codes.add(o.code);
  return codes;
}

/**
 * Structural warnings a person should look at: empty grades, a unit with a single outcome (often a
 * heading misread as content), subtopics far too big to be one lesson.
 */
export function structureWarnings(grades: GradeBlock[], expectedGrades: string[]): string[] {
  const w: string[] = [];
  const present = new Set(grades.map((g) => g.grade));
  for (const g of expectedGrades) if (!present.has(g)) w.push(`grade ${g} has no content`);
  for (const g of grades) {
    if (expectedGrades.length && !expectedGrades.includes(g.grade)) w.push(`unexpected grade label "${g.grade}"`);
    for (const u of g.units) {
      const outcomes = u.topics.reduce((n, t) => n + t.subtopics.reduce((m, s) => m + s.outcomes.length, 0), 0);
      if (outcomes === 1) w.push(`unit "${u.title}" (grade ${g.grade}) has a single outcome`);
      for (const t of u.topics) for (const s of t.subtopics) {
        if (s.outcomes.length > 14) w.push(`subtopic "${s.title}" has ${s.outcomes.length} outcomes — too big for one lesson`);
      }
    }
  }
  return w;
}

/** The finished tree with its report. */
export function assembleTree(
  entry: RegistryEntry,
  rows: ExtractedRow[],
  opts: { expected: string[] | null; model: string; usd: number; builtAt: string; extraWarnings?: string[] },
): CurriculumTree {
  const grades = buildTree(rows, entry.grades);
  const codes = treeCodes(grades);
  // A section number ("1.1") is covered when its own statements ("1.1.1", "1.1.2") are in the tree:
  // the heading itself has no learning outcome to teach.
  const sectionCovered = (c: string) => [...codes].some((x) => x.startsWith(`${c}.`) && x.length > c.length + 1);
  const missing = opts.expected ? opts.expected.filter((c) => !codes.has(c) && !sectionCovered(c)) : [];
  return {
    id: entry.id,
    region: entry.region,
    framework: entry.framework,
    board: entry.board,
    qualification: entry.qualification,
    subject: entry.subject,
    syllabusCode: entry.syllabusCode,
    gradeSystem: entry.gradeSystem,
    source: { urls: entry.sourceUrls, publisher: entry.publisher, licence: entry.licence, firstExam: entry.firstExam ?? null },
    grades,
    build: {
      builtAt: opts.builtAt,
      model: opts.model,
      usd: Math.round(opts.usd * 10_000) / 10_000,
      expectedCodes: opts.expected ? opts.expected.length : null,
      coverage: opts.expected ? (opts.expected.length ? (opts.expected.length - missing.length) / opts.expected.length : 1) : null,
      missingCodes: missing,
      counts: countTree(grades),
      warnings: [...(opts.extraWarnings ?? []), ...structureWarnings(grades, entry.grades)],
    },
  };
}

/* ── The outline pass and the lesson pass ───────────────────────────────────────────────────── */

export type Outline = { units: Array<{ grade: string; title: string; topics: string[] }> };

const HEADING_START = /^\s*(?:(?:unit|chapter|domain|strand|topic|section|theme|module|part|benchmark|standard|sub-?strand|key stage|stage|grade|year|class|cluster|big idea|course)\b|[A-Z]?\d{1,2}(?:\.\d{1,2}){0,3}[.)]?\s+[A-Z(]|[A-Z][.:)]\s+[A-Z]|[IVX]{1,5}[.)]\s)/i;

/**
 * The lines of a document that could be headings, page-tagged — enough for a model to see the
 * whole document's structure in one read. A heading is short, starts like a heading, or is a short
 * line in Title Case without a full stop. Capped at `maxChars` by dropping the weakest lines first.
 */
export function headingCandidates(pages: string[], maxChars = 90_000): string {
  type L = { page: number; text: string; strong: boolean };
  const lines: L[] = [];
  pages.forEach((page, i) => {
    for (const rawLine of page.split("\n")) {
      // Two-column layouts: each column is its own candidate.
      for (const part of rawLine.split(/\s{4,}/)) {
        const text = part.replace(/\s+/g, " ").trim();
        if (text.length < 3 || text.length > 110 || /^\d+$/.test(text)) continue;
        const strong = HEADING_START.test(text);
        const words = text.split(" ");
        const titleCase = words.length <= 12 && !/[.;]$/.test(text) && words.filter((w) => /^[A-Z]/.test(w)).length >= Math.ceil(words.length * 0.6);
        // "Translatory motion:" — a short label ending in a colon introduces a block.
        const label = words.length <= 8 && /:$/.test(text);
        if (strong || titleCase || label) lines.push({ page: i, text, strong });
      }
    }
  });
  const render = (keep: L[]) => {
    const out: string[] = [];
    let page = -1;
    for (const l of keep) {
      if (l.page !== page) {
        out.push(`[p${l.page + 1}]`);
        page = l.page;
      }
      out.push(l.text);
    }
    return out.join("\n");
  };
  let text = render(lines);
  if (text.length > maxChars) text = render(lines.filter((l) => l.strong));
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 2 && !["unit", "domain", "chapter", "topic", "the", "and"].includes(w)));
}
function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / Math.min(x.size, y.size);
}

/**
 * Every row's unit and topic renamed to the outline's (same grade first, then any grade), so pieces
 * of the document read separately still land in one structure. Rows that match nothing keep their
 * names and are counted.
 */
export function snapToOutline(rows: ExtractedRow[], outline: Outline): { rows: ExtractedRow[]; unmatched: number } {
  let unmatched = 0;
  const out = rows.map((r) => {
    const sameGrade = outline.units.filter((u) => u.grade === r.grade || u.grade === "all" || r.grade === "all");
    const pool = sameGrade.length ? sameGrade : outline.units;
    let unit = pool.find((u) => headingKey(u.title) === headingKey(r.unit));
    if (!unit) {
      // The row's topic is often the better clue (a chunk may name the unit differently).
      let best = 0;
      for (const u of pool) {
        const s = Math.max(similarity(u.title, r.unit), ...u.topics.map((t) => similarity(t, r.topic) * 0.9));
        if (s > best) { best = s; unit = u; }
      }
      if (best < 0.5) unit = undefined;
    }
    if (!unit) {
      unmatched++;
      return r;
    }
    let topic = unit.topics.find((t) => headingKey(t) === headingKey(r.topic));
    if (!topic) {
      let best = 0;
      for (const t of unit.topics) {
        const s = Math.max(similarity(t, r.topic), similarity(t, r.subtopic) * 0.8);
        if (s > best) { best = s; topic = t; }
      }
      if (best < 0.5) topic = undefined;
    }
    return { ...r, grade: unit.grade === "all" ? r.grade : unit.grade, unit: unit.title, topic: topic ?? r.topic };
  });
  return { rows: out, unmatched };
}

/**
 * Lessons for one topic: `groups` lists, for each lesson, the indexes (into `rows`) it teaches.
 * Accepted only if every row is used exactly once and no lesson is empty; otherwise null (the
 * caller keeps the printed subtopics).
 */
export function applyLessonGroups(rows: ExtractedRow[], groups: Array<{ title: string; items: number[] }>): ExtractedRow[] | null {
  const seen = new Set<number>();
  for (const g of groups) {
    if (!g.title.trim() || !g.items.length) return null;
    for (const i of g.items) {
      if (!Number.isInteger(i) || i < 0 || i >= rows.length || seen.has(i)) return null;
      seen.add(i);
    }
  }
  if (seen.size !== rows.length) return null;
  const lessonOf = new Map<number, string>();
  for (const g of groups) for (const i of g.items) lessonOf.set(i, cleanTitle(g.title));
  return rows.map((r, i) => ({ ...r, subtopic: lessonOf.get(i)! }));
}

/**
 * The grade an outcome code names (see RegistryEntry.gradeFromCode), when it is one of `grades`.
 * Rows whose code names a grade are moved to it; returns how many moved.
 */
export function gradesFromCodes(rows: ExtractedRow[], pattern: string, grades: string[]): number {
  const re = new RegExp(pattern);
  let moved = 0;
  for (const r of rows) {
    if (!r.code) continue;
    const m = re.exec(r.code);
    if (!m?.[1]) continue;
    const g = m[1].replace(/^0+(?=\d)/, "");
    const label = grades.find((x) => x.toLowerCase() === g.toLowerCase());
    if (label && label !== r.grade) {
      r.grade = label;
      moved++;
    }
  }
  return moved;
}

/** Distinct (grade, unit, topic) places in reading order, with how many rows each holds. */
export function distinctPlaces(rows: ExtractedRow[]): Array<{ grade: string; unit: string; topic: string; count: number; sample: string }> {
  const seen = new Map<string, { grade: string; unit: string; topic: string; count: number; sample: string }>();
  for (const r of rows) {
    const k = `${r.grade}|${r.unit}|${r.topic}`;
    const at = seen.get(k);
    if (at) at.count++;
    else seen.set(k, { grade: r.grade, unit: r.unit, topic: r.topic, count: 1, sample: r.outcome });
  }
  return [...seen.values()];
}

/** Renames every row's unit/topic by `map` (index into distinctPlaces); null if the map is incomplete. */
export function renamePlaces(rows: ExtractedRow[], places: ReturnType<typeof distinctPlaces>, map: Array<{ i: number; unit: string; topic: string }>): ExtractedRow[] | null {
  const to = new Map<string, { unit: string; topic: string }>();
  for (const m of map) {
    const p = places[m.i];
    if (!p || !m.unit.trim() || !m.topic.trim()) return null;
    to.set(`${p.grade}|${p.unit}|${p.topic}`, { unit: cleanTitle(m.unit), topic: cleanTitle(m.topic) });
  }
  if (to.size !== places.length) return null;
  return rows.map((r) => ({ ...r, ...to.get(`${r.grade}|${r.unit}|${r.topic}`)! }));
}

const GRADE_CODE_PATTERNS = [
  "^[A-Z]{1,4}-(\\d{1,2})-", // Pakistan NCP: P-09-B-03, CS-11-A-01
  "^(K|\\d{1,2})\\.", // Common Core: K.CC.1, 3.NF.A.1
  "^(K|\\d)-[A-Z]{2,4}\\d", // NGSS elementary: K-PS2-1, 3-LS1-1
  "^AC9[A-Z]+?(F|10|\\d)[A-Z]", // ACARA v9: AC9M7N01, AC9MFN01
  "^(\\d{1,2})[A-Z][A-Za-z]{0,3}\\.", // Cambridge frameworks: 7Bp.01, 3Nc.02
];

/**
 * A gradeFromCode pattern for an entry that has none: the first known code shape that reads a
 * listed grade out of at least 80% of the sample codes. Null when none fits.
 */
export function inferGradeFromCode(sampleCodes: string[], grades: string[]): string | null {
  const codes = sampleCodes.map(normalizeCode).filter(Boolean);
  if (codes.length < 2) return null;
  const lower = new Set(grades.map((g) => g.toLowerCase()));
  for (const p of GRADE_CODE_PATTERNS) {
    const re = new RegExp(p);
    const hits = codes.filter((c) => {
      const m = re.exec(c)?.[1];
      return m !== undefined && lower.has(m.replace(/^0+(?=\d)/, "").toLowerCase());
    }).length;
    if (hits / codes.length >= 0.8) return p;
  }
  return null;
}

/**
 * Whether a code is printed in the source, ignoring spaces and line breaks — a pattern can miss a
 * code a table wrapped over two lines ("ECE-00-" / "A1-01") that the model read correctly.
 */
export function codeInSource(pages: string[]): (code: string) => boolean {
  const flat = pages.join("").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\s[\]{}()]+/g, "");
  return (code: string) => code.length >= 3 && flat.includes(code.replace(/\s+/g, ""));
}
