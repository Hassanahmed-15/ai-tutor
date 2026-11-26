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
export type DeliveryKind = "praise" | "reveal" | "question" | "task" | "warning" | "definition" | "story" | "hook" | "surprise" | "key" | "example" | "recap" | "plain";

/**
 * WHERE A SENTENCE SITS ON ITS BOARD, for its acting (owner, 2026-11-26: "the voice is plain, it does not show any
 * excitement, there is no pitch change"). Measured on three lectures: only 2–14% of sentences got any style, so
 * the clone read almost everything in its neutral voice. `index`/`count`: its place among the board's sentences;
 * `keyTerms`: the words the board shows in **bold**, stressed when she says them.
 */
export type BoardVoice = { index: number; count: number; keyTerms?: string[] };

/** Bumped whenever these rules change, so clips acted under old rules are made again (lib/narrationAudio.ts). */
export const DELIVERY_VERSION = "acted4";

/*
 * Round 1 (blind pairs, same cloned voice, luna's lines): "warm" on a story, "curious" on a question and
 * "warm, pleased" on praise beat plain delivery; a pause before a term or an answer sounded unnatural
 * (teacher score 7 → 5) and "serious" / "encouraging" sounded clipped.
 * Round 2 (each pair judged twice, order swapped): "curious" questions and "gentle" warnings won every time.
 * "friendly" made the voice ADD words of its own ("…oxygen delivery. Okay, so") — the only one of 38 clips
 * that changed luna's words — so tasks are spoken plainly. Only styles checked to add nothing are used.
 *
 * acted4 (2026-11-26): EVERY sentence is acted, and each board has an energy shape — a lift at its start, the
 * peak on its key idea, settling at its end. Still one or two words a line (a persona description made the clone
 * drift), and the key term she says is named for stress. The new words were checked for added words by
 * transcribing their clips (scripts in the session's scratchpad, qa/voice-check).
 */
const STYLE: Record<DeliveryKind, string> = {
  praise: "warm, pleased",
  reveal: "warm",
  question: "curious",
  task: "",
  warning: "gentle",
  definition: "emphatic",
  story: "playful",
  hook: "upbeat",
  surprise: "amazed",
  key: "emphatic",
  example: "playful",
  recap: "warm, satisfied",
  plain: "engaged",
};
/** The board's energy for an ordinary sentence: a lift at the start, settling at the end. */
const SHAPE = { start: "lively", middle: "engaged", end: "calm, warm" };
const PAUSES = process.env.ARIA_VOICE_PAUSES === "on"; // off: round 1 found them unnatural

const PRAISE = /^(?:that's (?:right|it|correct)|correct|exactly|yes\b|nice\b|well done|great|good (?:job|work|thinking))/i;
const REVEAL = /^((?:so,?\s+)?the (?:answer|correct answer|missing value|result) is)\s+/i;
const TASK = /^(?:state|explain|describe|calculate|work out|suggest|compare|name|give|show|find|try|in your head|now try|have a go)\b/i;
const WARNING = /\b(?:common mistake|a lot of students|many students|careful|watch out|don't|do not|never|not the same|mistake)\b/i;
const STORY = /^(?:think of|imagine|picture|for example|for instance|suppose|say you|like a)\b/i;
const EXAMPLE = /\b(?:for example|for instance|e\.g\.|let's say|let's try|let's take|take the|consider the)\b/i;
// The term she is handing over: "is called X", ", called X", "known as X", "we call this X", "; this is X".
const DEFINE = /((?:,\s*|\b(?:is|are) )called|\bknown as|\bwe call (?:this|it|that)|[;:,]\s*(?:this|that) is)\s+(?=[A-Za-z])/i;
const RECAP = /^(?:so,|so in short|in short|to sum up|in summary|to recap|overall|altogether|remember,|that's (?:how|why)|this is (?:how|why))/i;
const SURPRISE = /\b(?:surprisingly|amazingly|incredibly|remarkably|astonishingly|believe it or not|in fact|it turns out|only \d|just \d|(?:a |one )?(?:billion|million|trillion)|thousands of|\d+ times (?:faster|slower|more|less|bigger|smaller))\b/i;
const KEY = /\b(?:the key|key idea|the main idea|the important|most important|the crucial|the trick|the whole point|this means|that means|which means|this is why|that is why|the reason|the rule is|notice that|the big idea)\b/i;

/** The first bold key term of the board that this sentence says, for stress. */
function stressed(text: string, terms: string[] | undefined): string | null {
  const t = text.toLowerCase();
  for (const term of terms ?? []) {
    const k = term.toLowerCase().trim();
    if (k.length >= 3 && new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`).test(t)) return term.trim();
  }
  return null;
}

export function deliveryFor(text: string, at?: BoardVoice): Delivery {
  const t = text.trim();
  const placed = Boolean(at && at.index >= 0 && at.index < at.count);
  const first = placed && at!.index === 0;
  const last = placed && at!.count > 2 && at!.index === at!.count - 1;
  const term = stressed(t, at?.keyTerms);
  const stress = (style: string) => (term && style ? `${style}, stressing "${term}"` : style);
  const reveal = t.match(REVEAL);
  if (PRAISE.test(t)) return { input: t, style: STYLE.praise, kind: "praise" };
  if (reveal) return { input: PAUSES ? t.replace(REVEAL, `${reveal[1]} <short pause> `) : t, style: STYLE.reveal, kind: "reveal" };
  if (/\?\s*$/.test(t)) return { input: t, style: first ? "curious, upbeat" : STYLE.question, kind: "question" };
  if (TASK.test(t)) return { input: t, style: STYLE.task, kind: "task" };
  if (WARNING.test(t)) return { input: t, style: STYLE.warning, kind: "warning" };
  if (SURPRISE.test(t)) return { input: t, style: stress(STYLE.surprise), kind: "surprise" };
  if (DEFINE.test(t)) return { input: PAUSES ? t.replace(DEFINE, (m) => `${m.trimEnd()} <short pause> `) : t, style: stress(STYLE.definition), kind: "definition" };
  if (KEY.test(t)) return { input: t, style: stress(STYLE.key), kind: "key" };
  if (STORY.test(t) || EXAMPLE.test(t)) return { input: t, style: STYLE.example, kind: STORY.test(t) ? "story" : "example" };
  if (RECAP.test(t) || last) return { input: t, style: STYLE.recap, kind: "recap" };
  if (first) return { input: t, style: stress(STYLE.hook), kind: "hook" };
  // A sentence that says one of the board's key terms is its peak.
  if (term) return { input: t, style: stress(STYLE.key), kind: "key" };
  // The board's shape: livelier in its first third, settling in its last.
  const shape = !placed ? SHAPE.middle : at!.index < at!.count / 3 ? SHAPE.start : at!.index >= (at!.count * 2) / 3 ? SHAPE.end : SHAPE.middle;
  return { input: t, style: shape, kind: "plain" };
}

/** The words the student hears, tags aside — always exactly the sentence given. */
export function spokenWords(input: string): string {
  return input.replace(/\s*<[^>]+>\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** A board's peaks: more than this many "emphatic" lines and nothing stands out (history QA: 38 of 96). */
const PEAKS_PER_BOARD = 2;

/**
 * A WHOLE BOARD, ACTED (acted4): each sentence by deliveryFor at its place, then the board's peaks capped — the
 * first key idea and definition keep "emphatic"; later ones take the board's shape at their place and keep only the
 * stress on their term, so the peak stays a peak. Pure; same board, same acting.
 */
export function actBoard(sentences: string[], keyTerms: string[] = []): Delivery[] {
  let peaks = 0;
  return sentences.map((sentence, index) => {
    const at = { index, count: sentences.length, keyTerms };
    const d = deliveryFor(sentence, at);
    if (d.kind !== "key" && d.kind !== "definition") return d;
    if (peaks < PEAKS_PER_BOARD) {
      peaks++;
      return d;
    }
    const shape = index < sentences.length / 3 ? SHAPE.start : index >= (sentences.length * 2) / 3 ? SHAPE.end : SHAPE.middle;
    const term = d.style.match(/stressing "([^"]+)"/)?.[1];
    return { ...d, style: term ? `${shape}, stressing "${term}"` : shape, kind: d.kind === "key" ? "plain" : d.kind };
  });
}
