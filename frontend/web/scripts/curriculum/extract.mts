/**
 * SYLLABUS PDF → CHECKED CURRICULUM TREE.
 *
 *   node --import tsx scripts/curriculum/extract.mts <id> [<id>…]      one or more registry ids
 *   node --import tsx scripts/curriculum/extract.mts --region PK        every entry of a region
 *   node --import tsx scripts/curriculum/extract.mts --all              everything not built yet
 *   flags: --force (rebuild), --concurrency 6, --dry (text + codes only, no model calls)
 *
 * 1. pdftotext -layout, page by page (cached in .curricula-raw/.text/).
 * 2. The registry's codePattern lists every outcome code the document contains → the target.
 * 3. OUTLINE: luna reads every heading-like line of the whole document once and fixes the units
 *    and topics for each grade, so pieces read separately still share one structure.
 * 4. ROWS: luna reads the pages in excerpts (each with the end of the page before) and returns one
 *    row per outcome, naming its unit and topic from the outline; each excerpt is told its codes.
 * 5. lib/curriculum/build.ts merges rows (one per code, invented codes dropped) and snaps them to
 *    the outline; up to two repair rounds re-read the pages of any code still missing.
 * 6. LESSONS: per unit, luna groups each topic's outcomes into lesson-sized subtopics; the
 *    grouping is used only if every outcome lands in exactly one lesson.
 * 7. data/curricula/trees/<id>.json + a line in data/curricula/reports/summary.json.
 *
 * Only the structure, the codes and our own wording of each outcome are kept.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import OpenAI from "openai";
import { applyLessonGroups, assembleTree, codeInSource, codesInText, distinctPlaces, gradesFromCodes, headingCandidates, inferGradeFromCode, headingKey, mergeRows, renamePlaces, snapToOutline, type Outline } from "../../lib/curriculum/build";
import type { CurriculumTree, ExtractedRow, RegistryEntry } from "../../lib/curriculum/types";
import { usdForUsage } from "../../lib/spend/usage";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const REGISTRY_DIR = process.env.CURRICULUM_REGISTRY_DIR ?? path.join(ROOT, "data/curricula/registry");
const TREES_DIR = process.env.CURRICULUM_TREES_DIR ?? path.join(ROOT, "data/curricula/trees");
const SUMMARY = path.join(process.env.CURRICULUM_TREES_DIR ? path.dirname(TREES_DIR) : path.join(ROOT, "data/curricula/reports"), "summary.json");
const TEXT_CACHE = path.join(ROOT, ".curricula-raw/.text");
export const MODEL = process.env.CURRICULUM_MODEL ?? "gpt-5.6-luna";
// The last repair round reads only the pages of codes still missing, so a stronger model is cheap there.
const REPAIR_MODEL = process.env.CURRICULUM_REPAIR_MODEL ?? "gpt-5.6-terra";
const CHUNK_CHARS = 18_000;
const LEAD_CHARS = 1_800;

export function loadEnv(): Record<string, string> {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
  );
}

export function loadRegistry(): RegistryEntry[] {
  if (!fs.existsSync(REGISTRY_DIR)) return [];
  return fs.readdirSync(REGISTRY_DIR).filter((f) => f.endsWith(".json")).flatMap((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), "utf8")) as RegistryEntry[];
    } catch (err) {
      console.warn(`registry ${f} is not valid JSON yet: ${(err as Error).message}`);
      return [];
    }
  });
}

/**
 * The document's text, page by page. `ocr: true` reads every page with Tesseract even when the PDF
 * has a text layer (Urdu fonts often extract reversed and split); once made, that OCR text is the
 * one every tool uses for this document, so the checker sees what the reader saw.
 */
export function pdfPages(entry: RegistryEntry, opts: { ocr?: boolean; lang?: string; raw?: boolean } = {}): string[] {
  fs.mkdirSync(TEXT_CACHE, { recursive: true });
  const ocrCache = path.join(TEXT_CACHE, `${entry.id}.ocr.json`);
  if (!opts.raw && fs.existsSync(ocrCache)) return JSON.parse(fs.readFileSync(ocrCache, "utf8"));
  if (opts.ocr) {
    const pages = entry.localFiles
      .map((rel) => (path.isAbsolute(rel) ? rel : path.join(ROOT, rel)))
      .filter((f) => /\.pdf$/i.test(f))
      .flatMap((f) => ocrPages(f, 0, opts.lang ?? ocrLanguages(entry)));
    fs.writeFileSync(ocrCache, JSON.stringify(pages));
    return pages;
  }
  const cache = path.join(TEXT_CACHE, `${entry.id}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const pages: string[] = [];
  for (const rel of entry.localFiles) {
    const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    if (/\.html?$/i.test(file)) {
      pages.push(htmlText(fs.readFileSync(file, "utf8")));
      continue;
    }
    const text = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8");
    let filePages = text.split("\f");
    // A scan has (almost) no text layer: read it with Tesseract instead, page by page.
    const chars = filePages.reduce((n, p) => n + p.trim().length, 0);
    // Or its fonts have no usable character map (Urdu/Arabic PDFs often extract as symbols).
    if (filePages.length && (chars / filePages.length < 120 || looksGarbled(filePages.join("")))) {
      filePages = ocrPages(file, filePages.length, ocrLanguages(entry));
    }
    pages.push(...filePages);
  }
  fs.writeFileSync(cache, JSON.stringify(pages));
  return pages;
}

/** A saved web page as plain text: scripts, styles and navigation dropped, block tags as line breaks. */
function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

/** Mostly not letters (Latin or Arabic script) or digits: a font without a usable text map. */
function looksGarbled(text: string): boolean {
  const visible = text.replace(/\s+/g, "");
  if (visible.length < 500) return false;
  const readable = (visible.match(/[A-Za-z0-9\u0600-\u06FF\u0750-\u077F]/g) ?? []).length;
  return readable / visible.length < 0.55;
}

const TESSDATA = path.join(ROOT, ".curricula-raw/tessdata");
function ocrLanguages(e: RegistryEntry): string {
  const rtl = /urdu|arabic|islam|quran|tarjuma|punjabi|sindhi|pashto|balochi|persian|saraiki|brahvi/i.test(`${e.id} ${e.subject}`);
  return rtl && fs.existsSync(path.join(TESSDATA, "urd.traineddata")) ? "eng+urd+ara" : "eng";
}

function ocrPages(file: string, count: number, lang = "eng"): string[] {
  const dir = fs.mkdtempSync(path.join(TEXT_CACHE, "ocr-"));
  try {
    console.log(`  OCR ${path.basename(file)} (${count} pages, ${lang})…`);
    execFileSync("pdftoppm", ["-r", "200", "-gray", "-png", file, path.join(dir, "p")]);
    return fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((png) =>
      execFileSync("tesseract", [path.join(dir, png), "-", "--psm", "4", "-l", lang, ...(fs.existsSync(TESSDATA) ? ["--tessdata-dir", TESSDATA] : [])], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Collapse the wide runs of spaces -layout produces; keeps columns apart with " | ". */
export function squeeze(page: string): string {
  return page.split("\n").map((l) => l.replace(/\s{4,}/g, " | ").replace(/\s{2,3}/g, " ").trimEnd()).filter((l) => l.trim()).join("\n");
}

type Excerpt = { from: number; to: number; text: string; lead: string; codes: string[] };

/** Pages → excerpts of about CHUNK_CHARS, each with the tail of the previous page for headings. */
function makeExcerpts(pages: string[], keep: (i: number) => boolean, codeMap: Map<string, number[]> | null): Excerpt[] {
  const out: Excerpt[] = [];
  let cur: { from: number; to: number; parts: string[]; size: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const prev = cur.from > 0 ? squeeze(pages[cur.from - 1]) : "";
    const codes = codeMap ? [...codeMap.entries()].filter(([, at]) => at.some((p) => p >= cur!.from && p <= cur!.to)).map(([c]) => c) : [];
    out.push({ from: cur.from, to: cur.to, text: cur.parts.join("\n"), lead: prev.slice(-LEAD_CHARS), codes });
    cur = null;
  };
  pages.forEach((raw, i) => {
    if (!keep(i)) {
      flush();
      return;
    }
    const page = `[page ${i + 1}]\n${squeeze(raw)}`;
    if (cur && cur.size + page.length > CHUNK_CHARS) flush();
    if (!cur) cur = { from: i, to: i, parts: [], size: 0 };
    cur.parts.push(page);
    cur.to = i;
    cur.size += page.length;
  });
  flush();
  return out;
}

const ROW_SCHEMA = (grades: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["grade", "unit", "topic", "subtopic", "code", "outcome"],
        properties: {
          grade: { type: "string", enum: [...grades, "all"] },
          unit: { type: "string" },
          topic: { type: "string" },
          subtopic: { type: "string" },
          code: { type: ["string", "null"] },
          outcome: { type: "string" },
        },
      },
    },
  },
});

function systemPrompt(e: RegistryEntry, outline: Outline | null): string {
  const what = [e.framework, e.board, e.qualification, e.subject, e.syllabusCode].filter(Boolean).join(" · ");
  return `You turn one excerpt of an official syllabus into rows of its SUBJECT CONTENT — what students must learn.
Document: ${what}. It covers ${e.gradeSystem}s: ${e.grades.join(", ")}.${e.notes ? `\nAbout this document: ${e.notes}` : ""}

One row for every learning outcome / content statement / standard / learning objective in the excerpt:
- grade: which ${e.gradeSystem} it belongs to — exactly one of: ${e.grades.join(", ")}${e.grades.length > 1 ? "" : ""}; "all" only if the document does not divide content by ${e.gradeSystem}.
- unit: the unit this outcome is under, copied EXACTLY from the outline below.
- topic: the topic it is under, copied EXACTLY from that unit's topics in the outline.
- subtopic: the printed heading directly above the outcome if the document has one below the topic level; otherwise "".
- code: the outcome's code exactly as printed${e.sampleCodes.length ? ` (codes look like ${e.sampleCodes.slice(0, 3).join(", ")})` : ""}; null if it has none.
- outcome: what the student must know or be able to do, in YOUR OWN plain words, at most 25 words. Never copy the document's sentence.

Skip: covers, contents pages, introductions, aims, teaching guidance, assessment objectives and weightings, exam structure, command words, glossaries, mark schemes, and any table that only repeats outcomes already listed. Include an outcome the first time it appears, even inside a table.
If the excerpt has no subject content, return {"rows": []}.${outline ? `

OUTLINE (units and topics per ${e.gradeSystem}):
${renderOutline(outline)}` : ""}`;
}

function renderOutline(o: Outline): string {
  return o.units.map((u) => `[${u.grade}] ${u.title}\n${u.topics.map((t) => `    - ${t}`).join("\n")}`).join("\n");
}

export type Usage = { usd: number };

export async function askJson<T>(client: OpenAI, model: string, system: string, user: string, name: string, schema: object, spent: Usage): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model,
        reasoning_effort: "low",
        max_completion_tokens: 32_000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      spent.usd += usdForUsage(model, res.usage as never) ?? 0;
      return JSON.parse(res.choices[0]?.message?.content ?? "null") as T;
    } catch (err) {
      // Rate limits clear in seconds to a minute: back off longer for them than for other errors.
      const status = (err as { status?: number }).status;
      // The network drops for minutes at a time from this machine: wait those out like rate limits.
      const offline = status === undefined && /connection|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(String((err as Error).message));
      const patient = status === 429 || offline;
      if (attempt >= (patient ? 7 : 3)) throw err;
      await new Promise((r) => setTimeout(r, (patient ? 5_000 : 2_000) * 2 ** (attempt - 1)));
    }
  }
}

async function callModel(client: OpenAI, model: string, e: RegistryEntry, outline: Outline | null, user: string, spent: Usage): Promise<ExtractedRow[]> {
  const out = await askJson<{ rows: ExtractedRow[] }>(client, model, systemPrompt(e, outline), user, "syllabus_rows", ROW_SCHEMA(e.grades), spent);
  return out?.rows ?? [];
}

const OUTLINE_SCHEMA = (grades: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["units"],
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["grade", "title", "topics"],
        properties: { grade: { type: "string", enum: [...grades, "all"] }, title: { type: "string" }, topics: { type: "array", items: { type: "string" } } },
      },
    },
  },
});

async function makeOutline(client: OpenAI, e: RegistryEntry, pages: string[], spent: Usage): Promise<Outline> {
  const what = [e.framework, e.board, e.qualification, e.subject, e.syllabusCode].filter(Boolean).join(" · ");
  const system = `You read the heading lines of an official syllabus and write the structure of its SUBJECT CONTENT.
Document: ${what}. It covers ${e.gradeSystem}s: ${e.grades.join(", ")}.${e.notes ? `\nAbout this document: ${e.notes}` : ""}

Return, in document order, for each ${e.gradeSystem}: its units (the top-level content headings — chapter / domain / unit / strand / section — named as the document names them, keeping numbers or letters, e.g. "Domain B: Mechanics" or "3 Electricity"), and each unit's topics (the heading level directly below, as named).
- Use ONE consistent top level for the whole document. Do not mix levels (a chapter list of a different organisation, a table of contents, an assessment grid).
- If the same unit runs through several ${e.gradeSystem}s, list it once per ${e.gradeSystem} with that ${e.gradeSystem}'s topics.
- Use grade "all" only if the document does not divide content by ${e.gradeSystem}.
- Skip front matter, aims, teaching guidance, assessment, exam structure, glossaries and appendices.
- Every topic must have content (outcomes / statements) under it in the document.`;
  const out = await askJson<Outline>(client, MODEL, system, `HEADING LINES, page-tagged:\n${headingCandidates(pages)}`, "syllabus_outline", OUTLINE_SCHEMA(e.grades), spent);
  return { units: (out?.units ?? []).filter((u) => u.title.trim() && u.topics.length) };
}

const PLACES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["places"],
  properties: {
    places: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "unit", "topic"],
        properties: { i: { type: "integer" }, unit: { type: "string" }, topic: { type: "string" } },
      },
    },
  },
};

/**
 * One consistent set of unit and topic names: the distinct places the rows were filed under (read
 * in separate pieces, some with slightly different names) are mapped to a single list per grade.
 */
export async function normalizeHeadings(client: OpenAI, e: RegistryEntry, outline: Outline | null, rows: ExtractedRow[], spent: Usage, warnings: string[]): Promise<ExtractedRow[]> {
  const places = distinctPlaces(rows);
  if (places.length < 2) return rows;
  const system = `Outcomes of one syllabus (${[e.framework, e.board, e.qualification, e.subject].filter(Boolean).join(" · ")}) were filed under the units and topics below, read in separate pieces, so the same heading is sometimes spelled or numbered differently, or a topic was filed under a heading from a different level.
Give every numbered place its final unit and topic so that, within each ${e.gradeSystem}:
- each unit appears once, with ONE name, at ONE consistent level (prefer the outline's names when given);
- each topic sits under the unit it belongs to, with one name; merge places that are the same topic;
- do not invent new subject matter, do not merge different topics, keep the document's numbering in names.
Return every place number exactly once.${outline ? `\n\nOUTLINE:\n${renderOutline(outline)}` : ""}`;
  const user = places.map((p, i) => `${i}. [${p.grade}] ${p.unit} > ${p.topic}  (${p.count} outcomes; e.g. "${p.sample.slice(0, 80)}")`).join("\n");
  try {
    const res = await askJson<{ places: Array<{ i: number; unit: string; topic: string }> }>(client, MODEL, system, user, "heading_map", PLACES_SCHEMA, spent);
    const renamed = renamePlaces(rows, places, res?.places ?? []);
    if (renamed) return renamed;
    warnings.push("heading normalisation skipped (the map did not cover every place)");
  } catch (err) {
    warnings.push(`heading normalisation failed: ${(err as Error).message.slice(0, 100)}`);
  }
  return rows;
}

const LESSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topics"],
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "lessons"],
        properties: {
          topic: { type: "string" },
          lessons: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "items"],
              properties: { title: { type: "string" }, items: { type: "array", items: { type: "integer" } } },
            },
          },
        },
      },
    },
  },
};

/**
 * Lesson-sized subtopics, one unit per call. Topics of one or two outcomes keep their printed
 * subtopic (or the topic's own name). A grouping that drops or repeats an outcome is ignored.
 */
export async function groupLessons(client: OpenAI, e: RegistryEntry, rows: ExtractedRow[], concurrency: number, spent: Usage, warnings: string[]): Promise<ExtractedRow[]> {
  const byUnit = new Map<string, Map<string, number[]>>();
  rows.forEach((r, i) => {
    const uk = `${r.grade}|${headingKey(r.unit)}`;
    if (!byUnit.has(uk)) byUnit.set(uk, new Map());
    const topics = byUnit.get(uk)!;
    const tk = headingKey(r.topic);
    if (!topics.has(tk)) topics.set(tk, []);
    topics.get(tk)!.push(i);
  });
  const out = rows.map((r) => ({ ...r, subtopic: r.subtopic || r.topic }));
  const system = `You plan lessons for a tutor who teaches one short lesson at a time on a board.
For each topic, group its numbered outcomes into lessons:
- a lesson is ONE 5-8 minute board lesson: usually 2-6 closely related outcomes; one outcome alone only if it is big or unrelated to its neighbours;
- keep the document's order — a lesson's items should be consecutive where possible;
- every outcome number goes in exactly one lesson;
- title: 2-6 plain words a student understands, naming what the lesson teaches (use a printed subheading when it fits). No numbering.`;
  // Blocks of at most 20 outcomes (a long topic is cut into consecutive slices), sent ~60 at a time.
  type Block = { idx: number[]; topic: string; unit: string };
  const blocks: Block[] = [];
  for (const topics of byUnit.values()) {
    for (const idx of topics.values()) {
      if (idx.length <= 2) continue;
      for (let i = 0; i < idx.length; i += 20) {
        const slice = idx.slice(i, i + 20);
        // A tail of one or two joins the slice before it rather than standing alone.
        if (slice.length <= 2 && blocks.length && i > 0) blocks[blocks.length - 1].idx.push(...slice);
        else blocks.push({ idx: slice, topic: rows[idx[0]].topic, unit: rows[idx[0]].unit });
      }
    }
  }
  const batches: Block[][] = [];
  for (const b of blocks) {
    const last = batches[batches.length - 1];
    if (last && last.reduce((n, x) => n + x.idx.length, 0) + b.idx.length <= 60 && last[0].unit === b.unit) last.push(b);
    else batches.push([b]);
  }
  const askBatch = async (batch: Block[]): Promise<Block[]> => {
    const user = batch.map((b, t) => `TOPIC ${t + 1}: ${b.topic}\n${b.idx.map((ri, k) => `  ${k}. ${rows[ri].subtopic && rows[ri].subtopic !== b.topic ? `[${rows[ri].subtopic}] ` : ""}${rows[ri].outcome}`).join("\n")}`).join("\n\n");
    let res: { topics: Array<{ topic: string; lessons: Array<{ title: string; items: number[] }> }> } | null = null;
    try {
      res = await askJson(client, MODEL, system, `Unit: ${batch[0].unit}\n\n${user}\n\nReturn the ${batch.length} topic(s) in the same order (topic = its name).`, "lesson_groups", LESSON_SCHEMA, spent);
    } catch {
      return batch;
    }
    const failed: Block[] = [];
    batch.forEach((b, t) => {
      const plan = res?.topics?.[t];
      const grouped = plan ? applyLessonGroups(b.idx.map((ri) => out[ri]), plan.lessons) : null;
      if (!grouped) failed.push(b);
      else grouped.forEach((r, k) => { out[b.idx[k]] = r; });
    });
    return failed;
  };
  const failedOnce = (await pool(batches, concurrency, askBatch)).flat();
  // Each block that failed in a batch gets one try on its own.
  const failedTwice = (await pool(failedOnce, concurrency, (b) => askBatch([b]))).flat();
  for (const b of failedTwice) {
    // Last resort, so no lesson is a wall of outcomes: consecutive runs of four.
    for (let i = 0; i < b.idx.length; i += 4) {
      const part = Math.floor(i / 4) + 1;
      for (const ri of b.idx.slice(i, i + 4)) out[ri] = { ...out[ri], subtopic: b.idx.length > 4 ? `${b.topic} (part ${part})` : b.topic };
    }
    warnings.push(`lessons for "${b.topic}" split by order (grouping failed twice)`);
  }
  return out;
}

function excerptMessage(x: Excerpt, only?: string[]): string {
  const parts = [];
  if (x.lead) parts.push(`(For context only — the end of the page before; do not extract from it:)\n${x.lead}\n`);
  parts.push(`EXCERPT, pages ${x.from + 1}-${x.to + 1}:\n${x.text}`);
  if (only?.length) parts.push(`\nReturn rows ONLY for these codes, one row each: ${only.join(", ")}`);
  else if (x.codes.length) parts.push(`\nThese outcome codes appear in the excerpt; each should get exactly one row unless it is only a cross-reference: ${x.codes.join(", ")}`);
  return parts.join("\n");
}

export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export async function extractPdf(entry: RegistryEntry, client: OpenAI | null, concurrency: number): Promise<CurriculumTree | { dry: true; pages: number; codes: number }> {
  const pages = pdfPages(entry);
  const codeMap = entry.codePattern ? codesInText(pages, entry.codePattern) : null;
  const expected = codeMap ? [...codeMap.keys()] : null;
  // With codes, read the pages that hold codes plus the page before each (headings); without, read all.
  const keep = codeMap
    ? (() => {
        const on = new Set<number>();
        for (const at of codeMap.values()) for (const p of at) { on.add(p); if (p > 0) on.add(p - 1); }
        return (i: number) => on.has(i);
      })()
    : (i: number) => pages[i].trim().length > 40;
  const excerpts = makeExcerpts(pages, keep, codeMap);
  if (!client) return { dry: true, pages: pages.length, codes: expected?.length ?? 0 };

  const spent: Usage = { usd: 0 };
  const warnings: string[] = [];
  const outline = await makeOutline(client, entry, pages, spent).catch((err) => {
    warnings.push(`outline failed: ${(err as Error).message.slice(0, 120)}`);
    return null;
  });
  const results = await pool(excerpts, concurrency, (x) => callModel(client, MODEL, entry, outline, excerptMessage(x), spent).catch((err) => {
    warnings.push(`pages ${x.from + 1}-${x.to + 1} failed: ${(err as Error).message.slice(0, 120)}`);
    return [] as ExtractedRow[];
  }));
  // A course with a piece that could not be read is not saved: the next run reads it again.
  const broken = warnings.filter((w) => / failed: /.test(w));
  if (broken.length) throw new Error(`${broken.length} piece(s) could not be read (${broken[0]})`);
  let rows = results.flat();
  const expectedSet = expected ? new Set(expected) : null;
  // A code is kept if the pattern found it OR it is printed in the source (wrapped over a line).
  const printed = codeInSource(pages);
  const isReal = (c: string) => (expectedSet?.has(c) ?? false) || printed(c);
  let merged = mergeRows(rows, expectedSet || entry.codePattern ? isReal : printed);

  // Repair: re-read the pages of every code still missing, asking for exactly those codes.
  for (let round = 1; expected && round <= 2; round++) {
    const have = new Set(merged.rows.map((r) => r.code).filter(Boolean) as string[]);
    const missing = expected.filter((c) => !have.has(c));
    if (!missing.length) break;
    const byPage = new Map<number, string[]>();
    for (const c of missing) {
      const p = codeMap!.get(c)![0];
      if (!byPage.has(p)) byPage.set(p, []);
      byPage.get(p)!.push(c);
    }
    const targets = [...byPage.entries()].map(([p, codes]) => {
      const from = Math.max(0, p - 1);
      const to = Math.min(pages.length - 1, p + 1);
      const text = pages.slice(from, to + 1).map((pg, k) => `[page ${from + k + 1}]\n${squeeze(pg)}`).join("\n");
      return { x: { from, to, text, lead: "", codes }, codes };
    });
    const repaired = await pool(targets, concurrency, ({ x, codes }) =>
      callModel(client, round === 2 ? REPAIR_MODEL : MODEL, entry, outline, excerptMessage(x, codes), spent).catch(() => [] as ExtractedRow[]));
    // Repaired rows slot in after everything else; buildTree joins them to their headings by name.
    rows = [...merged.rows, ...repaired.flat()];
    merged = mergeRows(rows, isReal);
  }
  if (merged.invented.length) warnings.push(`${merged.invented.length} invented code(s) dropped: ${[...new Set(merged.invented)].slice(0, 8).join(", ")}`);

  // Coded rows back into source order (repaired rows were appended at the end); the slots of
  // uncoded rows are left where they were read.
  if (expected) {
    const order = expected.reduce((m, c, i) => m.set(c, i), new Map<string, number>());
    const slots = merged.rows.map((r, i) => (r.code ? i : -1)).filter((i) => i >= 0);
    const coded = slots.map((i) => merged.rows[i]).sort((a, b) => order.get(a.code!)! - order.get(b.code!)!);
    slots.forEach((slot, k) => { merged.rows[slot] = coded[k]; });
  }
  let finalRows = merged.rows;
  const gradePattern = entry.gradeFromCode ?? inferGradeFromCode(entry.sampleCodes, entry.grades);
  if (gradePattern) {
    const moved = gradesFromCodes(finalRows, gradePattern, entry.grades);
    if (moved) warnings.push(`${moved} outcome(s) moved to the grade their code names`);
  }
  if (outline?.units.length) finalRows = snapToOutline(finalRows, outline).rows;
  finalRows = await normalizeHeadings(client, entry, outline, finalRows, spent, warnings);
  finalRows = await groupLessons(client, entry, finalRows, concurrency, spent, warnings);
  return assembleTree(entry, finalRows, { expected, model: MODEL, usd: spent.usd, builtAt: new Date().toISOString(), extraWarnings: warnings });
}

export function writeTree(tree: CurriculumTree) {
  fs.mkdirSync(TREES_DIR, { recursive: true });
  fs.writeFileSync(path.join(TREES_DIR, `${tree.id}.json`), JSON.stringify(tree, null, 1));
  // Several extraction runs share this file; a read that catches another mid-write starts afresh
  // (the summary is rebuilt from the trees by scripts/curriculum/audit.mts anyway).
  let summary: Record<string, unknown> = {};
  try {
    if (fs.existsSync(SUMMARY)) summary = JSON.parse(fs.readFileSync(SUMMARY, "utf8"));
  } catch {
    summary = {};
  }
  summary[tree.id] = {
    subject: tree.subject, region: tree.region, framework: tree.framework, board: tree.board, qualification: tree.qualification,
    coverage: tree.build.coverage, expectedCodes: tree.build.expectedCodes, missing: tree.build.missingCodes.length,
    counts: tree.build.counts, usd: tree.build.usd, warnings: tree.build.warnings.length, builtAt: tree.build.builtAt,
  };
  fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
  fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 1));
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const concurrency = Number(value("--concurrency") ?? 6);
  const docConcurrency = Number(value("--docs") ?? 3);
  const registry = loadRegistry();
  const region = value("--region");
  const ids = args.filter((a, i) => !a.startsWith("--") && !["--region", "--concurrency", "--docs"].includes(args[i - 1]));
  let picked = flag("--all") ? registry : region ? registry.filter((e) => e.region === region || e.id.startsWith(region.toLowerCase())) : registry.filter((e) => ids.includes(e.id));
  picked = picked.filter((e) => e.sourceKind === "pdf");
  // One version per syllabus (the one examined soonest) unless every version is asked for.
  if (!flag("--all-versions")) {
    const year = (e: RegistryEntry) => Number(/\d{4}/.exec(e.firstExam ?? "")?.[0] ?? 0);
    const best = new Map<string, RegistryEntry>();
    for (const e of picked) {
      if (!e.syllabusCode) continue;
      const k = `${e.board}|${e.qualification}|${e.syllabusCode}`;
      const at = best.get(k);
      if (!at || year(e) < year(at)) best.set(k, e);
    }
    picked = picked.filter((e) => !e.syllabusCode || best.get(`${e.board}|${e.qualification}|${e.syllabusCode}`) === e);
  }
  if (!flag("--force")) picked = picked.filter((e) => !fs.existsSync(path.join(TREES_DIR, `${e.id}.json`)));
  if (!picked.length) {
    console.log("nothing to build (unknown id, non-PDF source, or already built — use --force)");
    return;
  }
  const env = loadEnv();
  const client = flag("--dry") ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY });
  let total = 0;
  await pool(picked, docConcurrency, async (e) => {
    const t0 = Date.now();
    try {
      const out = await extractPdf(e, client, concurrency);
      if ("dry" in out) {
        console.log(`${e.id}: ${out.pages} pages, ${out.codes} codes`);
        return;
      }
      writeTree(out);
      total += out.build.usd;
      const cov = out.build.coverage === null ? "no codes" : `${(out.build.coverage * 100).toFixed(1)}% of ${out.build.expectedCodes} codes`;
      const c = out.build.counts;
      console.log(`${e.id}: ${cov} · ${c.units} units ${c.topics} topics ${c.subtopics} subtopics ${c.outcomes} outcomes · $${out.build.usd.toFixed(4)} · ${((Date.now() - t0) / 1000).toFixed(0)}s${out.build.warnings.length ? ` · ${out.build.warnings.length} warnings` : ""}`);
    } catch (err) {
      console.log(`${e.id}: FAILED ${(err as Error).message.slice(0, 200)}`);
    }
  });
  if (!flag("--dry")) console.log(`total $${total.toFixed(4)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

/**
 * The same PDF read in reading order (pdftotext -raw) instead of page layout: a code that a table
 * wraps over two lines ("PSWHS-11-A-" / "01") usually comes out whole this way. Used by the
 * checker as one more place to find printed codes. Cached in .curricula-raw/.text/<id>.raw.json.
 */
export function readingOrderPages(entry: RegistryEntry): string[] {
  fs.mkdirSync(TEXT_CACHE, { recursive: true });
  const cache = path.join(TEXT_CACHE, `${entry.id}.raw.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const pages: string[] = [];
  for (const rel of entry.localFiles) {
    const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    if (!/\.pdf$/i.test(file)) continue;
    try {
      pages.push(...execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", file, "-"], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8").split("\f"));
    } catch {
      // Unreadable: the other texts still count.
    }
  }
  fs.writeFileSync(cache, JSON.stringify(pages));
  return pages;
}
