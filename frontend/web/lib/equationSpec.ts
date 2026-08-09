import katex from "katex";

/**
 * The `equation` spec: a derivation as ordered steps, each with the reason it is allowed.
 *
 * This is the form that had no engine at all. Formulas were rendering as literal glyphs —
 * "3² + 4² = c²" typed out as characters — inside boards whose real job was something else. A
 * derivation is not a diagram: it is read line by line, and each line earns its place from the one
 * above, so it deserves a renderer that says exactly that.
 *
 * Mirrors structureSpec.ts: validate, cap, never throw, and guarantee that anything which
 * validates is renderable. Here that guarantee has teeth — every `tex` is compiled by KaTeX at
 * validation time with `throwOnError: true`, so a step that would render as a red error string
 * never reaches the board.
 */

export type EquationStep = { tex: string; why?: string };
export type EquationSpec = { title?: string; steps: EquationStep[] };
export type RejectedStep = { tex: string; reason: string };

const MIN_STEPS = 2; // one line is a statement, not a derivation
const MAX_STEPS = 6; // beyond this the board stops being readable at a glance
/**
 * A hard REJECT limit, not a slice. Cutting TeX at a fixed length manufactures invalid input from
 * valid input — `\frac{a}{b}` truncated is `\frac{a}{` — and in the cases where a slice happens to
 * compile it shows a student half an equation, which is worse than showing none.
 */
const MAX_TEX_LEN = 240;

function text(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : undefined;
}

/** True only if KaTeX can actually typeset it. This is what makes "validated" mean "renderable". */
export function isRenderableTex(tex: string): boolean {
  return texError(tex) === null;
}

/** KaTeX's own complaint, or null if it compiled. The message is what makes a failure actionable. */
export function texError(tex: string): string | null {
  try {
    katex.renderToString(tex, { throwOnError: true, displayMode: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "KaTeX rejected this";
  }
}

/* ── Repair ───────────────────────────────────────────────────────────────── */

/**
 * LATEX DOES NOT SURVIVE JSON, and this is the single biggest reason the derivation board came back
 * empty.
 *
 * A model writes `"tex": "\frac{a}{b}"`. That is VALID JSON — `\f` is a legal escape — so nothing
 * throws: `JSON.parse` hands back U+000C followed by "rac{a}{b}", and KaTeX then reports
 * `Unexpected character: ''`. Every command beginning `\f \b \n \r \t` is exposed, which is
 * `\frac \text \times \theta \to \beta \binom \ne \nabla \rightarrow \bar` — most of real
 * derivation TeX. It is why a Pythagoras prompt (`a^2 + b^2 = c^2`, no such command) rendered
 * perfectly while anything with a fraction failed EVERY step at once.
 *
 * A literal control character has no meaning in TeX source, so turning one back into its
 * backslash form is a repair rather than a guess — but only when a letter follows it, which is the
 * signature of a command. A lone form feed between terms is just whitespace.
 */
function restoreControlChars(tex: string): string {
  const back: Record<string, string> = {
    "\f": "f",
    "\b": "b",
    "\r": "r",
    "\t": "t",
    "\n": "n",
  };
  return tex.replace(/[\f\b\r\t\n]([A-Za-z]?)/g, (_m, next: string) =>
    next ? `\\${back[_m[0]]}${next}` : " ",
  );
}

/** The delimiters the prompt forbids and the model writes anyway. KaTeX is handed the body. */
function stripDelimiters(tex: string): string {
  return tex
    .replace(/^\s*\\\[|\\\]\s*$/g, "")
    .replace(/^\s*\\\(|\\\)\s*$/g, "")
    .replace(/^\s*\$\$?|\$\$?\s*$/g, "")
    .trim();
}

/** Commands KaTeX has no equivalent for, and the bare `%` that silently eats the rest of the line. */
function dropUnsupported(tex: string): string {
  return tex
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(/\\nonumber/g, "")
    .replace(/\\mbox\b/g, "\\text")
    .replace(/(^|[^\\])%/g, "$1\\%")
    .trim();
}

/**
 * Repairs `tex` until KaTeX accepts it, or reports why it could not.
 *
 * Every rung is checked against KaTeX itself rather than trusted, so nothing here can "fix" a
 * string into something that still will not render — and the one genuinely ambiguous rewrite
 * (a newline that might be `\n`, might be whitespace) is settled by the compiler instead of by a
 * rule. Same discipline the plot engine uses with `vl.compile()`.
 */
export function repairTex(raw: string): { tex: string } | { error: string } {
  const first = texError(raw);
  if (first === null) return { tex: raw };

  /**
   * ORDER MATTERS, and getting it wrong is worse than not repairing at all.
   *
   * Control characters are restored FIRST, before anything that trims. A leading form feed is
   * whitespace to `String.trim()`, so stripping delimiters first turns `\frac{a}{b}` into
   * `rac{a}{b}` — which KaTeX happily compiles, because `rac` is three perfectly good variables.
   * That candidate then wins the ladder and the board silently shows the wrong equation. A repair
   * that produces plausible nonsense is worse than a visible failure.
   */
  const restored = restoreControlChars(raw);
  const candidates = [restored, stripDelimiters(restored), dropUnsupported(stripDelimiters(restored))];

  for (const candidate of candidates) {
    if (candidate && candidate !== raw && texError(candidate) === null) return { tex: candidate };
  }
  // Report the ORIGINAL complaint. The repaired variants' errors are artefacts of the repair and
  // would send anyone reading the log after the wrong bug.
  return { error: first };
}

/* ── Validation ───────────────────────────────────────────────────────────── */

/**
 * The full result: what survived, and what did not and why.
 *
 * The rejects matter as much as the steps. An engine reporting "fewer than two steps compiled"
 * gives whoever sees it nowhere to go — that exact message is how this bug stayed hidden — whereas
 * "KaTeX parse error: Undefined control sequence \foo" names the problem.
 */
export function parseEquationSpec(raw: unknown): { spec: EquationSpec | null; rejected: RejectedStep[] } {
  const rejected: RejectedStep[] = [];
  if (!raw || typeof raw !== "object") return { spec: null, rejected };
  const o = raw as Record<string, unknown>;

  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  const steps: EquationStep[] = [];
  for (const entry of rawSteps) {
    if (steps.length >= MAX_STEPS) break;
    if (!entry || typeof entry !== "object") continue;
    const s = entry as Record<string, unknown>;
    const candidate = typeof s.tex === "string" ? s.tex.trim() : "";
    if (!candidate) continue;

    if (candidate.length > MAX_TEX_LEN) {
      rejected.push({ tex: candidate.slice(0, 80), reason: `${candidate.length} characters — too long to read as one line` });
      continue;
    }

    const repaired = repairTex(candidate);
    if ("error" in repaired) {
      rejected.push({ tex: candidate.slice(0, 80), reason: repaired.error });
      continue;
    }
    steps.push({ tex: repaired.tex, why: text(s.why, 80) });
  }

  if (steps.length < MIN_STEPS) return { spec: null, rejected };
  return { spec: { title: text(o.title, 80), steps }, rejected };
}

/** The plain validator, unchanged in shape for every existing caller. */
export function validateEquationSpec(raw: unknown): EquationSpec | null {
  return parseEquationSpec(raw).spec;
}
