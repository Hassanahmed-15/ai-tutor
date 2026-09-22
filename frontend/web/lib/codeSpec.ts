/**
 * The `code` spec: a real listing, walked through in steps, each step highlighting the lines the
 * narration is discussing at that moment.
 *
 * Code had no engine at all. Asked to "explain the remove function", the pipeline drew an animated
 * tree and never once showed the function — the model was told "Do not include code" and every
 * board type was a picture. A listing is READ, like a derivation, so it gets a board that shows the
 * text itself and moves a highlight through it, rather than a drawing of what the code does.
 *
 * Mirrors equationSpec.ts: validate, cap, never throw, and guarantee that anything which validates
 * is renderable. Here that means every step's line range lies inside the listing — a highlight on
 * line 40 of a 12-line function is a board pointing at nothing.
 */

export type CodeStep = { lines: [number, number]; note: string };
export type CodeSpec = {
  title?: string;
  language: CodeLanguage;
  code: string;
  steps: CodeStep[];
  /** True when the listing was copied from the student's own document rather than written. */
  fromSource?: boolean;
};

export const CODE_LANGUAGES = [
  "cpp",
  "c",
  "java",
  "python",
  "javascript",
  "typescript",
  "csharp",
  "go",
  "sql",
  "pseudocode",
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  js: "javascript",
  ts: "typescript",
  py: "python",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  pseudo: "pseudocode",
  text: "pseudocode",
  plaintext: "pseudocode",
};

const MIN_STEPS = 2; // one highlight is a quote, not a walkthrough
const MAX_STEPS = 10;
/**
 * REJECT limits, not slices. Cutting a listing at a fixed length hands the student half a function
 * — an `if` with no body, a brace that never closes — which reads as a bug in the code rather than
 * in the board.
 */
export const MAX_CODE_LINES = 60;
export const MAX_CODE_CHARS = 4_000;

function text(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : undefined;
}

export function normalizeLanguage(value: unknown): CodeLanguage | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if ((CODE_LANGUAGES as readonly string[]).includes(key)) return key as CodeLanguage;
  return LANGUAGE_ALIASES[key] ?? null;
}

/** Tabs become four spaces and trailing blank lines go: the listing is shown, so it is tidied. */
function normalizeCode(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/^\s*\n/, "")
    .replace(/\s+$/, "");
}

export type CodeRejection = { reason: string };

/** Comment wording that only ever stands in for code that was not written. */
const PLACEHOLDER_COMMENT =
  /(?:\/\/|#|\/\*)\s*(?:todo\b|fixme\b|.*\b(?:if needed|as needed|left as an exercise|omitted for brevity|not shown|your code here|rest of the (?:code|function|logic)|and so on)\b)/i;
/** "// handle the two-children case" — a stub only when nothing follows it inside its block. */
const CASE_COMMENT = /(?:\/\/|#|\/\*)\s*(?:handle|implement)\b.*\bcases?\b/i;

/** The first line standing in for unwritten code, or undefined. */
export function findStubLine(code: string): string | undefined {
  const lines = code.split("\n");
  return lines.find((line, i) => {
    if (/^\s*(?:\.\.\.|…)\s*;?\s*$/.test(line) || PLACEHOLDER_COMMENT.test(line)) return true;
    if (!CASE_COMMENT.test(line)) return false;
    const next = lines.slice(i + 1).find((l) => l.trim());
    return next === undefined || /^\s*[}\])]/.test(next);
  });
}

const CODE_KEYWORDS = new Set([
  "void", "int", "bool", "char", "float", "double", "long", "auto", "const", "static", "return", "if", "else",
  "while", "for", "delete", "new", "null", "nullptr", "true", "false", "class", "struct", "public", "private",
  "def", "self", "none", "elif", "and", "not", "the", "let", "var", "function", "this",
]);

/**
 * Is this listing really FROM the document, as the model claims?
 *
 * The model marks `fromSource: true` on code it wrote itself — measured on a scanned chapter with no
 * listing at all, and on a typed topic with no document whatsoever — and the board then shows the
 * student a "From your document" chip for code that is not in their document. The claim is checked
 * against the extracted text: the document must contain code, and most of the listing's own
 * identifiers must appear in it. A listing only visible in a page IMAGE cannot be checked, so the
 * chip is withheld there rather than asserted.
 */
export function verifyFromSource(code: string, sourceText: string | undefined | null): boolean {
  if (!sourceText || !looksLikeCode(sourceText)) return false;
  const source = sourceText.toLowerCase();
  const identifiers = [...new Set((code.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []).filter((id) => !CODE_KEYWORDS.has(id)))];
  if (identifiers.length === 0) return false;
  const found = identifiers.filter((id) => source.includes(id)).length;
  return found / identifiers.length >= 0.7;
}

/** The full result: the spec, or null with the reasons it was refused. */
export function parseCodeSpec(raw: unknown): { spec: CodeSpec | null; rejected: CodeRejection[] } {
  const rejected: CodeRejection[] = [];
  if (!raw || typeof raw !== "object") return { spec: null, rejected: [{ reason: "the spec is not a JSON object" }] };
  const o = raw as Record<string, unknown>;

  const language = normalizeLanguage(o.language);
  if (!language) {
    rejected.push({ reason: `language must be one of ${CODE_LANGUAGES.join(", ")}` });
    return { spec: null, rejected };
  }

  const code = typeof o.code === "string" ? normalizeCode(o.code) : "";
  if (!code) {
    rejected.push({ reason: "`code` is empty" });
    return { spec: null, rejected };
  }
  /*
   * A STUB IS NOT A LISTING. Asked for the deletion code of a chapter whose whole point is the
   * two-children case, the board came back with `// Handle two children case, if needed` in its
   * place — the one case the page explains, left as a comment. Refused so the retry writes it.
   */
  const stub = findStubLine(code);
  if (stub) {
    rejected.push({
      reason: `the listing leaves part of the algorithm unwritten ("${stub.trim().slice(0, 60)}") — implement EVERY case the document describes, in full; no placeholder comments or "..."`,
    });
    return { spec: null, rejected };
  }
  const lineCount = code.split("\n").length;
  if (lineCount > MAX_CODE_LINES || code.length > MAX_CODE_CHARS) {
    rejected.push({
      reason: `the listing is ${lineCount} lines / ${code.length} characters — keep it to the one function being taught (at most ${MAX_CODE_LINES} lines)`,
    });
    return { spec: null, rejected };
  }

  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  const steps: CodeStep[] = [];
  for (const entry of rawSteps) {
    if (steps.length >= MAX_STEPS) break;
    if (!entry || typeof entry !== "object") continue;
    const s = entry as Record<string, unknown>;
    const range = Array.isArray(s.lines) ? s.lines : [];
    const start = Number(range[0]);
    const end = Number(range.length > 1 ? range[1] : range[0]);
    const note = text(s.note, 160);
    if (!note) {
      rejected.push({ reason: "a step has no `note`" });
      continue;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lineCount) {
      rejected.push({ reason: `step lines [${range.join(", ")}] fall outside the ${lineCount}-line listing (lines are 1-based and inclusive)` });
      continue;
    }
    steps.push({ lines: [start, end], note });
  }

  if (steps.length < MIN_STEPS) {
    if (rejected.length === 0) rejected.push({ reason: `the walkthrough needs at least ${MIN_STEPS} steps` });
    return { spec: null, rejected };
  }
  return {
    spec: { title: text(o.title, 80), language, code, steps, ...(o.fromSource === true ? { fromSource: true } : {}) },
    rejected,
  };
}

/** The plain validator, same shape as validateEquationSpec. */
export function validateCodeSpec(raw: unknown): CodeSpec | null {
  return parseCodeSpec(raw).spec;
}

/** Unclosed `{` in this text, ignoring braces inside string and char literals. */
export function openBraces(text: string): number {
  const stripped = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
  return (stripped.match(/\{/g) ?? []).length - (stripped.match(/\}/g) ?? []).length;
}

/**
 * Re-joins a function the planner cut in half.
 *
 * A document's planner chunks a section into beats of a few blocks each, and it counts blocks, not
 * braces — so a 30-line `remove()` came out as two beats: the first ending mid-function (the code
 * board invented closing braces to make it compile-shaped) and the second a headless tail with a
 * title made from whatever text it started with. A listing is one thing to read; it belongs on one
 * board.
 *
 * A beat whose source leaves braces open absorbs the following beats until they close (or the next
 * beat stops looking like code). Only brace languages can be detected this way — PDF extraction has
 * already collapsed Python's indentation — and that is the case that was measured to break.
 */
export function mergeSplitCodeBeats<T extends { sourceBlockIds: string[] }>(beats: T[], textOf: (ids: string[]) => string): T[] {
  const out: T[] = [];
  for (let i = 0; i < beats.length; i++) {
    let current = beats[i];
    let open = openBraces(textOf(current.sourceBlockIds));
    while (open > 0 && i + 1 < beats.length) {
      const nextText = textOf(beats[i + 1].sourceBlockIds);
      if (!looksLikeCode(nextText) && openBraces(nextText) >= 0) break;
      i++;
      current = { ...current, sourceBlockIds: [...current.sourceBlockIds, ...beats[i].sourceBlockIds] };
      open += openBraces(nextText);
    }
    out.push(current);
  }
  return out;
}

/**
 * Should this question be answered with the code itself?
 *
 * Yes when the student names code outright ("in C++", "show the code", "snippet"), or when the
 * document they are studying contains code and they ask how a function/method/operation in it works.
 */
export function isCodeQuestion(question: string, documentContext = "", visualMode = ""): boolean {
  if (visualMode === "code_walkthrough") return true;
  const q = question.toLowerCase();
  if (asksForCode(q)) return true;
  return /\b(?:function|method|procedure|routine|remove|insert|delete|deletion|insertion|search|traverse|algorithm)\b/.test(q) &&
    /\b(?:how|work|working|explain|walk|step|mechanism)\b/.test(q) &&
    looksLikeCode(documentContext);
}

/**
 * Did the student ask to SEE code? "explain me deletion code", "in C++", "show the implementation".
 *
 * A refusal is checked first — "no code please" names code too, and must not produce a listing.
 */
export function asksForCode(text: string | undefined | null): boolean {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return false;
  if (/\b(?:no|without|skip the|don'?t (?:show|want|need|include)(?: me)?(?: the| any)?) code\b/.test(t)) return false;
  return /\b(?:code|coding|snippets?|implementation|implement|program|syntax|pseudo-?code)\b|c\+\+|\bjava\b|\bpython\b|\bjavascript\b|\bc#/.test(t);
}

/** A planned beat that teaches an implementation — where a student who wants code should get it. */
export const CODE_BEAT_PATTERN = /\b(?:code|coding|function|method|implement\w*|algorithm|program\w*|pseudo-?code|syntax)\b/i;

const REQUEST_STOPWORDS = new Set([
  "explain", "about", "their", "there", "these", "those", "which", "where", "while", "would", "could",
  "should", "please", "understand", "concept", "document", "using", "tell", "show", "give", "teach",
  "code", "coding", "implementation", "program", "snippet", "snippets", "syntax", "language",
]);

/**
 * WHICH BEATS SHOW THE CODE THE STUDENT ASKED FOR.
 *
 * Code boards used to appear only where the PAGES held code, or for a profile flagged "code
 * examples" — so uploading a textbook chapter on deletion (prose and diagrams, no listing) and asking
 * "explain me deletion code" produced a lecture of diagrams. Asking is enough now: the beats that
 * best match the request become code boards, written from what the pages describe when the pages
 * have no listing of their own.
 *
 * Scored rather than filtered, because real plans are small and oddly titled ("In C++ the Deletion
 * Mechanism", "Page 2"): a beat earns points for implementation words, for sharing the request's
 * subject words, and for being a how-it-works beat. At least one beat always converts; never more
 * than half, so the lecture still explains the idea as well as the listing. The opening beat of a
 * 3+ beat lecture is left alone.
 *
 * Returns the plan unchanged when nothing was asked, or when it already shows code.
 */
export function pickCodeBeats<T extends { sequence: number; title: string; objective: string; visualKind: string }>(
  plan: T[],
  requestText: string,
  requested: boolean,
): T[] {
  if (!requested || plan.length === 0 || plan.some((beat) => beat.visualKind === "code")) return plan;
  const n = plan.length;
  const words = [...new Set((requestText.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !REQUEST_STOPWORDS.has(w)))];
  // "deletion" should find "delete"/"deleting": compare on a shared stem, not the whole word.
  const stems = words.map((w) => w.slice(0, Math.max(5, w.length - 3)));
  const candidates = plan.filter((beat, index) => {
    if (index === 0 && n >= 3) return false;
    return !["equation", "plot"].includes(beat.visualKind);
  });
  if (candidates.length === 0) return plan;

  const scored = candidates.map((beat) => {
    const text = `${beat.title} ${beat.objective}`.toLowerCase();
    const score =
      (CODE_BEAT_PATTERN.test(text) ? 2 : 0) +
      stems.filter((stem) => text.includes(stem)).length +
      (/\b(?:how|works?|implement\w*|mechanism|steps?|cases?|algorithm|procedure)\b/.test(text) ? 1 : 0);
    return { beat, score };
  });
  const limit = Math.max(1, Math.floor(n / 2));
  let chosen = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.beat.sequence - b.beat.sequence).slice(0, limit);
  if (chosen.length === 0) chosen = [scored[Math.floor((scored.length - 1) / 2)]];
  const picked = new Set(chosen.map((s) => s.beat.sequence));
  return plan.map((beat) => (picked.has(beat.sequence) ? { ...beat, visualKind: "code" } : beat));
}

/**
 * Does this text contain program source? Used to decide that a beat built on a document excerpt
 * should show the code rather than a picture of it.
 *
 * Counts SYNTAX, not keywords: prose ABOUT code mentions "function" and "return" constantly, but
 * only source has `if (`, `->`, `name(args);`, `x == y` and braces. It cannot rely on line breaks:
 * PDF extraction collapses all whitespace (app/api/parse-pdf/route.ts), so a listing arrives as one
 * long line. Several hits across at least two KINDS of syntax is the bar — a stray semicolon or one
 * quoted `f(x)` in prose is not a listing.
 */
export function looksLikeCode(value: string | undefined | null): boolean {
  if (!value) return false;
  const count = (re: RegExp) => (value.match(re) ?? []).length;
  const kinds = [
    count(/\b(?:if|while|for|switch|elif)\s*\(/g),
    count(/\w\s*->\s*\w/g),
    count(/\b\w+\s*\([^()\n]{0,80}\)\s*[;{]/g),
    count(/[=!<>]=|&&|\|\||\+\+|--(?=\s*[;)\w])/g),
    count(/[{}]/g),
    count(/\b(?:return|break|continue)\b[^.;\n]{0,60};/g),
    count(/\b(?:def|class)\s+\w+\s*[(:]/g),
    count(/#include\s*[<"]|\bstd::|\bpublic\s+(?:static\s+)?\w+\s+\w+\s*\(/g),
    // Python has almost none of the C-family tells above, so it gets its own.
    count(/\bself\.\w+|\b(?:elif\b[^:\n]{0,80}|else\s*):|\bis\s+(?:not\s+)?None\b/g),
    count(/\b\w+(?:\.\w+)?\s*=\s*\w+(?:\.\w+)*\([^()\n]{0,80}\)/g),
  ];
  const total = kinds.reduce((sum, n) => sum + n, 0);
  const distinct = kinds.filter((n) => n > 0).length;
  return total >= 5 && distinct >= 2;
}
