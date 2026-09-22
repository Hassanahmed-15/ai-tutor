/**
 * DOES THIS BOARD SAY ANYTHING THE STUDENT HAS NOT ALREADY HEARD?
 *
 * Prompting alone cannot guarantee a lecture never repeats itself — a model told "do not restate"
 * still restates. What CAN be guaranteed is that repetition is detected before the beat ships and
 * refused: regenerate once with the offending sentences named, and if the second attempt still
 * repeats, remove the repeated sentences mechanically. This module is that detector and that
 * repair. It is deterministic, so it can be tested to certainty, and it is pure, so the same code
 * runs in the worker and in the generation harness that inspects real lectures.
 *
 * What counts as repetition, in order of how often it was seen:
 *
 *   RESTATED SENTENCE   a sentence whose content words substantially match a sentence from an
 *                       earlier board ("Overfitting is when a model memorises the training data"
 *                       → "Overfitting happens when the model memorises the training data").
 *   RE-DEFINITION       the lesson's subject defined again ("X is…", "X means…") on a board after
 *                       the one that defined it, or a restatement marker ("in other words",
 *                       "put simply") applied to the subject after it was established.
 *   RE-ANALOGY          a second analogy for the subject ("think of it as…", "imagine…", "it's
 *                       like…") after one has already been given.
 *   RETURNS TO BASICS   the subject's definition appearing for the first time AFTER a board that
 *                       already explained its mechanism or worked an example.
 *   BEAT OVERLAP        two boards that, taken whole, share most of their content vocabulary.
 *
 * Thresholds are calibrated by the tests in lib/anim/lessonRepetition.test.ts, which include
 * false-positive guards: a well-structured lesson must produce zero findings.
 */

import { ROLE_CONTRACT, ladderRank, type TeachingRole } from "./lessonLadder";

export type RepetitionKind =
  | "restated-sentence"
  | "re-definition"
  | "re-analogy"
  | "returns-to-basics"
  | "beat-overlap"
  /** A definition or analogy of the subject on a rung whose contract forbids it — e.g. the hook. */
  | "role-violation"
  /** A sentence that carries no information: "understanding X is crucial", "as we delve deeper". */
  | "filler";

export interface RepetitionFinding {
  kind: RepetitionKind;
  /** Index of the offending beat in the lesson. */
  beatIndex: number;
  /** The offending sentence (whole script for beat-overlap). */
  sentence: string;
  /** The earlier beat it repeats, when there is one. */
  matchBeatIndex?: number;
  matchSentence?: string;
  /** 0..1 — how strong the match is. */
  score: number;
}

export interface AuditedBeat {
  title: string;
  script: string;
  role?: TeachingRole;
}

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "into", "than", "then", "when", "what", "which", "where", "while",
  "have", "has", "had", "are", "was", "were", "been", "being", "will", "would", "could", "should", "can", "may", "might",
  "not", "but", "you", "your", "our", "its", "it's", "they", "them", "their", "there", "here", "about", "just", "also",
  "very", "more", "most", "some", "any", "all", "each", "every", "one", "two", "how", "why", "who", "does", "did", "do",
  "let", "lets", "let's", "now", "so", "as", "of", "to", "in", "on", "at", "by", "or", "an", "a", "is", "be", "we", "us",
  "get", "gets", "got", "make", "makes", "made", "like", "really", "actually", "basically", "simply", "still", "even",
  "because", "since", "over", "under", "again", "once", "only", "same", "other", "another", "these", "those", "such",
]);

/** Sentences, on terminal punctuation. Good enough for narration, which is written to be spoken. */
export function sentencesOf(text: string): string[] {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * A crude stem so "memorises", "memorising" and "memorised" agree, and "overfitting" meets
 * "overfit". Longest suffix first; a doubled consonant left by -ing/-ed is collapsed; the bare
 * plural "s" is only stripped from longer words so "krebs" and "cycle" are left alone.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  let out = word;
  for (const suffix of ["ations", "ation", "ising", "izing", "ised", "ized", "ises", "izes", "ise", "ize", "ions", "ion", "ies", "ing", "ers", "er", "ed", "es", "s"]) {
    if (suffix === "s" && (word.length < 6 || /(?:ss|us|is)$/.test(word))) continue;
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      out = word.slice(0, -suffix.length);
      break;
    }
  }
  return out.replace(/([bdgmnprt])\1$/, "$1");
}

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function trigrams(words: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Fraction of a's ordered trigrams that also occur in b — catches reworded copies with a shared spine. */
function containment(a: string[], b: string[]): number {
  const ta = trigrams(a);
  if (ta.size === 0) return 0;
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / ta.size;
}

/** Sentence similarity: content-word Jaccard, boosted by ordered-trigram containment. */
export function sentenceSimilarity(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.length < 4 || wb.length < 4) return 0;
  return Math.max(jaccard(new Set(wa), new Set(wb)), containment(wa, wb));
}

/**
 * The lesson's subject, as the stems a definition of it would have to mention.
 *
 * "What is overfitting?" → ["overfit"]; "how linear regression works" → ["linear", "regress"].
 * Question words and the "explain … to me" frame are stripped; what remains is the noun phrase.
 */
export function subjectTerms(topic: string): string[] {
  const stripped = String(topic ?? "")
    .toLowerCase()
    .replace(/^(?:please\s+)?(?:can you\s+|could you\s+)?(?:explain|teach|describe|tell me about|help me understand)\s+(?:me\s+)?(?:about\s+)?/, "")
    .replace(/^(?:what|why|how|when|where)\s+(?:is|are|does|do|did|can|should|would)\s+(?:an?\s+|the\s+)?/, "")
    .replace(/\b(?:work|works|working|mean|means|happen|happens|matter|matters)\s*\??$/, "")
    .replace(/\?+$/, "")
    .trim();
  const terms = contentWords(stripped);
  return terms.length > 0 ? [...new Set(terms)] : contentWords(topic);
}

function mentionsSubject(sentence: string, subject: string[]): boolean {
  if (subject.length === 0) return false;
  const words = new Set(contentWords(sentence));
  return subject.some((term) => words.has(term));
}

/*
 * A definition says what the subject IS: "X is a…", "X is when…", "X means…", "X refers to…".
 * "X is sensitive to outliers" and "the handshake is complete" are attributes, not definitions —
 * a bare "is/are" only counts when what follows begins a noun phrase or a "when/what" clause.
 */
const DEFINITION_FRAME = /\b(?:means|refers to|is defined as|can be defined as|are defined as|is when|happens when|occurs when|describes|becomes?|is what (?:happens|you get) when|(?:is|are)\s+(?:(?:simply|basically|essentially|just|really|fundamentally|merely|nothing more than)\s+)?(?:a|an|the|one|when|what|where|how|defined))\b/i;
/** "…a common issue known as overfitting": the subject is named AFTER the frame. */
const NAMING_FRAME = /\b(?:known as|called|referred to as|termed|which we call|what we call)\s+(?:the\s+|an?\s+)?["“']?([a-z][a-z0-9' -]{2,40})/i;
const RESTATEMENT_MARKER = /\b(?:in other words|put simply|simply put|to put it (?:another|a different) way|another way to (?:think|say|see|look at)|in simpler terms|that is to say|said differently|to say it again|as (?:i|we) said|as mentioned|again,|once more)\b/i;
const ANALOGY_MARKER = /\b(?:think of\b|imagine\b|to visuali[sz]e (?:this|it)|it'?s (?:a bit |a little |rather |kind of |sort of )?like an?|is (?:a bit |a little |rather |much )?like an?|just like an?|similar to (?:how|an?|the way)|picture (?:a|an|this|yourself)|analogy|much like an?|works like an?|the same way (?:a|an|that)\b)/i;

/**
 * Is this sentence defining the subject? "Overfitting is when…", "So overfitting means…",
 * "A model that overfits is one that…". The subject must appear before the definitional frame,
 * within a short window, so "the model memorises data, which is overfitting" is not a definition.
 */
export function isDefinitionOf(sentence: string, subject: string[]): boolean {
  if (!mentionsSubject(sentence, subject)) return false;
  const lower = sentence.toLowerCase();
  const naming = lower.match(NAMING_FRAME);
  if (naming) {
    const named = contentWords(naming[1]);
    if (subject.some((term) => named.includes(term))) return true;
  }
  const frame = lower.match(DEFINITION_FRAME);
  if (!frame || frame.index === undefined) return false;
  const before = contentWords(lower.slice(0, frame.index));
  // Subject within the last few content words before the frame: "so, overfitting IS…".
  const window = before.slice(-4);
  return subject.some((term) => window.includes(term));
}

export function isAnalogyFor(sentence: string, subject: string[]): boolean {
  return ANALOGY_MARKER.test(sentence) && mentionsSubject(sentence, subject);
}

export function isRestatementOf(sentence: string, subject: string[]): boolean {
  return RESTATEMENT_MARKER.test(sentence) && mentionsSubject(sentence, subject);
}

/*
 * Sentences that say nothing. Seen on five of six boards of one generated lesson: every board
 * closed with "understanding X is crucial for building robust models", and the LAST board closed
 * with "as we delve into the next topic". None of these tells the student anything about X.
 */
const FILLER = [
  /^(?:so |thus |therefore |ultimately |overall |in short |clearly )?(?:understanding|recogni[sz]ing|knowing|grasping|mastering|appreciating|being aware of)\b.{0,80}\b(?:is|are|becomes?|remains?)\b.{0,20}\b(?:crucial|essential|vital|important|key|critical|fundamental|paramount|necessary)\b/i,
  /\b(?:as we (?:delve|dive|move|go|progress|explore|continue) (?:deeper|further|on|forward)|we (?:will|'ll) (?:explore|discuss|see|cover|look at|examine|dive into|delve into|unpack)|for now,? it'?s (?:crucial|essential|important)|it'?s (?:crucial|essential|vital|important) to (?:understand|remember|note|grasp|recogni[sz]e|keep in mind)|we (?:also |then |first |next )?(?:explored|examined|noted|looked at|covered|went through|established that|saw that)\b|in (?:our|the) (?:next|following|upcoming) (?:board|section|discussion|topic|lesson|part|step)|will be foundational|this (?:understanding|knowledge|insight) will (?:guide|help|serve|prepare)|in our exploration of|as (?:we|i) (?:discussed|mentioned|saw|noted) (?:earlier|before|previously|above)|we (?:also )?learned that|we (?:have )?discussed|let'?s recap what|let'?s (?:delve|dive) (?:deeper|into)|sets? the stage for)\b/i,
  /^(?:this|it|that) (?:is|becomes|remains) (?:crucial|essential|vital|important|critical|key|fundamental)\b/i,
  /\b(?:is|are) (?:a )?(?:crucial|essential|vital|critical|fundamental|key) (?:concept|idea|aspect|part|step|consideration|skill|point)\b.{0,40}\b(?:in|for|of|to)\b/i,
];

const FILLER_MORE = [
  /^(?:so |thus |therefore |ultimately |overall )?(?:understanding|recogni[sz]ing|knowing|grasping|appreciating)\b.{0,80}\b(?:helps?|allows?|enables?|lets?|guides?|prepares?|equips?)\b/i,
  /^(?:this|that|these|such|the)\b[^.]{0,40}?\b(?:is|are|becomes?|remains?)\s+(?:absolutely\s+|truly\s+)?(?:crucial|essential|vital|critical|key|fundamental|important|paramount)\b/i,
  /\b(?:the )?(?:key|main|central|most important) takeaways?\b/i,
];

/** Sentences that carry no information. A takeaway line is filler everywhere except the recap, whose job it is. */
export function isFiller(sentence: string, role?: TeachingRole): boolean {
  const text = sentence.trim();
  if (FILLER.some((pattern) => pattern.test(text))) return true;
  return FILLER_MORE.some((pattern, index) => (index === 2 && role === "recap" ? false : pattern.test(text)));
}

const RESTATED_SENTENCE_THRESHOLD = 0.5;
const BEAT_OVERLAP_THRESHOLD = 0.45;

/**
 * Audit one beat against everything before it.
 *
 * `priorBeats` are the beats already taught, in order; `beatIndex` is this beat's position. The
 * subject is the lesson topic. Returns every finding for this beat, so the caller can quote them
 * back to the model or strip them.
 */
export function auditBeat(beat: AuditedBeat, priorBeats: AuditedBeat[], subject: string[], beatIndex = priorBeats.length): RepetitionFinding[] {
  const findings: RepetitionFinding[] = [];
  const mine = sentencesOf(beat.script);
  const prior = priorBeats.map((b, i) => ({ index: i, sentences: sentencesOf(b.script), script: b.script, role: b.role }));

  // Where, if anywhere, has the subject already been defined or given an analogy?
  const definedAt = prior.findIndex((p) => p.sentences.some((s) => isDefinitionOf(s, subject)));
  const analogyAt = prior.findIndex((p) => p.sentences.some((s) => isAnalogyFor(s, subject)));
  // Every earlier analogy, whatever it was about — a second board must not tell the same story.
  const priorAnalogies = prior.flatMap((p) => p.sentences.filter((s) => ANALOGY_MARKER.test(s)).map((s) => ({ index: p.index, sentence: s, words: new Set(contentWords(s)) })));
  const deepestPriorRank = prior.reduce((worst, p) => Math.max(worst, p.role ? ladderRank(p.role) : -1), -1);
  const contract = beat.role ? ROLE_CONTRACT[beat.role] : null;
  const allowsDefinition = contract ? contract.allowsDefinition : true;
  const allowsAnalogy = contract ? contract.allowsAnalogy : true;

  for (const sentence of mine) {
    // 0. Filler: no information, whatever board it is on.
    if (isFiller(sentence, beat.role)) {
      findings.push({ kind: "filler", beatIndex, sentence, score: 1 });
      continue;
    }

    // 1. Restated sentence.
    let best: { score: number; index: number; sentence: string } | null = null;
    for (const p of prior) {
      for (const theirs of p.sentences) {
        const score = sentenceSimilarity(sentence, theirs);
        if (score >= RESTATED_SENTENCE_THRESHOLD && (!best || score > best.score)) best = { score, index: p.index, sentence: theirs };
      }
    }
    if (best) {
      findings.push({ kind: "restated-sentence", beatIndex, sentence, matchBeatIndex: best.index, matchSentence: best.sentence, score: best.score });
      continue;
    }

    // 2. Re-definition / returning to basics / a rung that may not define at all.
    if (isDefinitionOf(sentence, subject)) {
      if (!allowsDefinition && definedAt < 0 && contract && ladderRank(beat.role!) < ladderRank("core")) {
        // The hook defined the term. Everything after it is now "already said".
        findings.push({ kind: "role-violation", beatIndex, sentence, score: 1 });
        continue;
      }
      if (definedAt >= 0) {
        findings.push({ kind: "re-definition", beatIndex, sentence, matchBeatIndex: definedAt, score: 1 });
        continue;
      }
      // First definition in the lesson — but after a mechanism/example board it is out of order.
      if (!allowsDefinition && beat.role && ladderRank(beat.role) > ladderRank("core")) {
        findings.push({ kind: "returns-to-basics", beatIndex, sentence, score: 1 });
        continue;
      }
      if (deepestPriorRank > ladderRank("core")) {
        findings.push({ kind: "returns-to-basics", beatIndex, sentence, score: 1 });
        continue;
      }
    }
    if (definedAt >= 0 && isRestatementOf(sentence, subject)) {
      findings.push({ kind: "re-definition", beatIndex, sentence, matchBeatIndex: definedAt, score: 0.9 });
      continue;
    }

    // 3a. The SAME analogy again, told without naming the subject ("think of a student who memorises…").
    if (ANALOGY_MARKER.test(sentence)) {
      const words = new Set(contentWords(sentence));
      const retold = priorAnalogies.find((p) => { let shared = 0; for (const w of words) if (p.words.has(w)) shared += 1; return shared >= 3; });
      if (retold) {
        findings.push({ kind: "re-analogy", beatIndex, sentence, matchBeatIndex: retold.index, matchSentence: retold.sentence, score: 0.9 });
        continue;
      }
    }
    // 3. An analogy for the subject: a second one anywhere, or a first one on a rung that may not.
    if (isAnalogyFor(sentence, subject) && analogyAt < 0 && !allowsAnalogy) {
      findings.push({ kind: "role-violation", beatIndex, sentence, score: 1 });
      continue;
    }
    if (isAnalogyFor(sentence, subject) && analogyAt >= 0) {
      findings.push({ kind: "re-analogy", beatIndex, sentence, matchBeatIndex: analogyAt, score: 1 });
      continue;
    }
  }

  // 4. Whole-beat overlap, with the subject's own words removed so "both boards are about X" does
  //    not count as repetition — only sharing the rest of the vocabulary does.
  const subjectSet = new Set(subject);
  const mineSet = new Set(contentWords(beat.script).filter((w) => !subjectSet.has(w)));
  for (const p of prior) {
    const theirs = new Set(contentWords(p.script).filter((w) => !subjectSet.has(w)));
    const score = jaccard(mineSet, theirs);
    if (score >= BEAT_OVERLAP_THRESHOLD) {
      findings.push({ kind: "beat-overlap", beatIndex, sentence: beat.script, matchBeatIndex: p.index, score });
    }
  }

  return findings;
}

/** Audit a whole lesson, beat by beat, each against the beats before it. */
export function auditLesson(beats: AuditedBeat[], topic: string): RepetitionFinding[] {
  const subject = subjectTerms(topic);
  const findings: RepetitionFinding[] = [];
  beats.forEach((beat, index) => {
    findings.push(...auditBeat(beat, beats.slice(0, index), subject, index));
  });
  return findings;
}

/** 1 = every sentence adds something; 0 = every sentence was already said. */
export function noveltyRatio(beat: AuditedBeat, findings: RepetitionFinding[]): number {
  const total = sentencesOf(beat.script).length;
  if (total === 0) return 1;
  const flagged = new Set(findings.filter((f) => f.kind !== "beat-overlap").map((f) => f.sentence)).size;
  return Math.max(0, (total - flagged) / total);
}

const MIN_SENTENCES_AFTER_REPAIR = 3;

/**
 * Remove the repeated sentences from a script. The last resort after a regeneration still repeats.
 *
 * Only sentence-level findings are removable; beat-overlap is a whole-board judgement and is left
 * to the regeneration step. A board is never cut below MIN_SENTENCES_AFTER_REPAIR — at that point
 * the beat is mostly repetition and the caller should treat it as a failed generation rather than
 * ship three orphaned sentences.
 */
export function repairScript(script: string, findings: RepetitionFinding[]): { script: string; removed: string[]; repaired: boolean } {
  const offending = new Set(findings.filter((f) => f.kind !== "beat-overlap").map((f) => f.sentence));
  if (offending.size === 0) return { script, removed: [], repaired: false };
  const sentences = sentencesOf(script);
  const kept = sentences.filter((s) => !offending.has(s));
  if (kept.length < MIN_SENTENCES_AFTER_REPAIR) return { script, removed: [], repaired: false };
  /*
   * A removed sentence can leave the next one hanging off it: "Overfitting is… For instance, if
   * you…" becomes a board that opens "For instance, if you…". Strip the connective when the
   * sentence before it went; the sentence still reads, now as a plain statement.
   */
  const removedBefore = new Set<number>();
  sentences.forEach((s, i) => { if (offending.has(s)) removedBefore.add(i + 1); });
  const repairedSentences = sentences
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !offending.has(s))
    .map(({ s, i }) => (removedBefore.has(i) ? stripDanglingConnective(s) : s));
  return { script: repairedSentences.join(" "), removed: sentences.filter((s) => offending.has(s)), repaired: true };
}

const DANGLING_CONNECTIVE = /^(?:for (?:instance|example),?\s+|next,?\s+|then,?\s+|finally,?\s+|thus,?\s+|therefore,?\s+|consequently,?\s+|as a result,?\s+|additionally,?\s+|moreover,?\s+|furthermore,?\s+|also,?\s+|similarly,?\s+|in other words,?\s+|so,?\s+|hence,?\s+|likewise,?\s+|in addition,?\s+)/i;

function stripDanglingConnective(sentence: string): string {
  const stripped = sentence.replace(DANGLING_CONNECTIVE, "");
  if (stripped === sentence) return sentence;
  return stripped.replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * The claims a board hands to later boards. A hook that defined the subject in its keyClaims —
 * despite being told not to — primed the core board to restate that exact sentence as "the
 * canonical definition". Only a rung that may define the subject may establish its definition.
 */
export function claimsAllowedFor(claims: string[], subject: string[], role: TeachingRole | undefined): string[] {
  const contract = role ? ROLE_CONTRACT[role] : null;
  if (!contract || contract.allowsDefinition) return claims;
  return claims.filter((claim) => !isDefinitionOf(claim, subject));
}

/** A human-readable line per finding, for logs and for quoting back to the model. */
export function describeFinding(f: RepetitionFinding, beats: AuditedBeat[]): string {
  const where = beats[f.beatIndex]?.title ?? `beat ${f.beatIndex + 1}`;
  const match = f.matchBeatIndex !== undefined ? ` (already said in "${beats[f.matchBeatIndex]?.title ?? `beat ${f.matchBeatIndex + 1}`}")` : "";
  const text = f.kind === "beat-overlap" ? `${Math.round(f.score * 100)}% of its vocabulary` : `"${f.sentence}"`;
  return `${f.kind} in "${where}"${match}: ${text}`;
}
