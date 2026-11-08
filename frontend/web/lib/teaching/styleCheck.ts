/**
 * WORDS ARIA NEVER SAYS (lib/teaching/lessonTypes.ts TEACHING_RULES): "basically", "simply", "obviously",
 * "clearly", "just" (as in "just do X"), "as you know". They tell a student who is lost that it should be
 * easy. The planner is told; this takes out the ones that slip through, by code, only where the word is
 * filler — "label it clearly" and "it has just finished" keep their words. Pure, unit-tested.
 */

/** A banned use, and the words it is replaced by (usually nothing). */
type Replacement = string | ((match: string, ...groups: string[]) => string);
const FILLERS: Array<[RegExp, Replacement]> = [
  // Sentence openers: "Basically, …", "Obviously …", "As you know, …" — the next word takes the capital.
  [/(^|[.!?]\s+|\n)(?:basically|simply put|simply|obviously|clearly|as you (?:already )?know|as we all know)\s*,?\s+(\w)/gi, (_m, lead: string, c: string) => lead + c.toUpperCase()],
  // Mid-sentence fillers before a verb or adjective: "it is simply the…", "you basically add…", "we just add…".
  [/\b(is|are|was|were|it's|that's|this is|you|we|they|then)\s+(?:basically|simply|obviously|clearly)\s+/gi, "$1 "],
  // "just" as "only/merely" before an action: "just add", "just multiply", "just remember".
  [/\b(you|we|they|then|and|so|to)\s+just\s+(?=(add|subtract|multiply|divide|take|put|use|write|move|plug|swap|remember|follow|apply|do|count|read|look|draw|change|cancel|substitute|replace|find)\b)/gi, "$1 "],
  // "It's just a …" (dismissive).
  [/\b(it's|it is|that's|that is|this is)\s+just\s+(a|an|the)\b/gi, "$1 $2"],
  // A clause "…, as you know," inside a sentence.
  [/,\s*as you (?:already )?know\s*,/gi, ","],
];

/** Every banned use left in a text (for logs and checks). */
export function bannedWordsIn(text: string): string[] {
  const found: string[] = [];
  for (const [pattern] of FILLERS) for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags))) found.push(m[0].trim());
  return found;
}

/** The text without its banned fillers; a sentence that lost its opener still starts with a capital. */
export function withoutBannedWords(text: string): string {
  let out = text;
  for (const [pattern, to] of FILLERS) out = out.replace(pattern, to as never);
  return out.replace(/ {2,}/g, " ");
}
