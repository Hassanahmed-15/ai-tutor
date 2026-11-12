/**
 * ARIA'S PERSONALITY IN HOW SHE SPEAKS — NEVER IN WHAT SHE SAYS (owner, 2026-11-12: "luna writes the script,
 * I don't want to change anything I built; just the personality and the voice").
 *
 * The words are luna's, exactly. Each sentence only gets acting for the cloned voice (lib/geminiVoice.ts):
 * a couple of style words (pauses before a term were tried and sounded unnatural; ARIA_VOICE_PAUSES=on brings them back). The character is
 * the one in persona-lab/persona/aria-persona.md: warm, calm, on the student's side, medium energy —
 * curious when she asks, a beat of suspense before an answer, serious about a common mistake, specific
 * warmth when the student gets it.
 *
 * Measured on the cloned voice (persona-lab, 2026-11-12): a description of a person in the style made the
 * clone drift (voice match 7 → 4/10); one or two emotion words kept it at 7. "speaking slowly" on a line that
 * already pauses sounded choppy. Tags go to the voice only: the stored clip is still keyed by the text.
 *
 * Pure: no calls, no randomness — the same sentence is always acted the same way.
 */

export type Delivery = { input: string; style: string; kind: DeliveryKind };
export type DeliveryKind = "praise" | "reveal" | "question" | "task" | "warning" | "definition" | "story" | "plain";

/** Bumped whenever these rules change, so clips acted under old rules are made again (lib/narrationAudio.ts). */
export const DELIVERY_VERSION = "acted3";

/*
 * Round 1 (blind pairs, same cloned voice, luna's lines): "warm" on a story, "curious" on a question and
 * "warm, pleased" on praise beat plain delivery; a pause before a term or an answer sounded unnatural
 * (teacher score 7 → 5) and "serious" / "encouraging" sounded clipped.
 * Round 2 (each pair judged twice, order swapped): "curious" questions and "gentle" warnings won every time.
 * "friendly" made the voice ADD words of its own ("…oxygen delivery. Okay, so") — the only one of 38 clips
 * that changed luna's words — so tasks are spoken plainly. Only styles checked to add nothing are used.
 */
const STYLE: Record<DeliveryKind, string> = {
  praise: "warm, pleased",
  reveal: "warm",
  question: "curious",
  task: "",
  warning: "gentle",
  definition: "",
  story: "warm",
  plain: "",
};
const PAUSES = process.env.ARIA_VOICE_PAUSES === "on"; // off: round 1 found them unnatural

const PRAISE = /^(?:that's (?:right|it|correct)|correct|exactly|yes\b|nice\b|well done|great|good (?:job|work|thinking))/i;
const REVEAL = /^((?:so,?\s+)?the (?:answer|correct answer|missing value|result) is)\s+/i;
const TASK = /^(?:state|explain|describe|calculate|work out|suggest|compare|name|give|show|find|try|in your head|now try|have a go)\b/i;
const WARNING = /\b(?:common mistake|a lot of students|many students|careful|watch out|don't|do not|never|not the same|mistake)\b/i;
const STORY = /^(?:think of|imagine|picture|for example|for instance|suppose|say you|like a)\b/i;
// The term she is handing over: "is called X", ", called X", "known as X", "we call this X", "; this is X".
const DEFINE = /((?:,\s*|\b(?:is|are) )called|\bknown as|\bwe call (?:this|it|that)|[;:,]\s*(?:this|that) is)\s+(?=[A-Za-z])/i;

export function deliveryFor(text: string): Delivery {
  const t = text.trim();
  const reveal = t.match(REVEAL);
  if (PRAISE.test(t)) return { input: t, style: STYLE.praise, kind: "praise" };
  if (reveal) return { input: PAUSES ? t.replace(REVEAL, `${reveal[1]} <short pause> `) : t, style: STYLE.reveal, kind: "reveal" };
  if (/\?\s*$/.test(t)) return { input: t, style: STYLE.question, kind: "question" };
  if (TASK.test(t)) return { input: t, style: STYLE.task, kind: "task" };
  if (WARNING.test(t)) return { input: t, style: STYLE.warning, kind: "warning" };
  if (DEFINE.test(t)) return { input: PAUSES ? t.replace(DEFINE, (m) => `${m.trimEnd()} <short pause> `) : t, style: STYLE.definition, kind: "definition" };
  if (STORY.test(t)) return { input: t, style: STYLE.story, kind: "story" };
  return { input: t, style: STYLE.plain, kind: "plain" };
}

/** The words the student hears, tags aside — always exactly the sentence given. */
export function spokenWords(input: string): string {
  return input.replace(/\s*<[^>]+>\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}
