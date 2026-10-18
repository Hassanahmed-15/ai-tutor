/**
 * FORMULAS THAT CAME OUT OF THE PDF AS JUMBLE. Equation-editor formulas (MathType, Office equations)
 * extract as scattered glyphs. The Erlang C slide's
 *   C(A,N) = N·B(A,N) / (N − A[1 − B(A,N)])
 * reached the lecture as small blocks — "NB(A,N)", "C(A,N) =" — with the denominator nowhere in the
 * text, and its neighbour as "( AN %( N %", "& & # # &' | #$", "N! N − A", "C(A,N) = ' $". Aria taught
 * "C(A,N) = N·B(A,N)" (PDF bench, 2026-10-18). A page like that is found here; its formulas are read
 * from the page image (app/api/parse-pdf) and put in place of the fragments, or — when none could be
 * read — a marker sends the reader to the page, so no formula is ever rebuilt from the jumble.
 */

type Block = { id: string; type?: string; heading?: string; text?: string; items?: string[]; pageNumber?: number; sourceOrder?: number; bbox?: unknown; role?: string };

/** Symbol-font junk: the glyph codes of an equation's brackets, sums and fraction bars ("#$", "&'", "%(", "!\""). */
const JUNK = /[#$%&'!"]{1}\s*[#$%&'!"(]|[#$%&'][)(]|[)(][#$%&']/;
const junkCount = (t: string) => (t.match(/[#$%&'!"]/g) ?? []).length;
const words = (t: string) => (t.match(/[A-Za-z]{4,}/g) ?? []).length;

/** A formula with nothing after its "=", or with brackets that do not close. */
function incompleteFormula(t: string): boolean {
  const s = t.trim();
  if (/[=+−\-×÷(,[]\s*$/.test(s) || /=\s*['$#%&!"]+\s*$/.test(s)) return true;
  const open = (s.match(/[([{]/g) ?? []).length, close = (s.match(/[)\]}]/g) ?? []).length;
  return Math.abs(open - close) >= 2;
}

/** Lone letters and brackets in drawing order: "[ ] ) , ( 1 ) , ( N A B A N N A NB N A C − − =". */
function letterJumble(t: string): boolean {
  const tokens = t.split(/\s+/).filter(Boolean);
  const lone = tokens.filter((x) => /^[A-Za-z]$/.test(x)).length;
  return tokens.length >= 8 && lone >= 4 && /[=∑−+]|\)\s*,\s*\(/.test(t) && tokens.filter((x) => x.length <= 2).length / tokens.length >= 0.75;
}

const textOf = (b: Block) => [b.text ?? "", ...(b.items ?? [])].join(" ");

/** Does this page carry a formula that did not survive text extraction? */
export function pageHasGarbledFormulas(blocks: Block[]): boolean {
  return blocks.some((b) => {
    const t = textOf(b);
    return (junkCount(t) >= 3 && JUNK.test(t) && words(t) <= 2)
      // A "formula" block that reads like a sentence ("…lines 28 and 34 uses >=") is prose, not a cut formula.
      || (b.type === "formula" && incompleteFormula(t) && words(t) <= 3)
      || letterJumble(t)
      || junkCount(b.heading ?? "") >= 3;
  });
}

/**
 * A block that is only a piece of a formula: an extracted formula, symbol junk, or a short run of
 * maths with no sentence in it ("N! N − A", "NB(A,N)", "k = 0 | ' $"). Prose that introduces a
 * formula ("by the Erlang C formula:") is not one.
 */
export function isFormulaFragment(b: Block): boolean {
  const t = textOf(b).trim();
  if (!t) return false;
  if (b.type === "formula" && words(t) <= 3) return true;
  if (junkCount(t) >= 2 && words(t) <= 1) return true;
  if (letterJumble(t)) return true;
  if (t.length <= 40 && words(t) === 0 && /[=∑!+−×÷/()]/.test(t)) return true;
  return false;
}

/** The transcription request for one page image (the vision model answers in JSON). */
export const FORMULA_TRANSCRIPTION_PROMPT = `You transcribe the mathematical formulas printed on one page of a student's lecture slides or notes. List every DISPLAYED formula or equation on the page — the ones set on their own line — in reading order (top to bottom, left to right), each exactly as printed, in LaTeX: every term, every fraction with its numerator and denominator, sums with their limits, brackets as printed. Skip a variable name or a short symbol that only appears inside a sentence. Do not solve, simplify or add anything. Return JSON only: {"formulas": ["<LaTeX>", ...]} — an empty list when the page has no displayed formula.`;

/**
 * The page's blocks with its formula fragments taken out and its transcribed formulas put where the
 * first fragment was, each as a "formula" block. With no transcription, one marker block takes their
 * place. Prose blocks, and junk headings (a heading made of symbol glyphs), are kept or repaired.
 */
export function rebuildFormulaBlocks<B extends Block>(blocks: B[], formulas: string[], page: number): B[] {
  const first = blocks.findIndex(isFormulaFragment);
  if (first < 0) return blocks;
  const template = blocks[first];
  // A heading that is itself symbol junk ("∑ +&& ##&' #$") takes the heading of the block before it.
  let lastGood = "";
  const kept = blocks.map((b) => {
    if (b.heading && junkCount(b.heading) >= 3) return { ...b, heading: lastGood || `Page ${page}` };
    if (b.heading) lastGood = b.heading;
    return b;
  });
  const out: B[] = [];
  kept.forEach((b, i) => {
    if (i === first) {
      const made = formulas.length
        ? formulas.map((latex, k) => ({ ...template, id: `${template.id}-formula-${k + 1}`, type: "formula", text: latex, items: undefined }))
        : [{ ...template, id: `${template.id}-formula`, type: "formula", text: `[formula on page ${page} — not readable as text; see the page]`, items: undefined }];
      out.push(...(made as B[]));
    }
    if (!isFormulaFragment(blocks[i])) out.push(b);
  });
  return out;
}
