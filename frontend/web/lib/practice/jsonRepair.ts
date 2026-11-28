/**
 * MATHS-SAFE JSON READING for the practice exam's model replies.
 *
 * The model writes LaTeX inside JSON strings and often forgets to double the backslash, so `"\frac{1}{4}"` reaches
 * JSON.parse as a form feed + "rac{1}{4}", `"\times"` as a tab + "imes", and so on. It also sometimes emits raw
 * control bytes in place of a command (seen 2026-11-26: \x03 before "frac", \x12 for ÷, \x13 for ×). Both are
 * repaired here so the paper and the marking show real maths, not red "frac{1}{4}" or a vanished ÷.
 */

// LaTeX commands whose first letter is a JSON escape (\b \f \n \r \t): a single backslash before them is a lost LaTeX
// backslash, not an intended escape. Only whole command names (word boundary after) are touched.
const ESCAPE_CLASH = /(?<!\\)((?:\\\\)*)\\(?=(?:frac|dfrac|tfrac|forall|times|text|textbf|textit|theta|tau|tan|therefore|triangle|to|beta|bar|binom|boxed|bmod|right|rightarrow|rho|rangle|neq|nabla|not|ni)(?![A-Za-z]))/g;

export function escapeLatexInJson(text: string): string {
  return text.replace(ESCAPE_CLASH, "$1\\\\");
}

// Raw control bytes the model has been seen to emit in place of maths symbols.
const SYMBOL_BYTES: Record<string, string> = { "\x12": "÷", "\x13": "×" };

export function repairControlChars(s: string): string {
  if (!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) return s;
  return s.replace(/([\x00-\x08\x0b\x0c\x0e-\x1f])([A-Za-z]*)/g, (_, c: string, word: string) => {
    if (SYMBOL_BYTES[c]) return SYMBOL_BYTES[c] + word;
    return word ? `\\${word}` : ""; // a byte standing in for the backslash of a command; a lone byte is dropped
  });
}

function walk<T>(x: T): T {
  if (typeof x === "string") return repairControlChars(x) as T;
  if (Array.isArray(x)) return x.map(walk) as T;
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)])) as T;
  return x;
}

/** JSON.parse for a model reply that may carry LaTeX: throws like JSON.parse when the text is not JSON at all. */
export function parseMathsJson<T>(text: string): T {
  return walk(JSON.parse(escapeLatexInJson(text)) as T);
}
