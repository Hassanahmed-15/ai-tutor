/**
 * IS THIS SENTENCE FOR ARIA? — the semantic layer. Ported from production (lib/voice/addressing.ts).
 *
 * The default is "not for us" while the tutor is talking: interrupting mid-sentence is the
 * expensive mistake, so an utterance needs positive evidence — her name, a lesson command, a
 * question about the board, second-person speech to a teacher, or topic words. The default flips
 * to "for us" only when the tutor asked something and is waiting. Pure and explainable: every
 * verdict names the rule that decided it.
 */

export interface AddressingContext {
  expectingAnswer: boolean;
  tutorSpeaking: boolean;
  topicWords?: Iterable<string>;
  wakeNames?: string[];
}

export interface AddressingVerdict {
  addressed: boolean;
  score: number;
  reason: string;
}

const DEFAULT_WAKE_NAMES = ["aria", "arya", "teacher"];

const BACKCHANNEL = new Set([
  "mm", "mmm", "mhm", "mm-hm", "mmhm", "uh", "uh-huh", "uhhuh", "um", "hmm", "huh", "ah", "oh",
  "ok", "okay", "yeah", "yep", "yes", "no", "nope", "right", "sure", "cool", "nice", "wow", "hm",
  "eh", "haha", "lol", "gotcha", "alright", "fine", "true", "exactly", "totally", "makes", "sense",
  "i", "see", "got", "it",
]);

const LESSON_COMMAND =
  /^(?:(?:aria|arya|teacher|please|hey|ok|okay)[,\s]+)*(?:pause|stop|wait|hold on|hang on|continue|resume|keep going|go on|carry on|repeat|say (?:that )?again|again|next|go back|back up|skip|slower|slow down|faster|speed up|louder|quieter|one more time|start over|never mind|nevermind)(?:[,\s]+(?:please|aria|arya|teacher|the lecture|that))*[.!?\s]*$/i;

const TUTOR_VERB =
  /\b(?:can|could|would|will|please)\s+you\s+(?:explain|repeat|show|draw|tell|go|slow|speed|skip|say|clarify|elaborate|teach|walk|give|define|summari[sz]e|break)\b|\b(?:what|why|how|when|where|which|who)\s+(?:do|does|did|are|is|was|were|should|would|could)\s+(?:you\s+|that\s+|this\s+|it\s+)?(?:mean|say|saying|said|meant|call|get|come|know)\b|\byou\s+(?:said|mean|meant|mentioned|skipped|lost me|went too fast)\b|\b(?:explain|clarify|elaborate|define|summari[sz]e)\s+(?:that|this|it|again|the)\b|\bi (?:don'?t|do not|didn'?t) (?:get|follow|understand)\b|\b(?:go|jump|scroll) back\b|\bshow me\b|\bteach me\b|\btell me\b/i;

const QUESTION_OPENER =
  /^(?:(?:aria|arya|teacher|so|ok|okay|wait|um|but|and)[,\s]+)*(?:what|why|how|when|where|which|who|whose|is|are|was|were|does|do|did|can|could|would|should|will|am|isn'?t|aren'?t|doesn'?t|don'?t)\b/i;

const DEICTIC =
  /\b(?:that|this|the (?:last|first|second|third|previous|next|other)|which)\s+(?:step|part|bit|one|line|slide|board|thing|sign|formula|equation|word|term|number|diagram|graph|section|example|point|rule|case)\b|\b(?:that|this) (?:again|one more time)\b|\b(?:is|was|does|did|do|are|isn'?t|wasn'?t)\s+(?:it|that|this|these|those)\b|\bthe (?:sign|denominator|numerator|exponent|axis|curve|slope)\b/i;

const SIDE_CONVERSATION =
  /\b(?:call you back|talk (?:to you )?later|be right back|brb|one sec(?:ond)?|just a sec(?:ond)?|dinner(?:'s| is)? ready|food(?:'s| is)? ready|pass (?:me|the)|hand me|did you (?:remember|feed|lock|call|text|see the|watch the|eat|take)|where (?:did you|are my|are the) (?:put|keys|shoes|charger|phone|glasses)|remember to (?:send|buy|pick|call|text)|pick (?:up|me up)|i'?m (?:coming|on the phone|busy right now)|hold on (?:i'?m|i am) (?:on|in)|what do you want (?:for|to eat)|are you (?:coming|hungry|home|ready to go)|let'?s (?:go|eat|leave)|turn (?:that|the tv|the music) (?:off|down)|shut up|love you|see you (?:later|tomorrow)|good ?night|good ?morning everyone|what time is it|what'?s the time|what day is it|is it (?:raining|cold|hot) (?:out|outside))\b/i;

const HAIL_OPENER = /^(?:hey|hi|yo|oi|hello)[,\s]+([a-z']+)/i;
const HAIL_NOT_A_NAME = new Set([
  "can", "could", "would", "will", "you", "so", "um", "uh", "wait", "what", "why", "how", "when",
  "where", "please", "there", "that", "this", "is", "are", "do", "does", "did", "i", "let", "hold",
  "stop", "pause", "go", "no", "yes", "okay", "ok", "listen", "look", "actually", "sorry", "hey",
]);
const NAME_THIRD_PERSON = /\b(?:aria|arya|teacher|the tutor|this (?:thing|app|ai))\s+(?:said|says|told|keeps|kept|was saying|is saying|sounds|thinks|just|won'?t|can'?t|doesn'?t|isn'?t)\b/i;

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "have", "what", "when", "where", "which", "there",
  "their", "about", "would", "could", "should", "into", "then", "than", "them", "they", "your",
  "just", "like", "also", "very", "really", "some", "more", "most", "such", "only", "over", "here",
  "does", "did", "was", "were", "been", "being", "will", "you", "for", "are", "not", "but", "all",
  "can", "how", "why", "who", "one", "two", "its", "it's", "out", "get", "got", "put", "say",
]);

export function topicWordsFrom(...texts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
      const word = raw.replace(/^'+|'+$/g, "");
      if (word.length >= 4 && !STOPWORDS.has(word)) out.add(word);
    }
  }
  return out;
}

function normalise(raw: string): { text: string; words: string[] } {
  const text = raw.trim().toLowerCase().replace(/[“”"()]/g, "").replace(/\s[—–-]+\s/g, " ").replace(/[.,!?;:]+$/g, "").replace(/\s+/g, " ");
  return { text, words: text.split(" ").filter(Boolean) };
}

/** Does the transcript look unfinished — a trailing connective or filler that promises more? */
export function looksUnfinished(raw: string): boolean {
  const { words } = normalise(raw);
  const last = words[words.length - 1] ?? "";
  return /^(?:and|but|so|because|or|um|uh|like|the|a|an|to|of|if|when|that|which|is|i|it's|its)$/.test(last) || /[,\-—]$/.test(raw.trim());
}

export function classifyAddressing(raw: string, context: AddressingContext): AddressingVerdict {
  const { text, words } = normalise(raw);
  if (!text) return { addressed: false, score: 0, reason: "empty" };
  const wakeNames = context.wakeNames?.length ? context.wakeNames.map((n) => n.toLowerCase()) : DEFAULT_WAKE_NAMES;
  const wakePattern = new RegExp(`\\b(?:${wakeNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

  if (LESSON_COMMAND.test(text)) return { addressed: true, score: 1, reason: "lesson command" };
  if (NAME_THIRD_PERSON.test(text) && !/\byou\b/.test(text)) return { addressed: false, score: 0, reason: "talking about the tutor, not to her" };
  if (wakePattern.test(text)) return { addressed: true, score: 1, reason: "addressed by name" };
  const hail = text.match(HAIL_OPENER);
  if (hail && !HAIL_NOT_A_NAME.has(hail[1]) && !wakeNames.includes(hail[1])) return { addressed: false, score: 0, reason: `hailing someone else ("${hail[1]}")` };
  if (SIDE_CONVERSATION.test(text)) return { addressed: false, score: 0, reason: "side conversation" };
  const backchannelOnly = words.length <= 3 && words.every((w) => BACKCHANNEL.has(w.replace(/[^a-z'-]/g, "")));
  if (backchannelOnly) {
    return context.expectingAnswer && !context.tutorSpeaking
      ? { addressed: true, score: 0.8, reason: "short answer to a pending question" }
      : { addressed: false, score: 0, reason: "backchannel" };
  }

  let score = 0;
  const why: string[] = [];
  if (context.expectingAnswer && !context.tutorSpeaking) { score += 0.5; why.push("answering"); }
  if (TUTOR_VERB.test(text)) { score += 0.75; why.push("second person to the tutor"); }
  if (QUESTION_OPENER.test(text) || raw.includes("?")) { score += 0.35; why.push("question"); }
  if (DEICTIC.test(text)) { score += 0.45; why.push("points at the board"); }
  const topic = context.topicWords ? new Set([...context.topicWords].map((w) => w.toLowerCase())) : null;
  if (topic && topic.size) {
    const hits = new Set(words.filter((w) => w.length >= 4 && topic.has(w))).size;
    if (hits > 0) { score += Math.min(0.6, 0.2 * hits); why.push(`${hits} topic word${hits > 1 ? "s" : ""}`); }
  }
  if (context.tutorSpeaking) { score -= 0.25; why.push("tutor speaking"); }
  else if (!context.expectingAnswer) { score += 0.15; why.push("tutor idle"); }
  return { addressed: score >= 0.5, score: Math.max(0, Math.min(1, score)), reason: why.length ? why.join(" + ") : "no evidence either way" };
}
