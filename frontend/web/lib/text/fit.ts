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
  // A phrase never ends on a small joining word ("…first-hand for a").
  for (let prev = ""; prev !== out; ) { prev = out; out = out.replace(/\s+(and|or|of|the|a|an|to|in|on|for|with|by|but|so|which|because|while|as|such)$/i, "").replace(/[\s,;:(–—+×=→&/-]+$/, ""); }
  return out;
}
