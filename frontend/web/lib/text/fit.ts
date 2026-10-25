/**
 * Text that does not fit is never shown half-cut (owner, 2026-10-17). The board writer's text is
 * first rewritten to fit by the shorten pass; what still does not fit is ended at a natural break —
 * a dash, a semicolon, a comma, "and", "because" — as a complete phrase, without "…".
 */
export function trimToFit(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const breaks = [" — ", " – ", "; ", ": ", ", ", " because ", " which ", " so ", " and ", " or ", " but ", " with ", " while "];
  let at = -1;
  for (const b of breaks) {
    const i = head.lastIndexOf(b);
    if (i >= max * 0.45 && i > at) at = i;
  }
  if (at < 0) at = head.lastIndexOf(" ");
  let out = (at > 0 ? head.slice(0, at) : head).replace(/[\s,;:(–—+×=→&/-]+$/, "");
  // A phrase never ends on a small joining word ("…first-hand for a") or a verb still waiting for its rest
  // ("Molecular formula can be" — the cut of "…can be a multiple", course bench 2026-10-24).
  for (let prev = ""; prev !== out; ) { prev = out; out = out.replace(/\s+(and|or|of|the|a|an|to|in|on|for|with|by|but|so|which|that|because|while|as|such|than|from|into|onto|at|its|their|this|these|is|are|was|were|be|been|being|can|could|may|might|must|should|will|would|has|have|had|does|do|not|no|very|more|less|most)$/i, "").replace(/[\s,;:(–—+×=→&/-]+$/, ""); }
  return out;
}

/** A phrase that stops where its sentence is still going ("Molecular formula can be"). */
export function unfinishedNote(text: string): boolean {
  return /\s(and|or|of|the|a|an|to|in|on|for|with|by|but|so|which|that|because|while|as|than|from|into|at|is|are|was|were|be|been|can|could|may|might|must|should|will|would|has|have|had|does|do|not)$/i.test(text.trim());
}

/**
 * FIX 3 — NO NOTE CUT OFF MID-SENTENCE (owner, 2026-10-24): "Molecular formula may be a multiple" was one
 * character over the notes column's two lines and shipped as "Molecular formula can be". A note is
 * shortened only to a complete phrase; failing that it is written whole when it fits three lines
 * (`whole`), and cut at a natural break — never on a word that needs its rest — only when longer still.
 */
export function fittedNote(text: string, shortened: string | undefined, max = 34, whole = 48): string {
  if (shortened && shortened.length <= max && !unfinishedNote(shortened)) return shortened;
  if (text.length <= whole) return text;
  return trimToFit(text, whole);
}

const SUPER: Record<string, string> = { "-": "⁻", "−": "⁻", "+": "⁺", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/**
 * A unit's or a letter's power written as a student reads it in print: "m s^-1" → "m s⁻¹", "x^2" →
 * "x²", "6.0 × 10^24" → "6.0 × 10²⁴". One board showed "m s^-1" in its notes beside "m s⁻¹" in its
 * boxes (audit 2026-10-17). Other number powers ("3^4") are left as written; the number checks read
 * superscripts either way (lib/canvas/numberCheck.ts).
 */
export function prettyPowers(text: string): string {
  return text.replace(/\b10\^\(?([-−+]?\d{1,3})\)?(?!\d|\.\d)/g, (_, power: string) => "10" + [...power].map((c) => SUPER[c] ?? c).join("")).replace(/([A-Za-z)])\^\(?([-−+]?\d{1,2})\)?(?!\d|\.\d)/g, (_, base: string, power: string) => base + [...power].map((c) => SUPER[c] ?? c).join(""));
}
