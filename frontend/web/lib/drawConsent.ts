/**
 * WHO DECIDED TO DRAW — the student, or nobody yet.
 *
 * A mid-lecture question used to produce a board every time: the explain prompt required one, the
 * sanitizer synthesised one when the model declined, and the animation pass that follows costs tens of
 * seconds with the lecture frozen behind it. A student who wanted one sentence waited for a diagram.
 *
 * So drawing now needs consent, and consent has exactly two sources: the student asked outright, or
 * they said yes when offered. These are the three questions that decide it, kept pure and tested
 * because the cost of getting them wrong is asymmetric — a missed offer wastes a sentence, while a
 * board nobody wanted stops the lesson.
 *
 * Deliberately narrow. `isDrawingRequest` in lib/geminiLiveContract.ts shows the other failure mode:
 * it matches "show" followed by any word at all, so "show me an example" and "show why that happens"
 * both force a diagram.
 */

/** "no diagram", "just tell me" — checked first, because a refusal names the thing it refuses. */
const REFUSES_VISUAL =
  /\b(?:no|without|skip|don'?t|do\s+not|rather\s+not|no\s+need\s+(?:to|for))\s+(?:a\s+|the\s+|any\s+)?(?:draw(?:ing)?|sketch|diagram|picture|image|visual|board|graph|chart|animation)\b|\bjust\s+(?:tell|say|explain|answer)\b|\b(?:words|text)\s+only\b|\bno\s+need\s+to\s+draw\b/i;

/**
 * An explicit request for something drawn.
 *
 * "show" only counts when it is pointed at a visual — "show me a diagram", "show it on the board" —
 * never on its own, which is the whole reason this is not the existing regex.
 */
const ASKS_FOR_VISUAL =
  /\b(?:draw|sketch|diagram|illustrate|visuali[sz]e|animate|plot|graph\s+(?:it|this|that|out)|map\s+(?:it\s+)?out)\b|\b(?:an?|the|some|any)\s+(?:diagram|sketch|drawing|picture|illustration|animation|visual|graph|chart)\b|\bon\s+the\s+board\b|\bshow\s+(?:me\s+)?(?:an?|the|it|this|that)?\s*(?:diagram|sketch|drawing|picture|visual|graph|chart)\b/i;

/**
 * Did the student ask to SEE something, rather than be told it?
 *
 * True here means draw immediately and never offer — they have already decided, and asking "shall I
 * draw?" after "draw me a diagram" is just a second question in the way.
 */
export function asksForVisual(text: string | undefined | null): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (REFUSES_VISUAL.test(t)) return false;
  return ASKS_FOR_VISUAL.test(t);
}

/*
 * ANSWERS TO THE OFFER.
 *
 * Anchored to the whole message, not searched within it. "yes" is an answer; "yes, but why does the
 * pressure drop?" is a new question that happens to start with a yes, and treating it as consent would
 * swallow the question and draw instead of answering it.
 *
 * The word lists are the ones already trusted elsewhere: the BACKCHANNEL set in
 * lib/voice/runtime/addressing.ts, and the `continue` command list in components/BlindLessonPlayer.tsx.
 */
const POLITENESS = "(?:please|thanks|thank\\s+you|aria)";
const AFFIRMATIVE_WORD = "(?:yes|yeah|yep|yup|ya|sure|ok|okay|alright|all\\s+right|fine|please|definitely|absolutely)";
const NEGATIVE_WORD = "(?:no|nope|nah|not?\\s+really|no\\s+thanks?|never\\s+mind|nevermind|not\\s+now|later|skip(?:\\s+it)?)";

const AFFIRMATIVE = new RegExp(
  `^${POLITENESS}?[,.!\\s]*(?:${AFFIRMATIVE_WORD}[,.!\\s]*)+(?:${POLITENESS}[,.!\\s]*)*(?:(?:do|draw|show)\\s*(?:it|that|this)?[,.!\\s]*)?(?:${POLITENESS}[,.!\\s]*)*$`,
  "i",
);
/** "go ahead", "do it", "draw it", "let's see it" — consent without a yes in it. */
const AFFIRMATIVE_PHRASE =
  /^(?:(?:yes|ok(?:ay)?|sure|alright)[,.!\s]+)?(?:go\s+ahead|go\s+for\s+it|do\s+it|draw\s+it|show\s+me|let'?s\s+see(?:\s+it)?|why\s+not)[,.!\s]*(?:please|thanks)?[.!\s]*$/i;

const NEGATIVE = new RegExp(
  `^${POLITENESS}?[,.!\\s]*(?:${NEGATIVE_WORD}[,.!\\s]*)+(?:${POLITENESS}[,.!\\s]*)*$`,
  "i",
);
/** "just tell me", "carry on", "keep going" — a decline expressed as what to do instead. */
const NEGATIVE_PHRASE =
  /^(?:(?:no|nope|nah)[,.!\s]+)?(?:just\s+(?:tell|say|explain|answer)(?:\s+me)?(?:\s+it)?|carry\s+on|keep\s+going|move\s+on|it'?s\s+(?:ok|okay|fine)|i'?m\s+(?:ok|okay|good|fine))[,.!\s]*$/i;

/** A short "yes" to the offer — never a sentence that merely opens with one. */
export function isAffirmative(text: string | undefined | null): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return AFFIRMATIVE.test(t) || AFFIRMATIVE_PHRASE.test(t);
}

/** A short "no" to the offer. */
export function isNegative(text: string | undefined | null): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return NEGATIVE.test(t) || NEGATIVE_PHRASE.test(t);
}
