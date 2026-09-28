/**
 * DID THE STUDENT ASK TO PAUSE, OR TO CARRY ON?
 *
 * The lecture used to recognise only the bare commands — "pause", "Aria stop" — anchored end to end.
 * "Aria, can you pause the lecture?" was classified as a QUESTION: the lecture froze for the answer,
 * Aria said "Sure, paused", and the question's automatic resume started the lecture again. That was
 * the reported "sometimes it pauses, sometimes it doesn't". People ask for a pause in a sentence.
 *
 * So both are judged on a short utterance (a request, not a discussion) that contains the request,
 * allowing the polite and the addressed forms, and refusing a question ABOUT pausing ("why did it
 * stop?", "what does stop-and-wait mean?") — which is a question to answer, not a command.
 */

const WAKE = /^(?:(?:hey|hi|ok(?:ay)?|so|um+|uh+|excuse\s+me)[,.!\s]+)*(?:aria|arya|area|maria|mariah|ariana|rhea|riya|teacher)?[,.!\s]*/i;

function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** A question about the thing, rather than a request to do it. */
const ABOUT = /\b(?:why|how\s+(?:does|do|did|is|come)|what\s+(?:does|do|is|happens|happened)|mean(?:s|ing)?|explain|difference)\b/;
/** The polite forms of a request, which ARE commands despite the question shape. */
const POLITE = /\b(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+)?|\b(?:please|let'?s|let\s+us|i\s+(?:need|want)\s+(?:you\s+)?to|i'?d\s+like\s+(?:you\s+)?to)\b/;

const PAUSE_WORDS = /\b(?:pause|stop|wait|hold\s+(?:on|it|up)|hang\s+on|freeze|one\s+(?:sec|second|moment|minute)|give\s+me\s+a\s+(?:sec|second|moment|minute)|just\s+a\s+(?:sec|second|moment|minute)|not\s+so\s+fast|time\s+out)\b/;
const RESUME_WORDS = /\b(?:continue|resume|unpause|keep\s+going|carry\s+on|go\s+on|go\s+ahead|move\s+on|start\s+again|play|let'?s\s+go|next(?:\s+(?:part|section|slide))?|proceed)\b/;

function isRequest(text: string, words: RegExp): boolean {
  const body = normalise(text).replace(WAKE, "").replace(/[?.!,]+$/g, "").trim();
  if (!body || !words.test(body)) return false;
  // A request is short. A long sentence that happens to contain "wait" is the student talking.
  if (wordCount(body) > 12) return false;
  // "Why did it stop?" asks about the thing; "can you stop?" asks for it.
  if (ABOUT.test(body) && !POLITE.test(body)) return false;
  // "Don't stop" / "no need to pause" asks for the opposite.
  if (/\b(?:don'?t|do\s+not|never|no\s+need\s+to)\s+(?:\w+\s+)?(?:pause|stop|wait)\b/.test(body)) return false;
  return true;
}

export function isPauseIntent(text: string): boolean {
  return isRequest(text, PAUSE_WORDS) && !isRequest(text, /\b(?:don'?t|do\s+not)\s+(?:pause|stop)\b/);
}

export function isResumeIntent(text: string): boolean {
  // "Stop, and continue later" is a pause; a sentence asking for both reads as the pause.
  if (isPauseIntent(text) && !/\b(?:don'?t|do\s+not|no\s+need\s+to)\s+(?:pause|stop|wait)\b/.test(normalise(text))) return false;
  return isRequest(text, RESUME_WORDS) || /\b(?:don'?t|do\s+not|no\s+need\s+to)\s+(?:pause|stop|wait)\b/.test(normalise(text));
}
