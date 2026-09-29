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
  /**
   * Names known to belong to someone else in the room. A hail to one of these is a hard veto;
   * a hail to any other unrecognised name is only scored down, because it is far more likely to be
   * a mis-transcribed "Aria" than a real person the app has never been told about.
   */
  otherPeople?: string[];
}

export interface AddressingVerdict {
  addressed: boolean;
  score: number;
  reason: string;
}

/*
 * Known mis-hearings of "Aria" that the sound-alike skeleton below cannot reach, because each has a
 * second consonant: "hey Aria" run together comes back as "hey Maria" / "Mariah"; "Ariana",
 * "Arianna", "Rhea" and "Riya" are what recognisers reach for when they know a name is being said.
 * "Hey Maria" was even scored as calling someone ELSE. These count anywhere, like "Aria" itself.
 */
const WAKE_VARIANTS = ["maria", "mariah", "ariana", "arianna", "rhea", "riya", "ariya", "aariya", "areya", "ariah", "aaria", "arria"];
const DEFAULT_WAKE_NAMES = ["aria", "arya", "teacher", "tutor", ...WAKE_VARIANTS];
const NAME_ALTERNATION = ["aria", "arya", ...WAKE_VARIANTS].join("|");

/**
 * Wake on anything that SOUNDS like "Aria", rather than on a list of spellings.
 *
 * "Aria" is two syllables of vowel around a single tapped r, with no stressed consonant to anchor
 * it, so recognisers return whatever nearby word their language model prefers: "area", "aria",
 * "ariya", "ara", "arie", "airia", "oria", "Ariel". Enumerating those is a losing game — the first
 * version of this fix listed eight spellings and still missed twelve of twenty-six plausible
 * transcriptions, because there is no bound on what a recogniser will produce for a name it does
 * not know.
 *
 * So match the skeleton instead: an optional leading vowel sound, an `r`, and a vowel-ish tail,
 * with no consonant other than that `r` anywhere in the token. "area", "ara", "oria" and "aeria"
 * all reduce to it; "art", "around", "read" and "race" do not, because a second consonant
 * disqualifies them. The `y` in "arya" counts as a vowel here, and a trailing "h" or "l" is
 * allowed for "ariah" and "Ariel". A leading "y" and a trailing "n" are allowed too: Chrome heard a
 * real student's "hey Aria" as "Yaariyan".
 */
const WAKE_SOUNDALIKE = /^(?:[aeiou]{1,3}r+[aeiouy]{1,4}(?:h|l)?|y?[aeiou]{1,3}r+[aeiouy]{1,4}n?)$/i;

/** A determiner or modifier right before the token means it is a noun, not someone being addressed. */
const ARTICLE_BEFORE_NOUN = new Set([
  "the", "a", "an", "this", "that", "its", "his", "her", "their", "our", "my", "your",
  "surface", "total", "same", "whole", "entire", "shaded", "cross", "grey", "gray", "of",
]);

/** Openers a student puts in front of the name, so the name is the second word rather than the first. */
const GREETING_OPENER = new Set([
  "hey", "hi", "hello", "yo", "oi", "um", "uh", "so", "okay", "ok", "excuse", "sorry", "listen", "good",
]);

/** Tokens that pass the skeleton but are ordinary words, not a mis-heard name. */
const WAKE_SOUNDALIKE_EXCEPTIONS = new Set(["or", "our", "are", "her", "hour", "era", "oreo", "euro", "aura", "royal", "iron", "yarn", "your", "year", "yeah", "urn", "earn", "orion", "iran", "aaron", "arin", "erin", "oran", "urine"]);

/** Edit distance, for the one word after a greeting (see hailSoundsLikeAria). */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** Heard for "Aria" after a greeting, too far by spelling to be caught by the edit distance. */
const HAIL_ONLY_VARIANTS = new Set(["idea", "aida", "ida", "aya", "ayah", "eria", "arial"]);

/**
 * "Hey <something close to Aria>". A greeting followed by a name is a call, and the name is where
 * recognisers go wrong: "hey idea", "hey Ariel", "hi Aya". Right after a greeting a word two edits
 * from "aria" counts — looser than anywhere else, because that position is already a call.
 */
function hailSoundsLikeAria(word: string): boolean {
  const w = word.replace(/[^a-z]/gi, "").toLowerCase();
  if (w.length < 3 || w.length > 8 || HAIL_NOT_A_NAME.has(w)) return false;
  if (HAIL_ONLY_VARIANTS.has(w)) return true;
  // "Aria" opens on a vowel; "Ryan", "Dan", "Maya" are other people ("Rhea"/"Riya" are listed).
  if (!/^[aeiouy]/.test(w)) return false;
  return ["aria", "ariya", "arya"].some((name) => editDistance(w, name) <= (w.length <= 3 ? 1 : 2));
}

/** True when a single word is plausibly the recogniser's attempt at "Aria". */
function soundsLikeWakeName(word: string): boolean {
  const w = word.replace(/[^a-z]/gi, "").toLowerCase();
  if (w.length < 2 || w.length > 8) return false;
  if (WAKE_SOUNDALIKE_EXCEPTIONS.has(w)) return false;
  return WAKE_SOUNDALIKE.test(w);
}

const BACKCHANNEL = new Set([
  "mm", "mmm", "mhm", "mm-hm", "mmhm", "uh", "uh-huh", "uhhuh", "um", "hmm", "huh", "ah", "oh",
  "ok", "okay", "yeah", "yep", "yes", "no", "nope", "right", "sure", "cool", "nice", "wow", "hm",
  "eh", "haha", "lol", "gotcha", "alright", "fine", "true", "exactly", "totally", "makes", "sense",
  "i", "see", "got", "it",
]);

const LESSON_COMMAND =
  /^(?:(?:aria|arya|teacher|please|hey|ok|okay)[,\s]+)*(?:pause|stop|wait|hold on|hang on|continue|resume|keep going|go on|carry on|repeat|say (?:that )?again|again|next|go back|back up|skip|slower|slow down|faster|speed up|louder|quieter|one more time|start over|never mind|nevermind)(?:[,\s]+(?:please|aria|arya|teacher|the lecture|that))*[.!?\s]*$/i;

const TUTOR_VERB =
  /\b(?:can|could|would|will|please)\s+you\s+(?:explain|repeat|show|draw|tell|go|slow|speed|skip|say|clarify|elaborate|teach|walk|give|define|summari[sz]e|break)\b|\b(?:what|why|how|when|where|which|who)\s+(?:do|does|did|are|is|was|were|should|would|could)\s+(?:you\s+|that\s+|this\s+|it\s+)?(?:mean|say|saying|said|meant|call|get|come|know)\b|\bwhat\s+about\b|\byou\s+(?:said|mean|meant|mentioned|skipped|lost me|went too fast)\b|\b(?:explain|clarify|elaborate|define|summari[sz]e)\s+(?:that|this|it|again|the)\b|\bi (?:don'?t|do not|didn'?t) (?:get|follow|understand)\b|\b(?:go|jump|scroll) back\b|\bshow me\b|\bteach me\b|\btell me\b|\bi (?:want|need|would like|'?d like|wanna) you to (?:\w+ )?(?:explain|draw|sketch|show|tell|teach|repeat|describe|clarify|go (?:over|through|back)|help|continue|pause|stop|walk)\b|(?:^|\b(?:you|please|just|now|so|okay|ok|but|and|then)\s+)(?:explain|draw|sketch|describe|show) (?:\w+ )?(?:for |to )?(?:me|us)\b/i;

/**
 * A request in the imperative, the way people ask for a drawing: "draw the tree", "now show what
 * happens when we insert 6", "illustrate the deletion". "Show me" alone was covered; these were not,
 * so a follow-up drawing request without her name was ignored even with the lecture paused.
 */
const IMPERATIVE_REQUEST =
  /(?:^|[,;:]\s*)(?:(?:now|and|so|okay|ok|then|next|also|please)[,\s]+)*(?:draw|sketch|show|illustrate|diagram|plot|graph|visuali[sz]e|demonstrate|walk (?:me |us )?through|go through|work (?:it|this|that) out|redraw|zoom in on|label)\b/i;
/** The board itself named: "on the same board", "a new slide", "figure 19.2". */
const BOARD_REFERENCE =
  /\b(?:on|to|in|onto) (?:the|this|that|a|the same|a new|the next) (?:same |new |next )?(?:board|slide|diagram|drawing|figure|picture)\b|\bfigure\s+\d|\b(?:same|new|next) (?:board|slide)\b/i;

const QUESTION_OPENER =
  /^(?:(?:aria|arya|teacher|so|ok|okay|right|yeah|yes|actually|wait|um|but|and)[,\s]+)*(?:what|why|how|when|where|which|who|whose|is|are|was|were|does|do|did|can|could|would|should|will|am|isn'?t|aren'?t|doesn'?t|don'?t)\b/i;

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
const NAME_THIRD_PERSON = new RegExp(`\\b(?:${NAME_ALTERNATION}|teacher|the tutor|this (?:thing|app|ai))\\s+(?:said|says|told|keeps|kept|was saying|is saying|sounds|thinks|just|won'?t|can'?t|doesn'?t|isn'?t)\\b`, "i");

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
  let text = raw.trim().toLowerCase().replace(/[“”"()]/g, "").replace(/\s[—–-]+\s/g, " ").replace(/[.,!?;:]+$/g, "").replace(/\s+/g, " ");
  // Typed and dictated shorthand: "can u explain" is "can you explain".
  text = text.replace(/\bu\b/g, "you").replace(/\bur\b/g, "your");
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
  // Same question phonetically — see soundsLikeWakeName. Only the edges of the utterance count, so
  // "the area of a circle" stays a maths question while "hello ara" wakes her.
  if (!context.wakeNames?.length) {
    const at = (i: number) => (i >= 0 && i < words.length && soundsLikeWakeName(words[i]) ? words[i] : null);
    const before = words[words.length - 2];
    const heard =
      at(0) ??
      (words.length > 1 && !ARTICLE_BEFORE_NOUN.has(before ?? "") ? at(words.length - 1) : null) ??
      (words.length > 1 && GREETING_OPENER.has(words[0]) ? at(1) : null) ??
      (words.length > 1 && /^(?:hey|hi|hello|hiya|ok|okay|oi|yo)$/.test(words[0]) && hailSoundsLikeAria(words[1]) ? words[1] : null);
    if (heard) return { addressed: true, score: 1, reason: `addressed by name (heard "${heard}")` };
  }
  const hail = text.match(HAIL_OPENER);
  /*
   * A hail to an unrecognised name is evidence against, not a veto.
   *
   * It used to return score 0 outright, which made one bad transcription of "Aria" — "area",
   * "ariya", anything — indistinguishable from calling out to a person in the room. A student
   * repeating "hey Aria" then got silence every time, with no way to tell why. Real side-talk is
   * still caught: it loses the "tutor idle" credit and has to earn 0.5 from the words themselves,
   * which "hey Mum" and "hey Dave, pass me that" do not, while "hey area, what is a derivative"
   * does. Only a hail with a *known other* name still vetoes, since that is unambiguous.
   */
  const hailedName = hail && !HAIL_NOT_A_NAME.has(hail[1]) && !wakeNames.includes(hail[1]) ? hail[1] : null;
  if (hailedName && context.otherPeople?.some((n) => n.toLowerCase() === hailedName)) {
    return { addressed: false, score: 0, reason: `hailing someone else ("${hailedName}")` };
  }
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
  const topicSet = context.topicWords ? new Set([...context.topicWords].map((w) => w.toLowerCase())) : null;
  const aboutLesson = BOARD_REFERENCE.test(text) || /\b(?:me|us)\b/.test(text) || Boolean(topicSet && words.some((w) => w.length >= 4 && topicSet.has(w)));
  // "Draw the curtains" and "show the salt to your brother" are imperatives too — only one about
  // the lesson (its words, its board, or "for me") is a request to her.
  if (!TUTOR_VERB.test(text) && IMPERATIVE_REQUEST.test(text) && aboutLesson) { score += 0.45; why.push("asks for a drawing"); }
  if (BOARD_REFERENCE.test(text)) { score += 0.45; why.push("names the board"); }
  if (QUESTION_OPENER.test(text) || raw.includes("?")) { score += 0.35; why.push("question"); }
  if (DEICTIC.test(text)) { score += 0.45; why.push("points at the board"); }
  const topic = context.topicWords ? new Set([...context.topicWords].map((w) => w.toLowerCase())) : null;
  if (topic && topic.size) {
    const hits = new Set(words.filter((w) => w.length >= 4 && topic.has(w))).size;
    if (hits > 0) { score += Math.min(0.6, 0.2 * hits); why.push(`${hits} topic word${hits > 1 ? "s" : ""}`); }
  }
  if (context.tutorSpeaking) { score -= 0.25; why.push("tutor speaking"); }
  /*
   * Idle credit is small on purpose (0.15 until 2026-09-29): with it, ANY question-shaped sentence
   * reached 0.5 while she was quiet — a phone video's "what is going on here?" or the TV's "can you
   * believe it?" was answered as if the student had asked (reported: "whenever I'm using my phone
   * or there's background noise, Aria gets activated that quickly"). A question now needs something
   * that ties it to the lesson or to her — a topic word, "you"/"me", the board, her name.
   */
  else if (!hailedName && !context.expectingAnswer) { score += 0.1; why.push("tutor idle"); }
  // An unknown hail withholds the idle credit and costs a little more, so "hey Dave" needs real
  // evidence to get through while "hey <mis-heard Aria>, what does that mean" still does.
  if (hailedName) { score -= 0.2; why.push(`hailed "${hailedName}"`); }
  return { addressed: score >= 0.5, score: Math.max(0, Math.min(1, score)), reason: why.length ? why.join(" + ") : "no evidence either way" };
}
