import type { Pt } from "./types";

/**
 * THE TEXTBOOK DIAGRAM LIBRARY, AS DATA (pure — lib/figures/library.ts loads it on the server).
 *
 * Real, openly-licensed diagrams from Wikimedia Commons (scripts/figures/harvest-library.mts),
 * their own words taken off and every labelled part kept as an exact anchor
 * (scripts/figures/normalise-library.mts). A board shows the art and labels the parts its narration
 * names, in the board's own label style (lib/figures/labels.ts).
 */

export type LibraryLicence = "Public domain" | "CC0" | `CC BY${string}` | `CC BY-SA${string}`;

export type LibraryPart = { id: string; name: string; anchor: Pt; confidence: "high" | "low" };

export type LibraryAsset = {
  id: string;
  title: string;
  keywords: string[];
  seed: string;
  source: { url: string; author: string; licence: string; licenceUrl: string; revision: number; file?: string; ocr?: boolean };
  /** "Author, Licence, via Wikimedia Commons" — shown under the figure. */
  credit: string;
  w: number;
  h: number;
  parts: LibraryPart[];
  reviewed: boolean;
  rejected?: boolean;
};

/** What a board stage carries (lib/canvas/types.ts FigureStage.asset): enough to lay it out with no disk. */
export type StageAsset = { id: string; w: number; h: number; credit: string; parts: Array<{ id: string; name: string; anchor: Pt }> };

export const LIBRARY_ID = /^[a-z0-9-]{1,80}$/;

/* ── licence gate ─────────────────────────────────────────────────────────────────────────── */

/**
 * Keep only licences that let us show and adapt the art with, at most, attribution and share-alike:
 * public domain, CC0, CC BY and CC BY-SA (any version). Non-commercial, no-derivatives, fair use,
 * GFDL-only and anything unrecognised are rejected — an unknown licence is a no.
 */
export function licenceGate(shortName: string | undefined, licence?: string): { ok: true; licence: LibraryLicence } | { ok: false; reason: string } {
  const raw = `${shortName ?? ""}`.trim();
  const all = `${raw} ${licence ?? ""}`.toLowerCase();
  if (!raw && !licence) return { ok: false, reason: "no licence" };
  if (/\bnc\b|non[- ]?commercial|\bnd\b|no[- ]?deriv|fair[- ]use|non[- ]?free|copyrighted|all rights reserved/.test(all)) return { ok: false, reason: `restricted (${raw})` };
  const s = raw.toLowerCase().replace(/_/g, " ");
  const l = (licence ?? "").toLowerCase();
  if (/public domain|^pd\b|^pd-/.test(s) || /^pd\b|^pd-/.test(l)) return { ok: true, licence: "Public domain" };
  if (/\bcc0\b|cc-zero|cc zero/.test(s) || /^cc0/.test(l)) return { ok: true, licence: "CC0" };
  const sa = /^cc[- ]by[- ]sa(?:[- ]?(\d(?:\.\d)?))?/.exec(s) ?? /^cc-by-sa(?:-(\d(?:\.\d)?))?/.exec(l);
  if (sa) return { ok: true, licence: `CC BY-SA${sa[1] ? ` ${sa[1]}` : ""}` };
  const by = /^cc[- ]by(?:[- ]?(\d(?:\.\d)?))?(?![- ]?[a-z])/.exec(s) ?? /^cc-by(?:-(\d(?:\.\d)?))?$/.exec(l);
  if (by) return { ok: true, licence: `CC BY${by[1] ? ` ${by[1]}` : ""}` };
  return { ok: false, reason: `unrecognised (${raw || licence})` };
}

/** A file named for a language other than English ("Heart diagram-fr.svg") — its labels are not English. */
const LANGS = "af|am|an|ar|ast|az|be|bg|bn|br|bs|ca|cs|cy|da|de|el|eo|es|et|eu|fa|fi|fo|fr|fy|ga|gl|gu|he|hi|hr|hu|hy|ia|id|is|it|ja|ka|kk|km|kn|ko|ku|la|lb|lt|lv|mk|ml|mn|mr|ms|mt|my|nb|ne|nl|nn|no|oc|pa|pl|ps|pt|pt-br|ro|ru|sa|sh|si|sk|sl|sq|sr|sv|sw|ta|te|tg|th|tl|tr|tt|uk|ur|uz|vi|yi|zh|zh-hans|zh-hant|zh-cn|zh-tw|zhtw|zhcn|zh_tw|ptbr|pt_br|sr-ec|sr-el|as|ln|or|ckb|ig|yo|ha|zu|xh|so|rw|mg|ht|qu|ug|ky|sd|ceb|frp|scn|vec|lmo|nap|pms|co|wa|li|nds|bar|als|hsb|csb|szl|ab|os|cv|ba|ce|dv|ga|gd|kw|gv|ne|si|my|lo|bo|dz|jv|su|tet|tpi|ilo|pam|bcl|war|hif|mai|sat|new|bpy|mni";
const LANGUAGE_NAMES = /\b(malayalam|hindi|arabic|spanish|french|german|italian|portuguese|russian|chinese|japanese|korean|turkish|persian|farsi|urdu|bengali|tamil|telugu|kannada|marathi|gujarati|punjabi|polish|czech|dutch|swedish|finnish|greek|hebrew|hungarian|romanian|ukrainian|vietnamese|thai|indonesian|malay|catalan|basque|galician|esperanto|latin|croatian|serbian|slovak|slovenian|bulgarian|norwegian|danish|estonian|latvian|lithuanian|swahili|tagalog|español|français|deutsch|italiano|português|русский|中文|日本語)\b/i;
const OTHER_LANGUAGE = new RegExp(`[\\s_(.-](?:${LANGS})\\)?\\.svg$`, "i");
const ENGLISH = /[\s_(.-]en(?:-gb|-us)?\)?\.svg$|english/i;
export function fileLanguage(title: string): "en" | "other" | "unknown" {
  if (ENGLISH.test(title)) return "en";
  if (OTHER_LANGUAGE.test(title) || LANGUAGE_NAMES.test(title)) return "other";
  return "unknown";
}

/* ── retrieval ────────────────────────────────────────────────────────────────────────────── */

const STOP = new Set("a an and are as at be by diagram diagrams figure for from has have how in inside into is it its labelled labeled of on or part parts show shows showing structure the their them then there these this to two use used what when where which with within".split(" "));
const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);
export const words = (t: string): string[] => (t.toLowerCase().normalize("NFKD").match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

/** Does `text` contain `phrase` (word by word, plurals forgiven)? */
function hasPhrase(textWords: string[], phrase: string): boolean {
  const p = words(phrase);
  if (!p.length) return false;
  outer: for (let i = 0; i + p.length <= textWords.length; i++) {
    for (let j = 0; j < p.length; j++) if (textWords[i + j] !== p[j]) continue outer;
    return true;
  }
  return false;
}

export type LibraryMatch = { asset: LibraryAsset; score: number; subject: number; parts: string[] };

/**
 * How well one asset fits a board. SUBJECT words (the seed and its keywords — "heart", "nephron",
 * "oxbow lake") must appear: a board that never names the subject never gets the diagram. Each
 * extra subject word adds 1; each of the asset's part names the board says adds 1 (2 when the
 * syllabus requires it to be shown), at most 6; title words add 0.5 each, at most 2.
 */
const GENERIC_KEYWORDS = new Set("system systems human humans male female complete english diagram diagrams structure structures earth labelled labeled simple model models general overview body part parts development cross section view type types process processes cycle".split(" "));

export function scoreLibraryAsset(asset: LibraryAsset, text: string, mustShow: string[] = []): LibraryMatch {
  const tw = words(`${text} ${mustShow.join(" ")}`);
  const mw = words(mustShow.join(" . "));
  // Generic single words from file titles ("human", "system", "complete", "english") are not a
  // subject: they matched a maths outcome to the male reproductive system (audit 2026-10-17).
  const subjects = [...new Set([asset.seed, ...asset.keywords].map((k) => k.toLowerCase()))].filter((k) => words(k).some((w) => !GENERIC_KEYWORDS.has(w)) && hasPhrase(tw, k));
  const subject = subjects.length;
  const said = asset.parts.filter((p) => !/^\d/.test(p.id)).filter((p) => hasPhrase(tw, p.name.replace(/\([^)]*\)/g, " ")));
  const partScore = Math.min(6, said.reduce((sum, p) => sum + (hasPhrase(mw, p.name.replace(/\([^)]*\)/g, " ")) ? 2 : 1), 0));
  const titleWords = [...new Set(words(asset.title))].filter((w) => !GENERIC_KEYWORDS.has(w) && tw.includes(w)).length;
  const score = subject ? 4 + (subject - 1) + partScore + Math.min(2, titleWords * 0.5) + (asset.reviewed ? 0.5 : 0) : 0;
  return { asset, score, subject, parts: said.map((p) => p.id) };
}

/**
 * The library diagram a board should show, or null. THRESHOLD: a score of at least 6 — a subject
 * word (4) plus two more signals: a second subject word, or part names the board says, or title
 * words. One bare word ("cell", "eye") on a board about something else is never enough. Rejected
 * assets are never offered; ties go to the asset with more exact (leader-traced) parts.
 */
export const LIBRARY_MATCH_THRESHOLD = 6;
export function pickLibraryAsset(index: LibraryAsset[], text: string, mustShow: string[] = []): LibraryMatch | null {
  let best: LibraryMatch | null = null;
  for (const asset of index) {
    if (asset.rejected) continue;
    if (asset.parts.filter((p) => p.confidence === "high").length < 3) continue;
    const m = scoreLibraryAsset(asset, text, mustShow);
    if (m.score < LIBRARY_MATCH_THRESHOLD) continue;
    const exact = (a: LibraryAsset) => a.parts.filter((p) => p.confidence === "high").length;
    if (!best || m.score > best.score || (m.score === best.score && exact(asset) > exact(best.asset))) best = m;
  }
  return best;
}

/** The asset as a board stage carries it (only the parts a label may point at). */
export function stageAsset(asset: LibraryAsset): StageAsset {
  return {
    id: asset.id,
    w: asset.w,
    h: asset.h,
    credit: asset.credit,
    // Until a person has reviewed the asset, only leader-traced parts may carry a label.
    parts: asset.parts.filter((p) => p.confidence === "high" || asset.reviewed).map((p) => ({ id: p.id, name: p.name, anchor: { x: Math.round(p.anchor.x * 10) / 10, y: Math.round(p.anchor.y * 10) / 10 } })),
  };
}
