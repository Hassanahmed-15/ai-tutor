/**
 * IS THIS SENTENCE FOR ARIA? — the semantic layer of the voice gate.
 *
 * Replaces `isAddressedToTeacher`, whose final rule was "anything of three or more words is
 * addressed". That single line was the largest source of false interruptions in the product: a
 * bystander's "did you remember to send that email" is three-plus words, so it stopped the lecture
 * every time, and the test matrix never noticed because it handed the verdict in by hand instead of
 * calling the function.
 *
 * THE DEFAULT IS NOW "NOT FOR US" WHILE ARIA IS TALKING. Interrupting a teacher mid-sentence is the
 * expensive mistake — it derails the lesson and the student has to ask her to continue — so while
 * she is speaking, an utterance needs positive evidence: her name, a lesson command, a question
 * about what is on the board, or words that belong to the topic. A sentence about dinner has none.
 *
 * The default flips to "for us" only when Aria has asked something and is waiting: then a plain
 * answer with no markers is exactly what we expect, and demanding her name before every reply
 * would make the planning conversation unbearable. Who is answering is the acoustic layer's job
 * (see speakerProfile.ts); this file only judges the words.
 *
 * Pure, synchronous, no I/O — so it can be tested against sentences and reasoned about. Every
 * verdict carries the rule that decided it, because a gate that stops a lecture must be able to
 * say why.
 */

export interface AddressingContext {
  /** Aria just asked something and is waiting. A bare answer counts. */
  expectingAnswer: boolean;
  /** Aria is speaking right now (narration or a reply). Raises the bar. */
  tutorSpeaking: boolean;
  /**
   * Words that belong to the current material: the beat title and points, and the last thing Aria
   * said. Overlap is the strongest sign a sentence is about the lesson rather than the room.
   */
  topicWords?: Iterable<string>;
  /** What the tutor answers to. Both spellings, because the product is spoken and spelt both ways. */
  wakeNames?: string[];
}

export interface AddressingVerdict {
  addressed: boolean;
  /** 0..1-ish evidence score; `addressed` is `score >= 0.5` unless a hard rule decided it. */
  score: number;
  /** The rule that settled it, for the decision log and the report. */
  reason: string;
}

const DEFAULT_WAKE_NAMES = ["aria", "arya", "teacher"];

/** Acknowledgements that are never a request — unless Aria asked a yes/no question. */
const BACKCHANNEL = new Set([
  "mm", "mmm", "mhm", "mm-hm", "mmhm", "uh", "uh-huh", "uhhuh", "um", "hmm", "huh", "ah", "oh",
  "ok", "okay", "yeah", "yep", "yes", "no", "nope", "right", "sure", "cool", "nice", "wow", "hm",
  "eh", "haha", "lol", "gotcha", "alright", "fine", "true", "exactly", "totally", "makes", "sense",
  "i", "see", "got", "it",
]);

/**
 * Short instructions to the tutor. Matched whole, at most a few words, so "stop" is a command and
 * "stop it, Sam" is not.
 */
const LESSON_COMMAND =
  /^(?:(?:aria|arya|teacher|please|hey|ok|okay)[,\s]+)*(?:pause|stop|wait|hold on|hang on|continue|resume|keep going|go on|carry on|repeat|say (?:that )?again|again|next|go back|back up|skip|slower|slow down|faster|speed up|louder|quieter|one more time|start over|never mind|nevermind)(?:[,\s]+(?:please|aria|arya|teacher|the lecture|that))*[.!?\s]*$/i;

/**
 * Verbs and phrases you say TO a teacher, not about the weather. "you" alone is not enough — "did
 * you remember to send that email" has a "you" in it — so these are the second-person forms that
 * only make sense aimed at whoever is teaching.
 */
const TUTOR_VERB =
  /\b(?:can|could|would|will|please)\s+you\s+(?:explain|repeat|show|draw|tell|go|slow|speed|skip|say|clarify|elaborate|teach|walk|give|define|summari[sz]e|break)\b|\b(?:what|why|how|when|where|which|who)\s+(?:do|does|did|are|is|was|were|should|would|could)\s+(?:you\s+|that\s+|this\s+|it\s+)?(?:mean|say|saying|said|meant|call|get|come|know)\b|\byou\s+(?:said|mean|meant|mentioned|skipped|lost me|went too fast)\b|\b(?:explain|clarify|elaborate|define|summari[sz]e)\s+(?:that|this|it|again|the)\b|\bi (?:don'?t|do not|didn'?t) (?:get|follow|understand)\b|\b(?:go|jump|scroll) back\b|\bshow me\b|\bteach me\b|\btell me\b/i;

/** A question asked out loud. The transcriber does not always punctuate, so the openers count. */
const QUESTION_OPENER =
  /^(?:(?:aria|arya|teacher|so|ok|okay|wait|um|but|and)[,\s]+)*(?:what|why|how|when|where|which|who|whose|is|are|was|were|does|do|did|can|could|would|should|will|am|isn'?t|aren'?t|doesn'?t|don'?t)\b/i;

/** Pointing at what is on the board: "that step", "the last part", "this bit again". */
const DEICTIC =
  /\b(?:that|this|the (?:last|first|second|third|previous|next|other)|which)\s+(?:step|part|bit|one|line|slide|board|thing|sign|formula|equation|word|term|number|diagram|graph|section|example|point|rule|case)\b|\b(?:that|this) (?:again|one more time)\b|\b(?:is|was|does|did|do|are|isn'?t|wasn'?t)\s+(?:it|that|this|these|those)\b|\bthe (?:sign|denominator|numerator|exponent|axis|curve|slope)\b/i;

/**
 * Talk that belongs to the room, not the lesson. Domestic logistics, phone-call idioms, and things
 * you say to a person beside you. Each of these is a strong "not for us" — strong enough to beat a
 * question form, because "did you remember to send that email" IS a question, just not ours.
 */
const SIDE_CONVERSATION =
  /\b(?:call you back|talk (?:to you )?later|be right back|brb|one sec(?:ond)?|just a sec(?:ond)?|dinner(?:'s| is)? ready|food(?:'s| is)? ready|pass (?:me|the)|hand me|did you (?:remember|feed|lock|call|text|see the|watch the|eat|take)|where (?:did you|are my|are the) (?:put|keys|shoes|charger|phone|glasses)|remember to (?:send|buy|pick|call|text)|pick (?:up|me up)|i'?m (?:coming|on the phone|busy right now)|hold on (?:i'?m|i am) (?:on|in)|what do you want (?:for|to eat)|are you (?:coming|hungry|home|ready to go)|let'?s (?:go|eat|leave)|turn (?:that|the tv|the music) (?:off|down)|shut up|love you|see you (?:later|tomorrow)|good ?night|good ?morning everyone|what time is it|what'?s the time|what day is it|is it (?:raining|cold|hot) (?:out|outside))\b/i;

/** "hey Sam" — a vocative to someone who is not the tutor. */
const HAIL_OPENER = /^(?:hey|hi|yo|oi|hello)[,\s]+([a-z']+)/i;
/** Words that can follow "hey" without naming anyone: "hey can you...", "hey wait". */
const HAIL_NOT_A_NAME = new Set([
  "can", "could", "would", "will", "you", "so", "um", "uh", "wait", "what", "why", "how", "when",
  "where", "please", "there", "that", "this", "is", "are", "do", "does", "did", "i", "let", "hold",
  "stop", "pause", "go", "no", "yes", "okay", "ok", "listen", "look", "actually", "sorry", "hey",
]);

/** The name used in the third person is someone talking ABOUT Aria, to someone else. */
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
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/[“”"()]/g, "")
    .replace(/\s[—–-]+\s/g, " ")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ");
  return { text, words: text.split(" ").filter(Boolean) };
}

export function classifyAddressing(raw: string, context: AddressingContext): AddressingVerdict {
  const { text, words } = normalise(raw);
  if (!text) return { addressed: false, score: 0, reason: "empty" };

  const wakeNames = context.wakeNames?.length ? context.wakeNames.map((n) => n.toLowerCase()) : DEFAULT_WAKE_NAMES;
  const wakePattern = new RegExp(`\\b(?:${wakeNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

  // --- Hard rules, in order of how certain they are ---------------------------------------

  if (LESSON_COMMAND.test(text)) return { addressed: true, score: 1, reason: "lesson command" };

  if (NAME_THIRD_PERSON.test(text) && !/\byou\b/.test(text)) {
    return { addressed: false, score: 0, reason: "talking about the tutor, not to her" };
  }

  if (wakePattern.test(text)) return { addressed: true, score: 1, reason: "addressed by name" };

  const hail = text.match(HAIL_OPENER);
  if (hail && !HAIL_NOT_A_NAME.has(hail[1]) && !wakeNames.includes(hail[1])) {
    return { addressed: false, score: 0, reason: `hailing someone else ("${hail[1]}")` };
  }

  if (SIDE_CONVERSATION.test(text)) return { addressed: false, score: 0, reason: "side conversation" };

  const backchannelOnly = words.length <= 3 && words.every((w) => BACKCHANNEL.has(w.replace(/[^a-z'-]/g, "")));
  if (backchannelOnly) {
    // "yes" / "no" / "the second one" are answers when a question is pending; noise otherwise.
    return context.expectingAnswer && !context.tutorSpeaking
      ? { addressed: true, score: 0.8, reason: "short answer to a pending question" }
      : { addressed: false, score: 0, reason: "backchannel" };
  }

  // --- Weighed evidence -------------------------------------------------------------------

  let score = 0;
  const why: string[] = [];

  if (context.expectingAnswer && !context.tutorSpeaking) {
    score += 0.5;
    why.push("answering");
  }
  if (TUTOR_VERB.test(text)) {
    // Decisive on its own, even mid-lecture: "I don't get it" and "can you explain that" have no
    // other reading than a student talking to their teacher.
    score += 0.75;
    why.push("second person to the tutor");
  }
  if (QUESTION_OPENER.test(text) || raw.includes("?")) {
    score += 0.35;
    why.push("question");
  }
  if (DEICTIC.test(text)) {
    score += 0.45;
    why.push("points at the board");
  }

  const topic = context.topicWords ? new Set([...context.topicWords].map((w) => w.toLowerCase())) : null;
  if (topic && topic.size) {
    const hits = new Set(words.filter((w) => w.length >= 4 && topic.has(w))).size;
    if (hits > 0) {
      score += Math.min(0.6, 0.2 * hits);
      why.push(`${hits} topic word${hits > 1 ? "s" : ""}`);
    }
  }

  if (context.tutorSpeaking) {
    // Interrupting the teacher is the expensive mistake, so the bar is higher while she talks.
    score -= 0.25;
    why.push("tutor speaking");
  } else if (!context.expectingAnswer) {
    // Idle tutor, nothing pending: lean slightly toward listening, since nobody else is talking.
    score += 0.15;
    why.push("tutor idle");
  }

  const addressed = score >= 0.5;
  return {
    addressed,
    score: Math.max(0, Math.min(1, score)),
    reason: why.length ? why.join(" + ") : "no evidence either way",
  };
}
