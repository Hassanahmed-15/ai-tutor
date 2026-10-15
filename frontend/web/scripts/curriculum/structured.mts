/**
 * STRUCTURED SOURCES → CHECKED CURRICULUM TREES (the PDF path is extract.mts).
 *
 *   node --import tsx scripts/curriculum/structured.mts --region US|UK|AU [--dry] [--force] [ids…]
 *
 * Readers, each turning ready-made data into the same flat rows the PDF path produces:
 *   - csp:   Common Standards Project standard sets (US states, Common Core, NGSS), CC BY 3.0 US.
 *            Flat dict of standards with parentId/depth/position; codes in statementNotation.
 *   - oak:   Oak National Academy programme pages (OGL v3): the page's RSC payload carries
 *            curriculumUnitsFormattedData — years → units in order → lessons. Oak's lessons ARE
 *            lessons, so no model call at all.
 *   - acara: Australian Curriculum v9 JSON-LD (CC BY 4.0): Level → Strand → Sub-strand → Content
 *            description (code + text) → Elaboration.
 *
 * Every code the source holds is in the tree (coverage is checked like the PDFs). Long headings
 * get short names, and outcomes are grouped into lessons, by the same passes as extract.mts.
 */
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { assembleTree, cleanTitle, headingKey } from "../../lib/curriculum/build";
import type { ExtractedRow, RegistryEntry } from "../../lib/curriculum/types";
import { MODEL, askJson, groupLessons, loadEnv, loadRegistry, pool, writeTree, type Usage } from "./extract.mts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TREES_DIR = process.env.CURRICULUM_TREES_DIR ?? path.join(ROOT, "data/curricula/trees");
const CACHE = path.join(ROOT, ".curricula-raw/.api");

type Reader = "csp" | "oak" | "acara";
function readerFor(e: RegistryEntry): Reader | null {
  const urls = e.sourceUrls.join(" ");
  if (/commonstandardsproject\.com/.test(urls) && e.sourceKind === "api") return "csp";
  if (/thenational\.academy\/teachers\/programmes/.test(urls)) return "oak";
  if (e.localFiles.some((f) => f.endsWith(".jsonld"))) return "acara";
  return null;
}

async function cached(url: string, name: string): Promise<string> {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Aria curriculum catalogue)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      fs.writeFileSync(file, text);
      return text;
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 1_500 * attempt));
    }
  }
}

/* ── csp ─────────────────────────────────────────────────────────────────────────────────── */

type CspStandard = { id: string; position: number; depth: number; parentId?: string | null; ancestorIds?: string[] | null; statementNotation?: string | null; statementLabel?: string | null; description?: string | null };
type CspSet = { id: string; title: string; subject: string; educationLevels: string[]; standards: Record<string, CspStandard>; license?: { title?: string; rightsHolder?: string } };

/** "05" → "5", "Pre-K" → "PK", several → "9-12"; matched to the entry's own labels when it can be. */
export function cspGrade(levels: string[], grades: string[]): string {
  const norm = (l: string) => (/^pre-?k|^pk$/i.test(l) ? "PK" : /^k$/i.test(l) ? "K" : l.replace(/^0+(?=\d)/, ""));
  // Sets list their levels in any order (["01","02","K"], ["09","10","12","11"]): a band runs from the
  // lowest to the highest, or K-4 came out "1-K" and 9-12 "9-11" (audit, 2026-10-14).
  const ORDER = ["PK", "K", ...Array.from({ length: 12 }, (_, i) => String(i + 1))];
  const rank = (l: string) => { const i = ORDER.indexOf(l.toUpperCase()); return i < 0 ? 99 : i; };
  const ls = [...new Set(levels.map(norm))].sort((a, b) => rank(a) - rank(b));
  if (!ls.length) return "all";
  if (ls.length === 1) return grades.find((g) => g.toLowerCase() === ls[0].toLowerCase()) ?? ls[0];
  return `${ls[0]}-${ls[ls.length - 1]}`;
}

export const PLACEHOLDER = /^(not applicable|n\/?a|none|no standards? (at|for) this (level|grade)( level)?|intentionally (left )?blank|incorporated into\b.*|see\s+[A-Z0-9][\w.-]*)\.?$/i;

/**
 * One set → rows. Leaves are standards nobody hangs under; a standard whose notation prefixes the
 * standards after it (Texas "5.2" before "5.2.A") is their heading even when the data lists them
 * as siblings. unit = the depth-0 heading, topic = the next one down, subtopic = the one below.
 */
export function cspRows(set: CspSet, grades: string[]): ExtractedRow[] {
  const all = Object.values(set.standards).sort((a, b) => a.position - b.position);
  const byId = new Map(all.map((s) => [s.id, s]));
  // Some sets leave parentId null and record the parent only as the last of ancestorIds.
  const parentOf = (s: CspStandard) => s.parentId || s.ancestorIds?.[s.ancestorIds.length - 1] || null;
  const hasChild = new Set(all.map(parentOf).filter(Boolean) as string[]);
  // Notation-prefix headings among siblings.
  const headOf = new Map<string, CspStandard>();
  const isHead = new Set<string>();
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    const n = s.statementNotation?.trim();
    if (!n) continue;
    for (let j = i + 1; j < all.length && parentOf(all[j]) === parentOf(s); j++) {
      const m = all[j].statementNotation?.trim();
      if (!m || !(m.startsWith(`${n}.`) || (m.startsWith(n) && /^[A-Za-z(]/.test(m.slice(n.length))))) break;
      headOf.set(all[j].id, s);
      isHead.add(s.id);
    }
  }
  const grade = cspGrade(set.educationLevels ?? [], grades);
  const text = (s: CspStandard | undefined) => cleanTitle((s?.description ?? s?.statementLabel ?? "").replace(/<[^>]+>/g, " "));
  const rows: ExtractedRow[] = [];
  for (const s of all) {
    if (hasChild.has(s.id) || isHead.has(s.id)) continue;
    const chain: CspStandard[] = [];
    let p = parentOf(s) ? byId.get(parentOf(s)!) : undefined;
    while (p) {
      chain.unshift(p);
      p = parentOf(p) ? byId.get(parentOf(p)!) : undefined;
    }
    const head = headOf.get(s.id);
    if (head) chain.push(head);
    const outcome = text(s);
    // Placeholders some sets print where a grade has no standard ("Not applicable.", "No standard at
    // this level.", "Incorporated into SES-MS-PS1-6.") are not something to teach.
    if (!outcome || PLACEHOLDER.test(outcome)) continue;
    rows.push({
      grade,
      unit: text(chain[0]) || set.title,
      topic: text(chain[1]) || text(chain[0]) || set.title,
      subtopic: text(chain[2]) || "",
      code: s.statementNotation?.trim() || null,
      outcome,
      // Which set it came from: two disciplines (Music, Theatre) may print the same statement.
      set: set.id,
    } as ExtractedRow);
  }
  return rows;
}

async function readCsp(e: RegistryEntry): Promise<{ rows: ExtractedRow[]; licence: string }> {
  let setUrls = e.sourceUrls.filter((u) => /\/standard_sets\//.test(u));
  if (!setUrls.length) {
    // Only the jurisdiction is listed (Common Core, NGSS): its sets for this subject, from its index.
    const jUrl = e.sourceUrls.find((u) => /\/jurisdictions\//.test(u));
    if (jUrl) {
      const j = JSON.parse(await cached(jUrl, `csp-j-${jUrl.split("/jurisdictions/")[1]}.json`)) as { data: { standardSets: Array<{ id: string; subject: string }> } };
      const want = e.subject.trim().toLowerCase();
      setUrls = j.data.standardSets
        .filter((s) => {
          const got = s.subject.trim().toLowerCase();
          return got === want || got.includes(want) || want.includes(got);
        })
        .map((s) => `https://api.commonstandardsproject.com/api/v1/standard_sets/${s.id}`);
    }
  }
  const sets = await pool(setUrls, 4, async (u) => {
    const id = u.split("/standard_sets/")[1];
    const json = JSON.parse(await cached(u, `csp-${id}.json`)) as { data: CspSet };
    return json.data;
  });
  const licences = new Set(sets.map((s) => [s.license?.title, s.license?.rightsHolder].filter(Boolean).join(", ")).filter(Boolean));
  return { rows: withoutDuplicateSets(sets.map((s) => cspRows(s, e.grades))), licence: [...licences].join("; ") };
}

/**
 * A jurisdiction sometimes publishes the same standards twice for one grade (Nebraska: an ASN
 * "Grades 9-12" set AND five Common Curriculum HS sets with 82 of its 85 statements). A set whose
 * statements are mostly (≥80%) in the other sets of its grade keeps only the ones it alone has —
 * largest first, so the finer-grained sets win. Sets that merely share a few statements (an arts
 * statement in both Music and Theatre) keep them all: each discipline teaches it.
 */
export function withoutDuplicateSets(perSet: ExtractedRow[][]): ExtractedRow[] {
  const key = (r: ExtractedRow) => `${r.grade}|${(r.code ?? "").toLowerCase()}|${r.outcome.replace(/\s+/g, " ").trim().toLowerCase()}`;
  const kept = perSet.map((rows) => [...rows]);
  const order = kept.map((_, i) => i).sort((a, b) => kept[b].length - kept[a].length);
  for (const i of order) {
    if (!kept[i].length) continue;
    const others = new Set(kept.flatMap((rows, j) => (j === i ? [] : rows.map(key))));
    const shared = kept[i].filter((r) => others.has(key(r))).length;
    if (shared / kept[i].length >= 0.8) kept[i] = kept[i].filter((r) => !others.has(key(r)));
  }
  return kept.flat();
}

/* ── oak ─────────────────────────────────────────────────────────────────────────────────── */

type OakUnit = { order: number; slug: string; title: string; tier_slug?: string | null; subject?: string; threads?: Array<{ title: string }>; lessons?: Array<{ title: string; _state?: string }> };

/** The JSON object that starts right after `key` in `text` (balanced braces, strings respected). */
export function objectAfter(text: string, key: string): unknown {
  const at = text.indexOf(key);
  if (at < 0) return null;
  const start = text.indexOf("{", at + key.length);
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return null;
}

/** The RSC payload of a Next.js page: every self.__next_f.push([1,"…"]) string, decoded and joined. */
export function rscPayload(html: string): string {
  const out: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out.push(JSON.parse(m[1]) as string);
    } catch {
      // A chunk that is not a plain string: skip it.
    }
  }
  return out.join("");
}

export function oakRows(data: { yearData: Record<string, { units: OakUnit[] }> }, grades: string[]): ExtractedRow[] {
  const rows: ExtractedRow[] = [];
  const years = Object.keys(data.yearData).sort((a, b) => (Number(a) || 99) - (Number(b) || 99));
  for (const y of years) {
    const label = grades.find((g) => g.replace(/\D/g, "") === y) ?? (/^\d+$/.test(y) ? `Year ${y}` : y);
    const units = [...data.yearData[y].units].sort((a, b) => a.order - b.order);
    // KS4 lists a foundation and a higher copy of tiered units: keep higher, which covers both.
    const higher = new Set(units.filter((u) => u.tier_slug === "higher").map((u) => u.slug));
    const seen = new Set<string>();
    for (const u of units) {
      if (u.tier_slug === "foundation" && higher.has(u.slug)) continue;
      const key = `${u.slug}|${u.subject ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const unit = cleanTitle(u.threads?.[0]?.title ?? u.subject ?? "Units");
      for (const l of u.lessons ?? []) {
        if (!l.title) continue;
        rows.push({ grade: label, unit, topic: cleanTitle(u.title), subtopic: cleanTitle(l.title), code: null, outcome: cleanTitle(l.title) });
      }
    }
  }
  return rows;
}

async function readOak(e: RegistryEntry): Promise<{ rows: ExtractedRow[]; licence: string }> {
  const local = e.localFiles.find((f) => /\.html?$/.test(f));
  const html = local && fs.existsSync(path.join(ROOT, local)) ? fs.readFileSync(path.join(ROOT, local), "utf8") : await cached(e.sourceUrls[0], `oak-${e.id}.html`);
  const data = objectAfter(rscPayload(html), '"curriculumUnitsFormattedData":') as { yearData: Record<string, { units: OakUnit[] }> } | null;
  if (!data?.yearData) throw new Error("no curriculumUnitsFormattedData in the page");
  return { rows: oakRows(data, e.grades), licence: "Contains Oak National Academy content licensed under the Open Government Licence v3.0" };
}

/* ── acara ───────────────────────────────────────────────────────────────────────────────── */

const P = {
  notation: "http://purl.org/ASN/schema/core/statementNotation",
  label: "http://purl.org/ASN/schema/core/statementLabel",
  description: "http://purl.org/dc/terms/description",
  title: "http://purl.org/dc/terms/title",
  child: "http://purl.org/gem/qualifiers/hasChild",
};
type LdNode = Record<string, Array<{ "@value"?: string; "@id"?: string }>> & { "@id": string };
const ldValue = (n: LdNode | undefined, k: string) => cleanTitle((n?.[k]?.[0]?.["@value"] ?? "").replace(/<[^>]+>/g, " "));

const acaraGraphs = new Map<string, Map<string, LdNode>>();
function acaraGraph(file: string): Map<string, LdNode> {
  if (!acaraGraphs.has(file)) {
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{ "@graph": LdNode[] }>;
    acaraGraphs.set(file, new Map(doc.flatMap((d) => d["@graph"]).map((n) => [n["@id"], n])));
  }
  return acaraGraphs.get(file)!;
}

export function acaraGrade(title: string, grades: string[]): string {
  if (/foundation/i.test(title)) return grades.find((g) => /^f/i.test(g)) ?? "Foundation";
  const nums = title.match(/\d+/g) ?? [];
  if (nums.length === 1) return grades.find((g) => g === nums[0]) ?? nums[0];
  if (nums.length > 1) return `${nums[0]}-${nums[nums.length - 1]}`;
  return title;
}

function readAcara(e: RegistryEntry): { rows: ExtractedRow[]; licence: string } {
  const file = path.join(ROOT, e.localFiles.find((f) => f.endsWith(".jsonld"))!);
  const graph = acaraGraph(file);
  const root = /statementNotation = '([^']+)'/.exec(e.notes ?? "")?.[1];
  const start = [...graph.values()].find((n) => ldValue(n, P.notation) === root);
  if (!start) throw new Error(`no node with notation ${root}`);
  const rows: ExtractedRow[] = [];
  const kids = (n: LdNode) => (n[P.child] ?? []).map((c) => graph.get(c["@id"]!)).filter(Boolean) as LdNode[];
  const walk = (n: LdNode, ctx: { grade?: string; strand?: string; sub?: string }) => {
    const label = ldValue(n, P.label).toLowerCase();
    if (label === "elaboration" || label.startsWith("achievement standard") || label === "level description") return;
    if (label === "content description") {
      rows.push({
        grade: ctx.grade ?? "all",
        unit: ctx.strand ?? e.subject,
        topic: ctx.sub ?? ctx.strand ?? e.subject,
        subtopic: "",
        code: ldValue(n, P.notation) || null,
        outcome: ldValue(n, P.description),
      });
      return;
    }
    const name = ldValue(n, P.title) || ldValue(n, P.description);
    const next = { ...ctx };
    if (label === "level") next.grade = acaraGrade(name, e.grades);
    else if (label === "strand") { next.strand = name; next.sub = undefined; }
    else if (label === "sub-strand") next.sub = name;
    for (const c of kids(n)) walk(c, next);
  };
  walk(start, {});
  return { rows, licence: "© ACARA, Australian Curriculum v9.0, CC BY 4.0" };
}

/* ── shared finish ───────────────────────────────────────────────────────────────────────── */

const TITLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titles"],
  properties: { titles: { type: "array", items: { type: "object", additionalProperties: false, required: ["i", "title"], properties: { i: { type: "integer" }, title: { type: "string" } } } } },
};

/** Headings that are really sentences ("The student applies mathematical process standards…") get 2-6 word names. */
async function shortHeadings(client: OpenAI, e: RegistryEntry, rows: ExtractedRow[], spent: Usage, warnings: string[]): Promise<ExtractedRow[]> {
  const long = [...new Set(rows.flatMap((r) => [r.unit, r.topic, r.subtopic]).filter((h) => h && (h.length > 60 || /\.$/.test(h))))];
  if (!long.length) return rows;
  const names = new Map<string, string>();
  const system = `You name sections of a school curriculum (${e.framework}, ${e.subject}). Each numbered item is a section heading written as a sentence. Give each a 2-6 word name a student understands (e.g. "Place value with decimals"). Keep any leading code or number off. Return every number once.`;
  await pool(Array.from({ length: Math.ceil(long.length / 120) }, (_, k) => long.slice(k * 120, k * 120 + 120)), 4, async (batch) => {
    try {
      const res = await askJson<{ titles: Array<{ i: number; title: string }> }>(client, MODEL, system, batch.map((h, i) => `${i}. ${h}`).join("\n"), "short_titles", TITLES_SCHEMA, spent);
      for (const t of res?.titles ?? []) if (batch[t.i] && t.title.trim()) names.set(batch[t.i], cleanTitle(t.title));
    } catch {
      warnings.push("some long headings kept as written");
    }
  });
  const n = (h: string) => names.get(h) ?? h;
  return rows.map((r) => ({ ...r, unit: n(r.unit), topic: n(r.topic), subtopic: r.subtopic ? n(r.subtopic) : "" }));
}

/** A heading as the source prints it, minus a leading code ("K.CN.1 Relate…" → "Relate…") and a closing full stop. */
export function officialHeading(h: string): string {
  return h.replace(/^\s*[\w.()-]*\d[\w.()-]*\s+(?=[A-Z])/, "").replace(/\s+/g, " ").trim().replace(/[.;]$/, "");
}

/** A heading written as a sentence, cut at its first natural break (no model): "The student applies…, and…" → first clause. */
export function shortHeading(h: string): string {
  let t = h.replace(/^\s*[\w.()-]*\d[\w.()-]*\s+(?=[A-Z])/, "").trim();
  // "The student applies mathematical process standards to represent…" → "Represent…"
  const lead = /^(?:the\s+)?students?\s+(?:(?:is|are)\s+expected\s+to\s+|will\s+|can\s+)?(?:[a-z]+\s+){0,6}?(?:to|that|how|about)\s+/i.exec(t);
  if (lead && lead[0].length < 70) t = t.slice(lead[0].length);
  else t = t.replace(/^(?:the\s+)?students?\s+/i, "");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length <= 70) return t.replace(/\.$/, "");
  const cut = t.slice(0, 70).search(/[:;,—–](?=[^:;,—–]*$)/);
  if (cut > 25) return t.slice(0, cut).trim();
  return `${t.slice(0, 70).replace(/\s+\S*$/, "")}…`;
}

/**
 * Lessons without a model: a printed subtopic is a lesson; otherwise a topic of up to six standards
 * is one lesson, and a longer one is cut into consecutive lessons of up to five.
 */
export function freeLessons(rows: ExtractedRow[]): ExtractedRow[] {
  const out = rows.map((r) => ({ ...r }));
  const groups = new Map<string, number[]>();
  out.forEach((r, i) => {
    if (r.subtopic) return;
    const k = `${r.grade}|${r.unit}|${r.topic}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  });
  for (const idx of groups.values()) {
    const parts = idx.length <= 6 ? 1 : Math.ceil(idx.length / 5);
    const size = Math.ceil(idx.length / parts);
    idx.forEach((ri, k) => {
      const part = Math.floor(k / size) + 1;
      out[ri].subtopic = parts === 1 ? out[ri].topic : `${out[ri].topic} (${part} of ${parts})`;
    });
  }
  return out;
}

async function buildOne(e: RegistryEntry, reader: Reader, client: OpenAI | null, concurrency: number, free = false): Promise<string> {
  const read = reader === "csp" ? await readCsp(e) : reader === "oak" ? await readOak(e) : readAcara(e);
  let rows = read.rows;
  if (!client && !free) return `${e.id}: ${reader} ${rows.length} rows, ${new Set(rows.map((r) => r.grade)).size} grades`;
  if (!rows.length) throw new Error("the source has no standards");
  const spent: Usage = { usd: 0 };
  const warnings: string[] = [];
  // Codes the source holds (deduplicated): the tree must carry every one.
  const expected = [...new Set(rows.map((r) => r.code).filter(Boolean) as string[])];
  // Only true repeats go (same grade, discipline, code AND wording). Standards data reuses a code for different
  // statements — list letters "E", "F" under every parent, one code across arts disciplines — and
  // keying on grade + code alone dropped 9,481 official statements from 126 courses (verify.mts).
  const seen = new Set<string>();
  // The source set (a discipline) is part of it: Music and Theatre may both print 2.PR.2.1.
  const key = (r: ExtractedRow) => `${r.grade}|${(r as { set?: string }).set ?? r.unit}|${r.code}|${r.outcome.replace(/\s+/g, " ").trim().toLowerCase()}`;
  rows = rows.filter((r) => (r.code ? (seen.has(key(r)) ? false : (seen.add(key(r)), true)) : true));
  if (reader !== "oak" && client) {
    rows = await shortHeadings(client, e, rows, spent, warnings);
    rows = await groupLessons(client, e, rows.map((r) => ({ ...r, subtopic: r.subtopic })), concurrency, spent, warnings);
  } else if (reader !== "oak") {
    // Headings keep the official wording (owner, 2026-10-14: content must match the source exactly);
    // shortHeading cut them mid-clause ("Explore where (spatial) and why people").
    rows = freeLessons(rows.map((r) => ({ ...r, unit: officialHeading(r.unit), topic: officialHeading(r.topic), subtopic: r.subtopic ? officialHeading(r.subtopic) : "" })));
  }
  const tree = assembleTree({ ...e, licence: read.licence || e.licence }, rows, { expected: expected.length ? expected : null, model: reader === "oak" || !client ? "none" : MODEL, usd: spent.usd, builtAt: new Date().toISOString(), extraWarnings: warnings });
  // Combined grade bands ("9-12") are real labels here, not mistakes.
  tree.build.warnings = tree.build.warnings.filter((w) => !/^unexpected grade label "[^"]*-[^"]*"$/.test(w) && !/^grade .* has no content$/.test(w) || headingKey(w) === "");
  writeTree(tree);
  const c = tree.build.counts;
  return `${e.id}: ${tree.build.coverage === null ? "no codes" : `${(tree.build.coverage * 100).toFixed(1)}% of ${tree.build.expectedCodes} codes`} · ${c.units} units ${c.topics} topics ${c.subtopics} lessons ${c.outcomes} outcomes · $${tree.build.usd.toFixed(4)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (f: string) => args.includes(f);
  const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const region = value("--region");
  const ids = args.filter((a, i) => !a.startsWith("--") && !["--region", "--docs", "--concurrency", "--only"].includes(args[i - 1]));
  const only = value("--only") as Reader | undefined;
  let picked = loadRegistry().filter((e) => readerFor(e) && (ids.length ? ids.includes(e.id) : !region || e.region === region));
  if (only) picked = picked.filter((e) => readerFor(e) === only);
  if (!flag("--force") && !flag("--dry")) picked = picked.filter((e) => !fs.existsSync(path.join(TREES_DIR, `${e.id}.json`)));
  if (!picked.length) return console.log("nothing to build");
  const env = loadEnv();
  // --free: no model at all (official headings, lessons by structure) — costs nothing.
  const free = flag("--free");
  const client = flag("--dry") || free ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY });
  let total = 0;
  await pool(picked, Number(value("--docs") ?? 4), async (e) => {
    try {
      const line = await buildOne(e, readerFor(e)!, client, Number(value("--concurrency") ?? 5), free);
      const usd = Number(/\$([0-9.]+)$/.exec(line)?.[1] ?? 0);
      total += usd;
      console.log(line);
    } catch (err) {
      console.log(`${e.id}: FAILED ${(err as Error).message.slice(0, 200)}`);
    }
  });
  if (client || free) console.log(`total $${total.toFixed(4)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
