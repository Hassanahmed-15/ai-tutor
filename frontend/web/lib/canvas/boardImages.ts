/**
 * AN IMAGE SEARCHED FOR EACH BOARD (owner, 2026-11-11: "for CS topics other than DSA, OS and networking,
 * search specifically for images rather than relying on pages which may or may not contain images …
 * ensure the image is relevant to that board and what is taught").
 *
 * Reading the research pages (lib/canvas/sourceDiagrams.ts) almost never found a picture: today's sites
 * draw their diagrams as inline SVG, and it chose per lesson, not per board. Here each board gets its own
 * search, on openly licensed libraries only (Wikimedia Commons, Openverse — the owner's choice, so every
 * picture carries its author and licence):
 *   1. a small model writes three queries for exactly what this board teaches;
 *   2. the candidates are fetched and a vision model judges each against the board's own narration;
 *   3. the best relevant one is REDRAWN natively when it is a sequence, flow, layer stack or state machine
 *      (the board stays animated and in step with Aria), and otherwise SHOWN, credited, with Aria's
 *      pointer on its printed labels.
 * Nothing relevant: the board is written exactly as before. DSA, OS and networking lessons never come here
 * (csLessons.ts isOtherCsLesson): their own board types already draw them.
 */
import { createHash } from "node:crypto";
import OpenAI, { toFile } from "openai";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { costFor, priceFor } from "../modelPricing";
import { printedLabelBoxes } from "./labelLeaders";
import { asSequence, DIAGRAM_STAGE, sanitizeSourceDiagram } from "./sourceDiagrams";
import type { CanvasPlanBeat, FoundBoardImage, IllustrationStage, SourceDiagram } from "./types";

const QUERY_MODEL = process.env.CANVAS_IMAGE_QUERY_MODEL ?? "gpt-4o-mini";
const VISION_MODEL = process.env.CANVAS_DIAGRAM_MODEL ?? process.env.OPENAI_VISION_MODEL ?? "gpt-5.6-luna";
// Relevant and a correct diagram of the concept, if not of every detail: the redraw (gpt-image-2) and the narration do the rest.
const MIN_SCORE = Number(process.env.CANVAS_IMAGE_MIN_SCORE) || 0.6;
const JUDGED = 6;
const MAX_BYTES = 4_000_000;
const UA = "AriaTutor/1.0 (lesson board images; contact via app)";
const IMAGE_MODEL = process.env.CANVAS_BOARD_IMAGE_MODEL ?? "gpt-image-2";
const IMAGE_QUALITY = (process.env.CANVAS_BOARD_IMAGE_QUALITY ?? "medium") as "low" | "medium" | "high";

export function boardImagesOn(): boolean {
  return process.env.CANVAS_BOARD_IMAGES !== "off";
}

export type ImageCandidate = {
  title: string;
  /** The image itself (a bitmap: Commons serves its SVG diagrams as PNG thumbnails). */
  imageUrl: string;
  /** Its page on the library, for the credit. */
  pageUrl: string;
  creator: string;
  license: string;
  provider: "Wikimedia Commons" | "Openverse";
  description: string;
  query: string;
};

/** What the vision model said about one candidate. */
export type ImageVerdict = {
  relevant: boolean;
  score: number;
  reason: string;
  shows: string;
  labels: string[];
  /** The same labels in English: what the redrawn picture prints. */
  englishLabels: string[];
  textHeavy: boolean;
  diagram: SourceDiagram | null;
};

/** A licence a lesson may show and adapt: public domain, CC0, CC BY, CC BY-SA. Never NC or ND. */
export function licenseOk(license: string): boolean {
  const l = license.toLowerCase().replace(/[_-]+/g, " ");
  if (/\bnc\b|non ?commercial|\bnd\b|no ?deriv/.test(l)) return false;
  return /public domain|\bpdm\b|\bcc0\b|\bcc by\b|\bby sa\b|^by\b|attribution/.test(l);
}

const STOP = new Set(["the", "and", "for", "with", "how", "what", "why", "does", "this", "that", "from", "into", "are", "its", "work", "works", "explain", "about", "using", "understanding", "introduction", "overview", "basics"]);
const words = (t: string) => (t.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));

/** Queries made without a model: the board's title, then the title with the lesson's topic. */
export function fallbackQueries(topic: string, beat: Pick<CanvasPlanBeat, "title">): string[] {
  const title = words(beat.title).join(" ");
  const subject = words(topic).slice(0, 4).join(" ");
  return [...new Set([`${title} diagram`, `${subject} ${title} diagram`].map((q) => q.replace(/\s+/g, " ").trim()).filter((q) => q.length > 8))];
}

const QUERY_PROMPT = `You write image-search queries for ONE board of a computer-science lecture. The search runs on Wikimedia Commons and Openverse, which hold labelled teaching diagrams.
Write exactly 3 queries for the diagram that would teach THIS board — not the whole lesson:
1. the precise standard name of the diagram, with the terms printed in it (e.g. "five stage RISC pipeline IF ID EX MEM WB diagram");
2. the same concept in the words a textbook figure caption uses (e.g. "instruction pipeline data hazard forwarding diagram");
3. a broader fallback naming the concept and "diagram".
Each query 3-8 words, English, no quotes, no site names. Use the concept's standard names only: never example values, numbers, variable letters or people's names from the narration ("p=23", "Alice"), and never filler words such as "pathway", "process", "flow" or "steps". Return JSON: {"queries": ["…","…","…"]}.`;

export async function boardImageQueries(openai: OpenAI, topic: string, beat: CanvasPlanBeat): Promise<{ queries: string[]; costUsd: number }> {
  const fallback = fallbackQueries(topic, beat);
  try {
    const res = await openai.chat.completions.create({
      model: QUERY_MODEL,
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: "system", content: QUERY_PROMPT },
        { role: "user", content: `Lesson: ${topic}\nBoard: ${beat.title}\nWhat it teaches: ${beat.brief}\nNarration: ${beat.script.slice(0, 900)}` },
      ],
    }, { signal: AbortSignal.timeout(15_000) });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { queries?: unknown };
    const queries = (Array.isArray(parsed.queries) ? parsed.queries : []).filter((q): q is string => typeof q === "string").map((q) => q.replace(/["']/g, "").replace(/\s+/g, " ").trim().slice(0, 90)).filter((q) => q.length > 4).slice(0, 3);
    return { queries: queries.length ? [...new Set([...queries, ...fallback])].slice(0, 4) : fallback, costUsd: costFor(QUERY_MODEL, res.usage) };
  } catch {
    return { queries: fallback, costUsd: 0 };
  }
}

const strip = (v: unknown) => (typeof v === "string" ? v.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() : "");

export async function searchCommons(query: string, limit = 6): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: String(limit * 2),
    prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "1200", format: "json", origin: "*",
  });
  // Asked through Wikipedia API, which searches the Commons files too (same answer): commons.wikimedia.org
  // itself does not resolve on some networks (measured 2026-11-11), so it is only the fallback.
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": UA } }).catch(() => null)
    ?? await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": UA } }).catch(() => null);
  if (!res?.ok) return [];
  const json = (await res.json().catch(() => null)) as { query?: { pages?: Record<string, { title?: string; index?: number; imageinfo?: Array<Record<string, unknown>> }> } } | null;
  const pages = Object.values(json?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: ImageCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    // SVG, PNG, JPEG and TIFF all come back as a bitmap thumbnail; video, audio and PDF do not belong on a board.
    if (!/^image\/(?:png|jpeg|svg\+xml|tiff|webp|gif)$/i.test(String(info.mime ?? ""))) continue;
    if (Number(info.width) < 300 || Number(info.height) < 150) continue;
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown }>;
    const license = strip(meta.LicenseShortName?.value) || strip(meta.License?.value);
    if (!licenseOk(license)) continue;
    const imageUrl = typeof info.thumburl === "string" ? info.thumburl : "";
    const pageUrl = typeof info.descriptionurl === "string" ? info.descriptionurl : "";
    if (!imageUrl || !pageUrl) continue;
    out.push({
      title: (page.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " "),
      imageUrl,
      pageUrl,
      creator: strip(meta.Artist?.value).slice(0, 80) || "Wikimedia Commons contributor",
      license,
      provider: "Wikimedia Commons",
      description: strip(meta.ImageDescription?.value).slice(0, 300),
      query,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchOpenverse(query: string, limit = 4): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({ q: query, page_size: String(limit * 2), license_type: "commercial,modification", mature: "false" });
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": UA } }).catch(() => null);
  if (!res?.ok) return [];
  const json = (await res.json().catch(() => null)) as { results?: Array<Record<string, unknown>> } | null;
  const out: ImageCandidate[] = [];
  for (const r of json?.results ?? []) {
    const filetype = String(r.filetype ?? "").toLowerCase();
    if (filetype && !/^(?:png|jpe?g|webp|gif|svg)$/.test(filetype)) continue;
    if ((Number(r.width) && Number(r.width) < 300) || (Number(r.height) && Number(r.height) < 150)) continue;
    const license = `CC ${String(r.license ?? "").toUpperCase()}${r.license_version ? ` ${String(r.license_version)}` : ""}`.replace(/^CC (CC0|PDM)/, "$1");
    if (!licenseOk(license)) continue;
    const full = typeof r.url === "string" && /\.(?:png|jpe?g|webp)(?:$|\?)/i.test(r.url) ? r.url : "";
    const imageUrl = full || (typeof r.thumbnail === "string" ? r.thumbnail : "");
    const pageUrl = typeof r.foreign_landing_url === "string" ? r.foreign_landing_url : "";
    if (!imageUrl || !pageUrl) continue;
    out.push({ title: strip(r.title) || query, imageUrl, pageUrl, creator: strip(r.creator).slice(0, 80) || "Openverse contributor", license, provider: "Openverse", description: strip(r.attribution).slice(0, 300), query });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Commons keeps one diagram in many languages, its file name ending in the language ("Digital Signature
 * diagram fr", "Five stage pipeline datapath tr"): those crowded out the English original (test lectures,
 * 2026-11-11: French, Finnish, Greek and Italian digital-signature diagrams judged, none English).
 */
const OTHER_LANGUAGE = /(?:^|[\s(_-])(?:tr|fr|de|el|it|es|pt|ru|da|id|hr|fi|he|nl|pl|sv|no|nb|ja|zh|ko|ar|fa|uk|cs|hu|ro|ca|eu|gl|vi|th|ms|bg|sr|sk|sl|lt|lv|et|hi|bn|ta|canto|yue|zh-hans|zh-hant)\)?$/i;
export function inAnotherLanguage(title: string): boolean {
  return OTHER_LANGUAGE.test(title.trim());
}

/** A library file is named in the base form: "pipelining" is filed as "pipeline", "hazards" as "hazard". */
export function baseForm(word: string): string {
  if (/ining$/.test(word)) return word.replace(/ing$/, "e");
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/[^s]s$/.test(word) && word.length > 4) return word.slice(0, -1);
  return word;
}

/** Words that say nothing about WHICH concept a picture shows. */
const GENERIC = new Set(["diagram", "diagrams", "figure", "chart", "illustration", "schematic", "pathway", "process", "flow", "steps", "stage", "stages", "system", "systems", "model", "example", "overview", "basic", "simple", "type", "types"]);

/** The board's own concept words: its title's, then the lesson's. A candidate must share one to be judged. */
export function conceptWords(topic: string, title: string): string[] {
  return [...new Set([...words(title), ...words(topic)].filter((w) => !GENERIC.has(w)))];
}

/** Candidates ranked by how many of the board's own words their title and description share. */
export function rankCandidates(candidates: ImageCandidate[], boardText: string, concept: string[] = []): ImageCandidate[] {
  const want = new Set(words(boardText));
  const key = new Set(concept);
  const seen = new Set<string>();
  return candidates
    .filter((c) => (seen.has(c.imageUrl) ? false : Boolean(seen.add(c.imageUrl))))
    // A shortened query ("pathway diagram") found a black hole's orbit and a water phase diagram.
    .filter((c) => !key.size || words(`${c.title} ${c.description}`).some((w) => key.has(w)))
    .map((c, i) => ({ c, i, hits: new Set(words(`${c.title} ${c.description}`).filter((w) => want.has(w))).size + (/diagram|figure|schema|pipeline|flow|chart|model|architecture/i.test(c.title) ? 1 : 0) }))
    .sort((a, b) => b.hits - a.hits || Number(inAnotherLanguage(a.c.title)) - Number(inAnotherLanguage(b.c.title)) || a.i - b.i)
    .map((x) => x.c);
}

async function download(url: string): Promise<Buffer | null> {
  let res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": UA } }).catch(() => null);
  if (res?.status === 429) {
    await new Promise((r) => setTimeout(r, 1_500));
    res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": UA } }).catch(() => null);
  }
  if (!res?.ok || !/^image\//.test(res.headers.get("content-type") ?? "")) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length > 0 && bytes.length <= MAX_BYTES ? bytes : null;
}

/**
 * The picture as the board shows it: on white (a transparent PNG would turn black as a JPEG), letterboxed
 * to the board's 3:2 picture frame (lib/canvas/layout.ts layoutIllustration) so nothing is cropped off.
 */
/**
 * A PNG with only the chunks that draw it. The image model's pictures carry embedded provenance
 * metadata, and @napi-rs/canvas then took the file for an SVG ("Invalid SVG image", 2026-11-11).
 */
export function plainPng(bytes: Buffer): Buffer {
  const SIG = "89504e470d0a1a0a";
  if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== SIG) return bytes;
  const keep = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "gAMA", "sRGB"]);
  const out: Buffer[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString("latin1");
    const end = at + 12 + length;
    if (end > bytes.length) return bytes;
    if (keep.has(type)) out.push(bytes.subarray(at, end));
    at = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

export async function boardJpeg(bytes: Buffer): Promise<Buffer> {
  const img = await loadImage(plainPng(bytes));
  const W = 1500;
  const H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const scale = Math.min((W - 40) / img.width, (H - 40) / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  return canvas.encode("jpeg", 90);
}

const JUDGE_PROMPT = `You choose the picture for ONE board of a computer-science lecture. You are told the lesson, the board's title, what it teaches and its narration, and shown one image from an open image library.
Judge it for THIS board only. Return JSON:
{"relevant": boolean, "score": number, "reason": string, "shows": string, "labels": string[], "english_labels": string[], "text_heavy": boolean, "diagram": object or null}
- "relevant": true when the image is a clear, readable teaching diagram or labelled figure of the CONCEPT this board teaches. It does not have to show every detail the narration mentions — the narration explains the picture — but it must be that concept, not a neighbouring one. A board that teaches two related ideas (data and control hazards) is well served by a clear diagram of one of them. False for a photograph of hardware, people, a logo, a screenshot, or a different concept that merely shares a word. Labels in another language are fine: the picture is redrawn with English labels.
- "score": 0 to 1, how well it teaches this board's concept (1 = the textbook figure for it; 0.7 = a correct, clear diagram of the concept that leaves out some of the narration's detail).
- "reason": one sentence. "shows": what the image shows, in one sentence.
- "labels": its printed labels exactly as written (up to 8, the ones this board would talk about).
- "english_labels": the same labels, in the same order, in English as a textbook writes them (unchanged when already English) — abbreviations and single letters too: a Turkish pipeline's "G, Ç, Y, B, S" are "IF, ID, EX, MEM, WB".
- "text_heavy": true when it is mostly paragraphs of text.
- "diagram": when the drawing IS one of these kinds, transcribe ONLY what is drawn, never adding anything, as {"teaches": true, "kind": …, "title": "what it shows in a few words", …fields}; otherwise null.
  "sequence": parties as vertical lines with messages between them over time: "lanes" (left to right), "messages" in order [{"from","to","label","detail"}], "states" [{"lane","label","after"}].
  "state-machine": named states joined by labelled transitions: "transitions" [{"from","to","label"}].
  "layers": a stack of layers, top to bottom: "layers".
  "flow": boxes joined by arrows: "boxes", "arrows" [{"from","to","label"}].
  A table, a timing chart, a tree, a circuit or a picture of something is NOT one of these kinds: null.`;

export function parseVerdict(raw: unknown, candidate: Pick<ImageCandidate, "pageUrl" | "provider">): ImageVerdict {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const score = Math.max(0, Math.min(1, Number(r.score) || 0));
  const labels = (Array.isArray(r.labels) ? r.labels : []).filter((l): l is string => typeof l === "string").map((l) => l.replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  const diagram = r.diagram ? sanitizeSourceDiagram(r.diagram, { url: candidate.pageUrl, site: candidate.provider }) : null;
  const english = (Array.isArray(r.english_labels) ? r.english_labels : []).filter((l): l is string => typeof l === "string").map((l) => l.replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  return { relevant: r.relevant === true, score, reason: strip(r.reason).slice(0, 240), shows: strip(r.shows).slice(0, 240), labels, englishLabels: english.length === labels.length && english.length ? english : labels, textHeavy: r.text_heavy === true, diagram };
}

async function judge(openai: OpenAI, topic: string, beat: CanvasPlanBeat, candidate: ImageCandidate, bytes: Buffer): Promise<{ verdict: ImageVerdict; costUsd: number }> {
  const jpeg = await boardJpeg(bytes);
  const res = await openai.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: "json_object" },
    max_completion_tokens: 2500,
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Lesson: ${topic}\nBoard: ${beat.title}\nWhat it teaches: ${beat.brief}\nNarration: ${beat.script.slice(0, 1200)}\nImage: "${candidate.title}" from ${candidate.provider}${candidate.description ? ` — ${candidate.description.slice(0, 200)}` : ""}` },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" } },
        ],
      },
    ],
  }, { signal: AbortSignal.timeout(45_000) });
  return { verdict: parseVerdict(JSON.parse(res.choices[0]?.message?.content ?? "{}"), candidate), costUsd: costFor(VISION_MODEL, res.usage) };
}

/** Boards that keep their own picture: the opening map, code, the exam, a structure, maths and graphs. */
export function boardTakesImage(beat: CanvasPlanBeat, index: number): boolean {
  if (index === 0 || beat.refresher || beat.overview || beat.sourceDiagram || beat.foundImage) return false;
  return !["code", "exam", "structure", "equation", "graph", "figure"].includes(beat.stage);
}

export type BoardImageChoice = { candidate: ImageCandidate; verdict: ImageVerdict; use: "redraw" | "show"; diagram?: SourceDiagram };

/** The redraw when the chosen image is a kind of diagram the board can draw itself; otherwise it is shown. */
export function decideUse(beat: Pick<CanvasPlanBeat, "stage">, verdict: ImageVerdict, title = ""): { use: "redraw" | "show"; diagram?: SourceDiagram } {
  // A diagram in another language is never transcribed onto the board ("Compiler nl" became a wrong
  // flow): gpt-image-2 redraws it in English instead.
  if (inAnotherLanguage(title) || verdict.englishLabels.join("|") !== verdict.labels.join("|")) return { use: "show" };
  const d = verdict.diagram ? asSequence(verdict.diagram) ?? verdict.diagram : null;
  if (!d) return { use: "show" };
  // A board planned as a message sequence is never turned into a flow chart.
  if (beat.stage === "sequence" && d.kind !== "sequence") return { use: "show" };
  return { use: "redraw", diagram: d };
}

/** The chosen image for one board, or none. `used`: images earlier boards already took. Never throws. */
export async function findBoardImage(openai: OpenAI, topic: string, beat: CanvasPlanBeat, used: Set<string>): Promise<{ choice: BoardImageChoice | null; costUsd: number; log: string; trace: Record<string, unknown> }> {
  let costUsd = 0;
  try {
    const q = await boardImageQueries(openai, topic, beat);
    costUsd += q.costUsd;
    // A library search matches every word, so a precise query finds few files: each is also searched as
    // its core two or three words ("instruction pipeline"), and the vision check decides which fits.
    const concept = conceptWords(topic, beat.title);
    const titleWords = words(beat.title).filter((w) => !GENERIC.has(w));
    const short = [titleWords.slice(0, 3).join(" "), ...q.queries.map((x) => words(x).filter((w) => !GENERIC.has(w)).slice(0, 3).join(" "))].filter((x) => x.split(" ").length >= 1 && x.length > 3);
    // The lesson's subject paired with each word of the board's title ("pipelining hazards"): a library file is
    // named for its concept, and "hazards" alone found workplace-safety charts and fire maps.
    const subject = [...words(topic).filter((w) => !GENERIC.has(w))].sort((x, y) => y.length - x.length)[0];
    const paired = subject ? [...new Set(titleWords.slice(0, 4).map(baseForm).filter((w) => w !== baseForm(subject)).map((w) => `${baseForm(subject)} ${w}`))] : [];
    const searched = [...new Set([...q.queries, ...paired, ...short])].slice(0, 9);
    // Commons answers every query; Openverse, which holds few diagrams, only the model's three.
    const lists = await Promise.all(searched.flatMap((query, i) => [searchCommons(query).catch(() => []), i < 3 ? searchOpenverse(query).catch(() => []) : Promise.resolve([])]));
    const pool = rankCandidates(lists.flat().filter((c) => !used.has(c.imageUrl) && !used.has(c.pageUrl)), `${beat.title} ${beat.brief} ${beat.script}`, concept);
    // Fetched one at a time (Wikimedia answers a burst with 429, which left a board with 11 candidates
    // and none judged), then judged together.
    const fetched: Array<{ candidate: ImageCandidate; bytes: Buffer }> = [];
    for (const candidate of pool.slice(0, JUDGED * 2)) {
      if (fetched.length >= JUDGED) break;
      const bytes = await download(candidate.imageUrl).catch(() => null);
      if (bytes) fetched.push({ candidate, bytes });
    }
    const judged = (await Promise.all(fetched.map(async ({ candidate, bytes }) => {
      const got = await judge(openai, topic, beat, candidate, bytes).catch(() => null);
      if (!got) return null;
      costUsd += got.costUsd;
      return { candidate, verdict: got.verdict };
    }))).filter((x): x is { candidate: ImageCandidate; verdict: ImageVerdict } => Boolean(x));
    const fit = judged.filter((j) => j.verdict.relevant && !j.verdict.textHeavy && j.verdict.score >= MIN_SCORE).sort((a, b) => b.verdict.score - a.verdict.score);
    const best = fit[0];
    const trace = {
      board: beat.id,
      title: beat.title,
      queries: searched,
      found: pool.length,
      judged: judged.map((j) => ({ title: j.candidate.title, provider: j.candidate.provider, imageUrl: j.candidate.imageUrl, pageUrl: j.candidate.pageUrl, license: j.candidate.license, creator: j.candidate.creator, relevant: j.verdict.relevant, score: j.verdict.score, reason: j.verdict.reason, shows: j.verdict.shows, redrawable: j.verdict.diagram?.kind ?? null })),
    };
    if (!best) return { choice: null, costUsd, log: `"${q.queries[0]}" → ${pool.length} found, ${judged.length} judged → none relevant`, trace: { ...trace, chosen: null } };
    const decided = decideUse(beat, best.verdict, best.candidate.title);
    const choice: BoardImageChoice = { ...best, ...decided };
    return {
      choice,
      costUsd,
      log: `"${q.queries[0]}" → ${pool.length} found, ${judged.length} judged → chose "${best.candidate.title}" (${best.candidate.provider}, ${best.verdict.score.toFixed(2)}, ${decided.use}${decided.diagram ? ` ${decided.diagram.kind}` : ""})`,
      trace: { ...trace, chosen: { title: best.candidate.title, imageUrl: best.candidate.imageUrl, pageUrl: best.candidate.pageUrl, use: decided.use, kind: decided.diagram?.kind ?? null, score: best.verdict.score, reason: best.verdict.reason } },
    };
  } catch (error) {
    return { choice: null, costUsd, log: `skipped — ${(error as Error).message}`, trace: { board: beat.id, error: (error as Error).message } };
  }
}

/** The plan beat after its image was chosen: a redraw goes the way of a page's diagram; a shown image makes it an illustration board. */
export function applyBoardImage(beat: CanvasPlanBeat, choice: BoardImageChoice): void {
  const { candidate, verdict } = choice;
  const source = { title: candidate.title, imageUrl: candidate.imageUrl, pageUrl: candidate.pageUrl, creator: candidate.creator, license: candidate.license, provider: candidate.provider };
  beat.imageSource = source;
  if (choice.use === "redraw" && choice.diagram) {
    const stage = DIAGRAM_STAGE[choice.diagram.kind];
    beat.sourceDiagram = { ...choice.diagram, url: candidate.pageUrl, site: candidate.provider };
    beat.stage = stage;
    beat.figure = undefined;
    if (beat.requiredVisual) beat.requiredVisual.stages = [stage];
    return;
  }
  beat.foundImage = { ...source, shows: verdict.shows, labels: verdict.englishLabels };
  beat.stage = "illustration";
  beat.figure = undefined;
  if (beat.requiredVisual) beat.requiredVisual.stages = ["illustration"];
}

const SCRIPT_MODEL = process.env.CANVAS_PLAN_MODEL ?? "gpt-5.6-luna";

/** What the narration rewrite is asked: teach FROM the picture now on the board. */
export function pictureScriptPrompt(topic: string, title: string, script: string, shows: string, labels: string[]): string {
  return [
    `Lesson: ${topic}`,
    `Board: ${title}`,
    `The picture now on this board: ${shows}`,
    labels.length ? `Its printed labels: ${labels.map((l) => `"${l}"`).join(", ")}` : "",
    `The board's narration, written before the picture was chosen:\n${script}`,
    "Rewrite the narration so Aria teaches FROM this picture: walk the student through it, naming each printed label as she explains it, in a natural order (top to bottom or left to right, or the order things happen).",
    "Keep every fact, the example values and the teaching aim of the original, and about the same length (one sentence more at most). Never describe anything that is not in the picture or the original narration. When the picture shows a number, say which part of the picture it belongs to (\"without forwarding it takes 8 cycles\").",
    "The picture is attached when available; its labels may be in another language, so say them in English as listed.",
    'Spoken English for a student, no markdown, no lists, no quotation marks, no speaker name. Return JSON: {"script": "…"}.',
  ].filter(Boolean).join("\n\n");
}

/**
 * THE PICTURE IS EXPLAINED (owner, 2026-11-11: "that redrawn image Aria don't explain"). The narration is
 * planned before the image is found, so it never talked about what the board now shows; it is rewritten
 * around the picture, its labels named in order so Aria's pointer follows her. Null keeps the original.
 */
export async function explainPictureScript(openai: OpenAI, topic: string, beat: Pick<CanvasPlanBeat, "title" | "script">, shows: string, labels: string[], imageUrl?: string): Promise<{ script: string; costUsd: number } | null> {
  try {
    // The picture itself: from words alone, "8 cycles" was put under the wrong half of a timing chart.
    const bytes = imageUrl ? await download(imageUrl).catch(() => null) : null;
    const picture = bytes ? await boardJpeg(bytes).catch(() => null) : null;
    const res = await openai.chat.completions.create({
      model: SCRIPT_MODEL,
      response_format: { type: "json_object" },
      max_completion_tokens: 4000,
      messages: [{ role: "user", content: picture
        ? [{ type: "text", text: pictureScriptPrompt(topic, beat.title, beat.script, shows, labels) }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${picture.toString("base64")}`, detail: "high" } }]
        : pictureScriptPrompt(topic, beat.title, beat.script, shows, labels) }],
    }, { signal: AbortSignal.timeout(45_000) });
    const script = String((JSON.parse(res.choices[0]?.message?.content ?? "{}") as { script?: unknown }).script ?? "")
      .replace(/\s+/g, " ")
      .replace(/^\s*aria\s*:\s*/i, "")
      .replace(/[“”"]/g, "")
      .trim();
    const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    // A rewrite that lost most of the board, or ran on, is not used.
    if (sentences(script) < 2 || sentences(script) > sentences(beat.script) + 2) return null;
    return { script, costUsd: costFor(SCRIPT_MODEL, res.usage) };
  } catch {
    return null;
  }
}

/** What the board writer is told about a picture it puts up rather than redraws. */
export function foundImageBrief(found: FoundBoardImage): string {
  const labels = found.labels.length ? found.labels.map((l) => `"${l}"`).join(", ") : "none";
  return `THE PICTURE ON THIS BOARD is redrawn from a real diagram found for it (${found.provider}: "${found.title}"): ${found.shows} Its printed labels: ${labels}. Write an "illustration" stage for it: "subject" one sentence saying what the picture shows; "parts" one for each printed label the narration explains, "name" EXACTLY as printed, "s" the sentence that names it; "labels": [] (the picture already prints them). Explain what the picture shows, in its own terms; never describe anything that is not in it.`;
}

/** The reference as the image model takes it: a PNG on white (a transparent SVG thumbnail would come through black). */
async function referencePng(bytes: Buffer): Promise<Buffer> {
  const img = await loadImage(plainPng(bytes));
  const scale = Math.min(1, 1536 / Math.max(img.width, img.height));
  const canvas = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.encode("png");
}

export function redrawPrompt(found: FoundBoardImage, corrections: string[] = []): string {
  return [
    `Redraw the reference image as a clean teaching diagram for a computer-science lecture board. It shows: ${found.shows}`,
    "Keep exactly the same structure as the reference: the same parts, the same connections and arrows, in the same order and arrangement. This is the same diagram, redrawn — add nothing and leave nothing important out.",
    found.labels.length ? `Write every label in English, spelled exactly: ${found.labels.map((l) => `"${l}"`).join(", ")}. Every word, abbreviation and single letter in the picture must be English — translate the reference's own (a Turkish pipeline's G, Ç, Y, B, S are IF, ID, EX, MEM, WB). No other text at all: no title, caption, watermark, logo, signature or credit.` : "No text other than the reference's own labels, written in English, abbreviations included.",
    "Style: plain white background, dark grey outlines, a few flat soft colours, clear sans-serif labels large enough to read on a projector, landscape.",
    corrections.length ? `Fix these faults of the previous attempt: ${corrections.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

const REDRAW_CHECK = `Image 1 is a reference diagram; image 2 is a redraw of it for a lecture board, with English labels. Return JSON {"ok": boolean, "problems": string[]}.
"ok" is true only when image 2 shows the same structure and meaning as image 1 (the same parts, connections, arrows and order), every listed label is present and spelled exactly, nothing is garbled, misspelt or invented, and EVERY piece of text in image 2 is English — a word, abbreviation or single letter left in the reference's language (Ç, Y, B) is a fault. The language is expected to differ from image 1. "problems": each fault, in a few words, that a redraw must fix.`;

/**
 * A found image put on its illustration board: REDRAWN by gpt-image-2 from it (owner, 2026-11-11: redraw
 * "by taking influence from the reference image"), in English and the board's style, checked against the
 * reference and drawn again once with the faults named. The original is never shown; a picture that fails
 * twice throws, and the board is written without one. Each part is placed on its printed label.
 */
export async function pictureFoundImage(openai: OpenAI, stage: IllustrationStage, found: FoundBoardImage): Promise<{ stage: IllustrationStage; located: number; costUsd: number; log: string }> {
  const bytes = await download(found.imageUrl);
  if (!bytes) throw new Error("the found image could not be fetched again");
  const reference = await referencePng(bytes);
  const price = priceFor(IMAGE_MODEL);
  let costUsd = 0;
  let corrections: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const img = await openai.images.edit({ model: IMAGE_MODEL, image: await toFile(reference, "reference.png", { type: "image/png" }), prompt: redrawPrompt(found, corrections), size: "1536x1024", quality: IMAGE_QUALITY } as never) as OpenAI.Images.ImagesResponse;
    const usage = img.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    costUsd += ((usage?.input_tokens ?? 0) * price.input + (usage?.output_tokens ?? 0) * price.output) / 1_000_000;
    const b64 = img.data?.[0]?.b64_json;
    if (!b64) throw new Error("the image model returned no picture");
    const drawn = Buffer.from(b64, "base64");
    const jpeg = await boardJpeg(drawn).catch((error: Error) => { throw new Error(`the redrawn picture could not be read (${drawn.length} bytes, starts ${drawn.subarray(0, 8).toString("hex")}): ${error.message}`); });
    const check = await openai.chat.completions.create({
      model: VISION_MODEL,
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      messages: [
        { role: "system", content: REDRAW_CHECK },
        { role: "user", content: [
          { type: "text", text: `Labels it must print: ${found.labels.join(", ") || "(none)"}` },
          { type: "image_url", image_url: { url: `data:image/png;base64,${reference.toString("base64")}`, detail: "high" } },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" } },
        ] },
      ],
    }, { signal: AbortSignal.timeout(45_000) });
    costUsd += costFor(VISION_MODEL, check.usage);
    const verdict = JSON.parse(check.choices[0]?.message?.content ?? "{}") as { ok?: unknown; problems?: unknown };
    const problems = (Array.isArray(verdict.problems) ? verdict.problems : []).filter((p): p is string => typeof p === "string").map((p) => p.slice(0, 160)).slice(0, 6);
    if (verdict.ok !== true) {
      corrections = problems.length ? problems : ["it did not match the reference"];
      continue;
    }
    const key = `asset-web-${createHash("sha256").update(`${IMAGE_MODEL}|${found.imageUrl}|${found.labels.join("|")}`).digest("hex").slice(0, 32)}`;
    // Loaded here, not at the top: the store is server-only, and the rest of this file is tested on its own.
    const { saveSharedCanvasImage } = await import("./store");
    await saveSharedCanvasImage(key, jpeg);
    const boxes = await printedLabelBoxes(jpeg, stage.parts.map((p) => p.name)).catch(() => new Map());
    const parts = stage.parts.flatMap((p) => {
      const box = boxes.get(p.name);
      return box ? [{ ...p, x: Math.round((box.x + box.w / 2) * 1000) / 1000, y: Math.round((box.y + box.h / 2) * 1000) / 1000, labelBox: box }] : [];
    });
    return {
      stage: {
        ...stage,
        parts,
        labels: [],
        labelsInPicture: found.labels,
        description: found.shows,
        src: `/api/canvas-lecture/image/${key}`,
        paper: "#ffffff",
        credit: { title: found.title, creator: found.creator, license: found.license, sourceUrl: found.pageUrl, provider: found.provider, redrawn: true },
      },
      located: parts.length,
      costUsd,
      log: `${IMAGE_MODEL} ${IMAGE_QUALITY} redraw ${attempt === 1 ? "passed its check" : `passed after one redraw for: ${corrections.join("; ").slice(0, 160)}`}`,
    };
  }
  throw Object.assign(new Error(`the redraw failed its check twice: ${corrections.join("; ").slice(0, 200)}`), { costUsd });
}
