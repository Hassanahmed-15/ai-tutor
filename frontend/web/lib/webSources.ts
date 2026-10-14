/**
 * A TYPED-PROMPT LESSON TAUGHT FROM THE WEB, WITH ITS SOURCES ON EVERY SLIDE (2026-10-14).
 *
 * "explain transport in animals igcse biology" produced a good lecture that left out what the IGCSE
 * topic is actually about — the heart's chambers, the vessels, double circulation — because nothing
 * told the planner what that syllabus contains. Now, once Aria knows what the student wants
 * (lib/lessonIntent.ts), she reads up on it first (lib/webResearch.ts, OpenAI web search): the
 * lesson is planned and taught from that material, and each slide ends with the links it came from,
 * the way an answer with citations does.
 *
 * Pure (no network, no server APIs), so it is unit-tested (lib/anim/webSources.test.ts) and shared by
 * the planner route, the worker and the player.
 */

export type WebSource = { id: string; title: string; url: string; site: string };
export type SourcePoint = { text: string; sources: string[] };

/** What the web research found: the facts to teach from, each tied to the pages that state it. */
export type SourcePack = {
  /** What was searched for, in words (shown nowhere; kept for the log and the cache). */
  query: string;
  /** The curriculum the research was for ("Cambridge IGCSE Biology 0610"), when there was one. */
  curriculum?: string;
  /** The syllabus or learning points the lesson must cover — the outline is checked against these. */
  checklist: string[];
  /** The material: each fact once, with the source ids that state it. */
  points: SourcePoint[];
  /** The pages, as cited by the search itself (never a URL the model typed on its own). */
  sources: WebSource[];
};

/** What the student wants, as the intent conversation settled it (lib/lessonIntent.ts). */
export type LessonBrief = {
  /** exam = cover a syllabus topic for an exam; understand = learn an idea; question = one specific answer. */
  goal?: "exam" | "understand" | "question";
  /** "Cambridge IGCSE Biology", "A Level Physics", "university", … */
  curriculum?: string;
  /** "Grade 10", "first-year university", "beginner" … */
  level?: string;
  /** "the whole topic", or the part they want ("just the heart"). */
  scope?: string;
};

export const MAX_SOURCES = 8;
export const MAX_POINTS = 40;
export const MAX_CHECKLIST = 30;
/** Links shown under one slide: the few it actually drew on. */
export const SOURCES_PER_SLIDE = 3;

/** Friendly names for the sites a lesson most often cites; anything else shows its host name. */
const SITE_NAMES: Array<[RegExp, string]> = [
  [/(^|\.)wikipedia\.org$/, "Wikipedia"],
  [/(^|\.)britannica\.com$/, "Britannica"],
  [/(^|\.)bbc\.co\.uk$/, "BBC Bitesize"],
  [/(^|\.)khanacademy\.org$/, "Khan Academy"],
  [/(^|\.)savemyexams\.com$/, "Save My Exams"],
  [/(^|\.)cambridgeinternational\.org$/, "Cambridge International"],
  [/(^|\.)physicsandmathstutor\.com$/, "Physics & Maths Tutor"],
  [/(^|\.)cognitoedu\.org$/, "Cognito"],
  [/(^|\.)pearson\.com$|(^|\.)qualifications\.pearson\.com$/, "Pearson"],
  [/(^|\.)aqa\.org\.uk$/, "AQA"],
  [/(^|\.)ocr\.org\.uk$/, "OCR"],
  [/(^|\.)nih\.gov$/, "NIH"],
  [/(^|\.)nature\.com$/, "Nature"],
  [/(^|\.)libretexts\.org$/, "LibreTexts"],
  [/(^|\.)openstax\.org$/, "OpenStax"],
];

export function siteName(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
  return SITE_NAMES.find(([re]) => re.test(host))?.[1] ?? host;
}

/**
 * A page's name read off its address, for a link the search gave no title: ".../40-1-overview-of-the-
 * circulatory-system" → "Overview of the circulatory system". Empty when the address says nothing
 * (a bare domain, an id).
 */
export function titleFromUrl(url: string): string {
  let segment = "";
  try {
    segment = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return "";
  }
  const words = segment
    .replace(/\.(?:html?|php|aspx?|pdf)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/^\d+(?:\s+\d+)*\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[a-z]{3,}/i.test(words) || /^[0-9a-f]{8,}$/i.test(words)) return "";
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 100);
}

/** Only real web pages: http(s), no tracking parameters the search appends. */
export function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    for (const key of [...url.searchParams.keys()]) if (/^utm_/.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return null;
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * A pack as it arrives (from the cache, the client or the research call), made safe: real links only,
 * ids that resolve, nothing oversized, duplicates dropped. Null when nothing usable is left.
 */
export function sanitizeSourcePack(raw: unknown): SourcePack | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const sources: WebSource[] = [];
  const seenUrls = new Set<string>();
  for (const s of Array.isArray(obj.sources) ? obj.sources : []) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const url = cleanUrl(rec.url);
    if (!url || seenUrls.has(url)) continue;
    const id = text(rec.id, 8) || `S${sources.length + 1}`;
    if (sources.some((x) => x.id === id)) continue;
    seenUrls.add(url);
    sources.push({ id, url, title: text(rec.title, 140) || siteName(url), site: text(rec.site, 60) || siteName(url) });
    if (sources.length >= MAX_SOURCES) break;
  }
  if (sources.length === 0) return null;
  const ids = new Set(sources.map((s) => s.id));
  const points: SourcePoint[] = [];
  const seenPoints = new Set<string>();
  for (const p of Array.isArray(obj.points) ? obj.points : []) {
    if (!p || typeof p !== "object") continue;
    const rec = p as Record<string, unknown>;
    const t = text(rec.text, 400);
    const key = t.toLowerCase();
    if (!t || seenPoints.has(key)) continue;
    seenPoints.add(key);
    const from = (Array.isArray(rec.sources) ? rec.sources : []).map((x) => text(x, 8)).filter((x) => ids.has(x));
    points.push({ text: t, sources: [...new Set(from)] });
    if (points.length >= MAX_POINTS) break;
  }
  const checklist = [...new Set((Array.isArray(obj.checklist) ? obj.checklist : []).map((c) => text(c, 160)).filter(Boolean))].slice(0, MAX_CHECKLIST);
  if (points.length === 0 && checklist.length === 0) return null;
  const curriculum = text(obj.curriculum, 120);
  return { query: text(obj.query, 300), ...(curriculum ? { curriculum } : {}), checklist, points, sources };
}

const STOP = new Set(
  ("a an the and or of to in on at by for from with without into onto over under about as is are was were be been being it its this that these those " +
    "which who whom whose what when where why how than then so such can could may might must should would will do does did done has have had " +
    "not no nor but if each every all any some more most other another one two three their they them there here also only very just both " +
    "use used uses using via per between through during before after while because called known").split(" "),
);

function stem(word: string): string {
  return word.replace(/(?:ies)$/, "y").replace(/(?:ing|ed|es|s)$/, "");
}

/** The content words of a text, stemmed: what two texts are compared on. */
export function contentWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
}

/** Does `text` cover this point — enough of its content words appear in it? */
function mentions(point: string, words: Set<string>): boolean {
  const own = [...new Set(contentWords(point))];
  if (own.length === 0) return false;
  const hit = own.filter((w) => words.has(w)).length;
  // A short term ("vena cava", "double circulation") must appear whole; a longer point (a list of
  // named parts) mostly — an outline caption names the key ones, the board names them all.
  return own.length <= 3 ? hit === own.length : hit / own.length >= 0.5;
}

/**
 * The checklist points a text does not cover — used on the outline (titles and captions) before the
 * student presses Start, and the outline is revised once to take in what it missed.
 */
export function uncoveredChecklist(checklist: string[], covered: string): string[] {
  const words = new Set(contentWords(covered));
  return checklist.filter((point) => !mentions(point, words));
}

/**
 * THE SOURCES OF ONE SLIDE: the pages behind the material this slide actually teaches.
 *
 * Each point the slide's words cover votes for its sources; the most-cited few are the slide's links.
 * A slide that matches no point (an opener, a worked example in the lesson's own words) still shows
 * where the lesson's material came from: the pack's most-cited pages.
 */
export function sourcesForText(pack: SourcePack, slideText: string, max = SOURCES_PER_SLIDE): WebSource[] {
  const words = new Set(contentWords(slideText));
  const votes = new Map<string, number>();
  for (const point of pack.points) {
    const own = [...new Set(contentWords(point.text))];
    if (own.length === 0) continue;
    const hit = own.filter((w) => words.has(w)).length;
    if (hit < 2 && hit / own.length < 0.5) continue;
    for (const id of point.sources) votes.set(id, (votes.get(id) ?? 0) + hit);
  }
  const byId = new Map(pack.sources.map((s) => [s.id, s]));
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => byId.get(id)).filter((s): s is WebSource => Boolean(s));
  if (ranked.length) return ranked.slice(0, max);
  // Nothing matched: the pages the material leans on most.
  const cited = new Map<string, number>();
  for (const point of pack.points) for (const id of point.sources) cited.set(id, (cited.get(id) ?? 0) + 1);
  const fallback = [...cited.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => byId.get(id)).filter((s): s is WebSource => Boolean(s));
  return (fallback.length ? fallback : pack.sources).slice(0, Math.min(2, max));
}

/** The material, as the planners read it: numbered sources, then each point with the ids that state it. */
export function packForPrompt(pack: SourcePack, maxChars = 9_000): string {
  const sources = pack.sources.map((s) => `[${s.id}] ${s.site}: ${s.title}`).join("\n");
  const points = pack.points.map((p) => `- ${p.text}${p.sources.length ? ` [${p.sources.join(", ")}]` : ""}`).join("\n");
  const checklist = pack.checklist.length ? `\n\nWHAT THE ${pack.curriculum ? `${pack.curriculum.toUpperCase()} ` : ""}SYLLABUS EXPECTS (every point must be taught):\n${pack.checklist.map((c) => `- ${c}`).join("\n")}` : "";
  return `SOURCES:\n${sources}\n\nTHE MATERIAL:\n${points}${checklist}`.slice(0, maxChars);
}

/**
 * The JSON object in the research model's answer, wherever it put it. A web-search answer carries
 * inline citations — `([savemyexams.com](https://…))` — which the model also drops BETWEEN array
 * items, breaking the JSON; they are removed first (the same pages arrive as annotations anyway).
 */
export function jsonIn(textOut: string): Record<string, unknown> | null {
  const cleaned = textOut
    .replace(/\s*\(\[[^\]]*\]\([^)\s]*\)\)/g, "")
    .replace(/\s*\[[^\]]*\]\((?:https?:)?\/\/[^)\s]*\)/g, "")
    .replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1).replace(/,\s*([\]}])/g, "$1")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Of two checklists for the same request, the one that says more: the syllabus search's when it
 * found the syllabus and listed its points (8 or more), otherwise whichever is longer — a search
 * that only found a table of contents returns five headings, which is worse than none.
 */
export function betterChecklist(syllabus: unknown, content: unknown): unknown[] {
  const a = Array.isArray(syllabus) ? syllabus : [];
  const b = Array.isArray(content) ? content : [];
  if (a.length >= 8) return a;
  return b.length > a.length ? b : a;
}

/** A URL without its query, fragment or trailing slash, for comparing two links to the same page. */
export const sameUrl = (url: string) => url.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();

/**
 * The research, as a SourcePack: the model's points mapped onto the pages the search cited. A URL in
 * the JSON that the search never cited is dropped — unless the search cited nothing at all, in which
 * case the URLs it returned (from the same search turn) are the only record of where facts came from.
 */
export function packFromResearch(json: Record<string, unknown> | null, cited: Array<{ url: string; title: string }>, query: string): SourcePack | null {
  if (!json) return null;
  const sources: WebSource[] = [];
  const idFor = (raw: unknown): string | null => {
    const url = cleanUrl(raw);
    if (!url) return null;
    const found = sources.find((s) => sameUrl(s.url) === sameUrl(url));
    if (found) return found.id;
    const fromSearch = cited.find((p) => sameUrl(p.url) === sameUrl(url));
    if (!fromSearch && cited.length > 0) return null;
    if (sources.length >= MAX_SOURCES) return null;
    const id = `S${sources.length + 1}`;
    const given = (fromSearch?.title || "").trim();
    // A search title that is only the site's name says nothing about the page: name it from its address.
    const title = given && given.toLowerCase() !== siteName(url).toLowerCase() ? given : titleFromUrl(url) || siteName(url);
    sources.push({ id, url: fromSearch?.url ?? url, title, site: siteName(url) });
    return id;
  };
  const points = (Array.isArray(json.points) ? json.points : []).map((p) => {
    const rec = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const ids = (Array.isArray(rec.urls) ? rec.urls : []).map(idFor).filter((id): id is string => Boolean(id));
    return { text: rec.text, sources: [...new Set(ids)] };
  });
  // Pages the search cited that no point named still belong to the lesson's reading list.
  for (const page of cited) idFor(page.url);
  return sanitizeSourcePack({ query, curriculum: json.curriculum, checklist: json.checklist, points, sources });
}

/** The cache key of a research run: the same topic, for the same curriculum, goal and part, is read once. */
export function researchKey(topic: string, brief: LessonBrief | null | undefined): string {
  const norm = (value: string | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return [norm(topic), norm(brief?.curriculum), norm(brief?.goal), norm(brief?.scope)].join("|").slice(0, 250);
}
