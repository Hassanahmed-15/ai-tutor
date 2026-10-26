/**
 * EQUATIONS ARE TYPESET, AND NEVER SQUEEZED INTO A BOX (owner, 2026-10-24, on an importance-sampling
 * board: "each eq should be derived from katex and the eq should not be in the box … readability is
 * zero"). The writer puts equations into notes and flow boxes as Unicode text — "ρ₀:t = ∏ π(a|s)/b(a|s)",
 * "V̂ = (1/N)ΣᵢΣₜ" cut off in a 90-px box. For typed-prompt lessons:
 *   - a note that is an equation carries its LaTeX (`tex`), and the board typesets it with KaTeX;
 *   - an equation written inside a flow box is taken out of the box and kept as a typeset note.
 * PDF, video and course boards are untouched (they never get `tex`).
 */
import type { CanvasBoardSpec, CanvasNote } from "./types";

const SUB: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")", "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₕ": "h", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ₛ": "s", "ₜ": "t", "ᵢ": "i", "ⱼ": "j", "ᵣ": "r", "ᵤ": "u", "ᵥ": "v" };
const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ᵃ": "a", "ᵇ": "b", "ᶜ": "c", "ᵈ": "d", "ᵉ": "e", "ᶠ": "f", "ᵍ": "g", "ʰ": "h", "ⁱ": "i", "ʲ": "j", "ᵏ": "k", "ˡ": "l", "ᵐ": "m", "ⁿ": "n", "ᵒ": "o", "ᵖ": "p", "ʳ": "r", "ˢ": "s", "ᵗ": "t", "ᵘ": "u", "ᵛ": "v", "ʷ": "w", "ˣ": "x", "ʸ": "y", "ᶻ": "z", "ᴬ": "A", "ᴮ": "B", "ᴰ": "D", "ᴱ": "E", "ᴳ": "G", "ᴴ": "H", "ᴵ": "I", "ᴶ": "J", "ᴷ": "K", "ᴸ": "L", "ᴹ": "M", "ᴺ": "N", "ᴼ": "O", "ᴾ": "P", "ᴿ": "R", "ᵀ": "T", "ᵁ": "U", "ⱽ": "V", "ᵂ": "W" };
const SYMBOL: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", ζ: "\\zeta", η: "\\eta", θ: "\\theta", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi", π: "\\pi", ρ: "\\rho", σ: "\\sigma", τ: "\\tau", φ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
  Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  Σ: "\\sum", "∑": "\\sum", "∏": "\\prod", Π: "\\prod", "∫": "\\int", "√": "\\sqrt", "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla",
  "×": "\\times", "÷": "\\div", "·": "\\cdot", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "→": "\\to", "←": "\\leftarrow", "⇒": "\\Rightarrow", "∈": "\\in", "±": "\\pm", "…": "\\ldots", "|": "\\mid ", "−": "-",
};
const MATH_CHAR = /[=∏∑Σ∫√≤≥≠≈±×÷₀-₉ₐ-ₜᵢⱼ⁰-⁹¹²³½¼¾ⁱⁿᵗᴺᵀα-ωΓΔΘΛΦΨΩ̂̄]/;
/** A maths symbol other than "=": "SYN = synchronise" has an equals sign and no maths (TCP lecture, 2026-10-24). */
const SYMBOL_CHAR = /[∏∑Σ∫√≤≥≠≈±×÷₀-₉ₐ-ₜᵢⱼ⁰-⁹¹²³½¼¾ⁱⁿᵗᴺᵀα-ωΓΔΘΛΦΨΩ̂̄]/;
/** Arithmetic between numbers or letters: "1000 + 1", "2x − 3", "a/b" — never the hyphen of "32-bit". */
const ARITHMETIC = /[\d)]\s*[-+*/^−]\s*[\d(]|[A-Za-z\d)]\s*[+*/^−]\s*[A-Za-z\d(]/;
const FUNCTION_NAME = /^(?:sin|cos|tan|sinh|cosh|tanh|log|exp|lim|max|min|argmax|argmin|mod)$/;

/**
 * Is this an equation, not a definition in words? Without a maths symbol, a lowercase word makes it words:
 * "SYN = synchronise", "ISN = 32-bit random number", "SYN-ACK = request + confirm" stay text.
 */
function isEquation(text: string): boolean {
  if (!/=|[∏∑Σ∫]/.test(text)) return false;
  if (SYMBOL_CHAR.test(text)) return true;
  if (!ARITHMETIC.test(text)) return false;
  return !(text.match(/\b[a-z]{4,}\b/g) ?? []).some((w) => !FUNCTION_NAME.test(w));
}

/** Unicode maths (as the writer types it) to LaTeX. */
export function unicodeToTex(math: string): string {
  let out = "";
  const chars = [...math.normalize("NFD")];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (SUB[c] !== undefined || SUP[c] !== undefined) {
      const map = SUB[c] !== undefined ? SUB : SUP;
      let run = "";
      while (i < chars.length && map[chars[i]] !== undefined) run += map[chars[i++]];
      i--;
      out += `${map === SUB ? "_" : "^"}{${run}}`;
      continue;
    }
    // A combining hat or bar belongs to the letter before it: V̂ → \hat{V}.
    if (chars[i + 1] === "̂" || chars[i + 1] === "̄") {
      out += `${chars[i + 1] === "̂" ? "\\hat" : "\\bar"}{${SYMBOL[c] ?? c}}`;
      i++;
      continue;
    }
    if (SYMBOL[c]) {
      out += `${SYMBOL[c]} `;
      continue;
    }
    out += c;
  }
  return out
    .replace(/\^\(([^()]*)\)/g, "^{($1)}") // rₜ₊₁^(i) → r_{t+1}^{(i)}
    // ρ₀:t and ρ₀:ₜ are one subscript, "0:t".
    .replace(/_\{([^}]*)\}:_\{([^}]*)\}/g, "_{$1:$2}")
    .replace(/_\{([^}]*)\}:([a-zA-Z]\w*)/g, "_{$1:$2}")
    .replace(/\s+/g, " ")
    .replace(/ ([_^])/g, "$1")
    // (1/N) and π(a|s)/b(a|s) are fractions, written as fractions.
    .replace(/\((\w+)\/(\w+)\)/g, "\\frac{$1}{$2}")
    .replace(/((?:\\[a-zA-Z]+ ?|[A-Za-z])\([^()]*\))\s*\/\s*((?:\\[a-zA-Z]+ ?|[A-Za-z])\([^()]*\))/g, "\\frac{$1}{$2}")
    .trim();
}

/** Is this note an equation (or "Label: equation")? Returns its LaTeX, or null for a note in words. */
export function noteTex(text: string, opts: { acronyms?: boolean } = {}): string | null {
  const t = text.trim();
  if (!t || !/=|[∏∑Σ∫]/.test(t) || !MATH_CHAR.test(t)) return null;
  // "Ordinary: V̂ₖ = (1/N)ΣρᵢGᵢ" — a label in words, then the equation.
  const m = /^([A-Za-z][A-Za-z ,'-]{1,30}):\s*(.+)$/.exec(t);
  const [label, math] = m && MATH_CHAR.test(m[2]) ? [m[1], m[2]] : [null, t];
  if (!isEquation(math)) return null;
  // Prose with a symbol in it ("Large ratios increase variance") is not an equation.
  const words = math.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
  if (words.length >= 3) return null;
  // A word in the maths is text — never a command's name (\gamma, \prod, \times).
  let body = unicodeToTex(math).replace(/(?<![\\A-Za-z])([A-Za-z]{4,})\b/g, "\\text{$1}");
  // A CS acronym is a name, not three variables multiplied: "ACK = 1000 + 1" sets ACK upright.
  if (opts.acronyms) body = body.replace(/(?<![\\A-Za-z{])([A-Z]{3})(?![A-Za-z}])/g, "\\text{$1}");
  return label ? `\\text{${label}: }${body}` : body;
}

/** The equation written inside a box's text ("ρ₀:t = π/b × …" in a box's detail), or null. */
function boxEquation(text: string | undefined): string | null {
  if (!text || !isEquation(text)) return null;
  return text.trim();
}

/**
 * Typesets a typed lesson's equation notes, and takes equations out of flow boxes (kept as typeset
 * notes when no note says them already). `valid` checks a LaTeX string renders (KaTeX on the server).
 * Returns how many notes were typeset and how many boxes were cleared.
 */
export function mathifyBoard(spec: CanvasBoardSpec, valid: (tex: string) => boolean, opts: { acronyms?: boolean } = {}): { typeset: number; cleared: number } {
  let cleared = 0;
  const st = spec.stage as { kind: string; nodes?: Array<{ id: string; label: string; sub?: string; s: number }> };
  if ((st.kind === "flow" || st.kind === "scene") && Array.isArray(st.nodes)) {
    for (const node of st.nodes) {
      const eq = boxEquation(node.sub) ?? boxEquation(node.label);
      if (!eq) continue;
      if (eq === node.sub?.trim()) delete node.sub;
      else node.label = node.label.split("=")[0].replace(/[^\w\s]+$/, "").trim() || node.label;
      cleared++;
      // The same quantity (its left-hand side) already in a note: nothing to add.
      const lhs = eq.split("=")[0].trim();
      if (!spec.notes.some((n) => n.text.includes("=") && n.text.split("=")[0].trim() === lhs)) {
        spec.notes.push({ id: `eq-${node.id}`, text: eq, s: node.s } as CanvasNote);
      }
    }
    spec.notes.sort((a, b) => a.s - b.s);
  }
  // A fragment of an equation in a box or on an arrow ("rₜ₊₁^(i), discounted", "γᵗρ₀:trₜ₊₁") is not
  // readable at that size: the box keeps its words, the maths goes (it is in the notes or the narration).
  const stripMaths = (text: string | undefined): string | undefined => {
    if (!text || ([...text].filter((c) => MATH_CHAR.test(c)).length < 3 && !/\^\(/.test(text))) return text;
    const words = text.split(/[\s,;]+/).filter((w) => w && !MATH_CHAR.test(w) && !/[\^_]/.test(w));
    cleared++;
    return words.length ? words.join(" ") : undefined;
  };
  const stage = spec.stage as { kind: string; nodes?: Array<{ label: string; sub?: string }>; arrows?: Array<{ label?: string }> };
  if (stage.kind === "flow" || stage.kind === "scene") {
    for (const node of stage.nodes ?? []) {
      const sub = stripMaths(node.sub);
      if (sub === undefined) delete node.sub;
      else node.sub = sub;
      node.label = stripMaths(node.label) ?? node.label;
    }
    for (const arrow of stage.arrows ?? []) {
      const label = stripMaths(arrow.label);
      if (label === undefined) delete arrow.label;
      else arrow.label = label;
    }
  }
  let typeset = 0;
  for (const note of spec.notes as Array<CanvasNote & { tex?: string }>) {
    const tex = noteTex(note.text, opts);
    if (tex && valid(tex)) {
      note.tex = tex;
      typeset++;
    }
  }
  return { typeset, cleared };
}
