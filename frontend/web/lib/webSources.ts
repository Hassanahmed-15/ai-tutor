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
  /** Who it was researched for, from the student's profile ("Cambridge International A Level Biology"). */
  audience?: string;
  /** The syllabus or learning points the lesson must cover — the outline is checked against these. */
  checklist: string[];
  /** The official syllabus text for this topic, when the course catalogue has it (lib/curriculum/syllabusOutcomes.ts). */
  syllabusText?: string;
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
  const audience = text(obj.audience, 120);
  return { query: text(obj.query, 300), ...(curriculum ? { curriculum } : {}), ...(audience ? { audience } : {}), checklist, points, sources };
}

/**
 * The level a page or a curriculum is written for, from its own words: "a-level" in a Save My Exams
 * address, "IGCSE" in a title, "openstax … college" for a university text. Null when it does not say.
 */
export function levelBandOf(value: string): "secondary" | "senior" | "university" | "lower" | null {
  const v = value.toLowerCase();
  if (/\bks3\b|key[- ]stage[- ]3|year[- ]?[789]\b|middle[- ]school|grade[- ]?[678]\b/.test(v)) return "lower";
  if (/\bas[- ]?(?:and[- ]?)?a[- ]?level|\ba[- ]?levels?\b|alevel|\bas[- ]?level|sixth[- ]form|\bfsc\b|\bhssc\b|\bib[- ]?dp\b|\bap[- ](?:bio|chem|phys|calc)/.test(v)) return "senior";
  if (/igcse|\bgcse|\bo[- ]?levels?\b|olevel|\bmatric\b|\bssc\b|\bks4\b/.test(v)) return "secondary";
  if (/openstax|libretexts|\buniversity\b|\bcollege\b|undergraduate|\.edu\/|\.ac\.uk\/|lecture[- ]notes/.test(v)) return "university";
  return null;
}

/**
 * NO PAGES FROM THE WRONG LEVEL. A source whose own address or title says it is for a different level
 * than the student's (a GCSE page in an A Level lesson, a university text for O Level) is dropped,
 * with the facts only it stated. Pages that do not say their level, and the syllabus itself, stay. A
 * pack is never cut below two sources: then it is returned as it was.
 */
export function dropOffLevelSources(pack: SourcePack, target: string | null | undefined): { pack: SourcePack; dropped: WebSource[] } {
  const want = target ? levelBandOf(target) : null;
  if (!want) return { pack, dropped: [] };
  const off = pack.sources.filter((s) => {
    if (/syllabus|specification/i.test(`${s.title} ${s.url}`)) return false;
    const band = levelBandOf(`${s.url} ${s.title}`);
    return band !== null && band !== want;
  });
  if (off.length === 0 || pack.sources.length - off.length < 2) return { pack, dropped: [] };
  const gone = new Set(off.map((s) => s.id));
  const points = pack.points
    .map((p) => ({ ...p, sources: p.sources.filter((id) => !gone.has(id)) }))
    .filter((p, i) => p.sources.length > 0 || pack.points[i].sources.length === 0);
  return { pack: { ...pack, sources: pack.sources.filter((s) => !gone.has(s.id)), points }, dropped: off };
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
  const official = pack.syllabusText ? `\n\nTHE OFFICIAL SYLLABUS TEXT FOR THIS TOPIC (teach every term it names, e.g. each structure, vessel or component in a "limited to:" list; use its own words; nothing beyond its Core and Supplement):\n${pack.syllabusText}` : "";
  // The facts are what gets cut when it is long — never what the syllabus says must be taught.
  const head = `SOURCES:\n${sources}\n\nTHE MATERIAL:\n`;
  return `${head}${points.slice(0, Math.max(1_000, maxChars - head.length - checklist.length - official.length))}${checklist}${official}`;
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
 * FACTS CREDITED TO THE PAGES THEIR OWN SEARCH READ. A search for "cell biology A Level notes" read
 * real A Level revision pages (marlbridge "A Level Biology 9700 cell structure revision notes",
 * Seneca, …) and then linked every fact to the syllabus PDF from memory (measured 2026-10-14). A fact
 * whose links are not pages THIS search returned is credited to the search's pages whose names match
 * it best — or, when none does, its top result. Each search is grounded in its own pages only.
 */
export function groundPointsInFound(json: Record<string, unknown> | null, pages: Array<{ url: string; title: string }>): Record<string, unknown> | null {
  if (!json || pages.length === 0 || !Array.isArray(json.points)) return json;
  const seen = (u: unknown) => {
    const url = cleanUrl(u);
    return Boolean(url) && pages.some((p) => sameUrl(p.url) === sameUrl(url!));
  };
  const named = pages.map((p) => ({ url: p.url, words: new Set(contentWords(`${p.title} ${titleFromUrl(p.url)}`)) }));
  const points = json.points.map((raw) => {
    const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const urls = Array.isArray(rec.urls) ? rec.urls : [];
    if (urls.some(seen)) return { ...rec, urls: urls.filter(seen) };
    const words = contentWords(String(rec.text ?? ""));
    const ranked = named.map((p) => ({ url: p.url, score: words.filter((w) => p.words.has(w)).length })).sort((a, b) => b.score - a.score);
    const best = ranked.filter((r) => r.score > 0).slice(0, 2).map((r) => r.url);
    return { ...rec, urls: best.length ? best : [pages[0].url] };
  });
  return { ...json, points };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/**
 * The research, as a SourcePack: the model's points mapped onto REAL pages — the ones its search
 * cited or returned (`cited`; `cited: false` = returned only). Never a page the search did not see:
 *  1. a link to a page the search saw is that page;
 *  2. a link the model wrote to a page it did NOT see, on a site whose pages it did see, is that
 *     site's page instead (measured 2026-10-14: a JSON answer often writes its own paths — 0 of 31
 *     links matched, and the whole lesson lost its material);
 *  3. anything else is dropped; and when nothing at all matched, the facts are credited to the pages
 *     the search returned (they are where this search's facts came from).
 */
export function packFromResearch(json: Record<string, unknown> | null, cited: Array<{ url: string; title: string; cited?: boolean }>, query: string): SourcePack | null {
  if (!json) return null;
  const sources: WebSource[] = [];
  const add = (page: { url: string; title: string }): string | null => {
    const known = sources.find((s) => sameUrl(s.url) === sameUrl(page.url));
    if (known) return known.id;
    if (sources.length >= MAX_SOURCES) return null;
    const id = `S${sources.length + 1}`;
    const given = (page.title || "").trim();
    // A search title that is only the site's name says nothing about the page: name it from its address.
    const title = given && given.toLowerCase() !== siteName(page.url).toLowerCase() ? given : titleFromUrl(page.url) || siteName(page.url);
    sources.push({ id, url: page.url, title, site: siteName(page.url) });
    return id;
  };
  const idFor = (raw: unknown): string | null => {
    const url = cleanUrl(raw);
    if (!url) return null;
    const exact = cited.find((p) => sameUrl(p.url) === sameUrl(url));
    if (exact) return add(exact);
    if (cited.length === 0) return add({ url, title: "" });
    const sameSite = cited.find((p) => p.cited !== false && hostOf(p.url) === hostOf(url)) ?? cited.find((p) => hostOf(p.url) === hostOf(url));
    return sameSite ? add(sameSite) : null;
  };
  const rawPoints = Array.isArray(json.points) ? json.points : [];
  let points = rawPoints.map((p) => {
    const rec = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const ids = (Array.isArray(rec.urls) ? rec.urls : []).map(idFor).filter((id): id is string => Boolean(id));
    return { text: rec.text, sources: [...new Set(ids)] };
  });
  // A page the answer CITED belongs on the reading list even if no point named it; a page the search
  // merely returned only verifies the links points name.
  for (const page of cited) if (page.cited !== false) add(page);
  if (sources.length === 0 && cited.length > 0) {
    const ids = cited.slice(0, 3).map(add).filter((id): id is string => Boolean(id));
    points = points.map((p) => ({ ...p, sources: ids }));
  }
  return sanitizeSourcePack({ query, curriculum: json.curriculum, audience: json.audience, checklist: json.checklist, points, sources });
}

/** The cache key of a research run: the same topic, for the same curriculum, level, goal and part, is read once. */
/**
 * WHAT ARIA SAYS CARRIES NO SOURCE TAGS (2026-10-16). The material is handed to the planner with
 * every fact tagged by its page ("[S1, S2]"), and it wrote them into the scripts — "Sources: [S1],
 * [S2]." — which Aria then read aloud as "Sources: S 1, S 2". The slide shows its links by itself
 * (sourcesForText); here a "Sources:" sentence and any inline [S3] / [S1, S2] tag are removed, and
 * nothing else is: real brackets, maths and "p1" stay.
 */
export function withoutSourceTags(text: string): string {
  const tag = String.raw`\[S\d{1,2}(?:\s*,\s*S\d{1,2})*\]`;
  return text
    .replace(new RegExp(String.raw`\s*\bSources?\s*:\s*${tag}(?:\s*(?:,|and)\s*${tag})*\s*\.?`, "gi"), "")
    .replace(new RegExp(String.raw`\s*\(?${tag}\)?`, "g"), "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function researchKey(topic: string, brief: LessonBrief | null | undefined): string {
  const norm = (value: string | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // The level is part of the key: the same topic for an undergraduate and an A Level student is two researches.
  return [norm(topic), norm(brief?.curriculum), norm(brief?.level), norm(brief?.goal), norm(brief?.scope)].join("|").slice(0, 250);
}
