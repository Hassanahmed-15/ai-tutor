/**
 * EVERY PART OF A PLAN HAS ITS OWN TITLE (QA brief, 2026-11-28: one plan had two parts both called
 * "Opportunity Cost"). The planner is asked for distinct titles; code makes sure. A repeated title — or
 * one that is only the lesson's own topic while another part has it too — is renamed from what its part
 * teaches (its caption), else numbered. Pure; unit-tested in lib/anim/outlineTitles.test.ts.
 */

const norm = (t: string) => t.toLowerCase().replace(/&/g, "and").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const SMALL = new Set("a an the and or of to in on for with by as at from vs".split(" "));

/** A caption's leading idea as a short title: "Compare the costs of two choices…" → "Compare the Costs of Two Choices". */
function captionTitle(caption: string, max = 6): string {
  const first = caption.split(/[.;:!?—–]|,\s(?:and|so|then|which)\s/)[0] ?? "";
  const words = first.replace(/[()"“”]/g, "").split(/\s+/).filter(Boolean).slice(0, max);
  while (words.length && SMALL.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

export function uniquePartTitles<T extends { title: string; caption?: string }>(parts: T[]): T[] {
  const seen = new Map<string, number>();
  const taken = new Set(parts.map((p) => norm(p.title)));
  return parts.map((part) => {
    const key = norm(part.title);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (!key || count === 0) return part;
    // The repeat is renamed from its caption, unless that names another part too.
    const fromCaption = captionTitle(part.caption ?? "");
    const fresh = fromCaption && norm(fromCaption) !== key ? fromCaption : "";
    const tries = [fresh.split(" ").length >= 2 ? fresh : "", fresh ? `${part.title}: ${fresh}` : "", `${part.title} (part ${count + 1})`];
    for (const title of tries) {
      if (title && !taken.has(norm(title))) {
        taken.add(norm(title));
        return { ...part, title };
      }
    }
    const fallback = `${part.title} (${count + 1})`;
    taken.add(norm(fallback));
    return { ...part, title: fallback };
  });
}
