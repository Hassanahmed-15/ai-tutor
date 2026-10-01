const MAX_TITLE_CHARS = 42;
const MAX_TITLE_WORDS = 5;
const MAX_TRANSITION_WORDS = 18;

type PlannedBeat = { title: string; objective: string };

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimWords(value: string, maximum: number): string {
  const words = compact(value).split(" ").filter(Boolean);
  return words.length <= maximum ? words.join(" ") : words.slice(0, maximum).join(" ");
}

/**
 * Words a title must never END on. Cutting at a word limit produced "Explore the fundamental
 * purpose and" — a title that visibly stops mid-phrase. The dangling connective is dropped instead.
 */
// A title cut from a sentence must not end mid-clause: "Remove Operation Is Difficult Because".
const DANGLING_TAIL = /[\s,;:|—-]+(?:and|or|of|the|to|with|in|for|a|an|vs\.?|versus|by|on|at|from|into|its|their|how|why|what|that|because|which|who|whose|where|when|while|if|so|but|as|than|since|although|unless|until|whether|nor|yet)?$/i;

function trimTitle(value: string, maxWords = MAX_TITLE_WORDS): string {
  const words = trimWords(value.replace(/[.!]+$/, ""), maxWords);
  let fitted = words.length <= MAX_TITLE_CHARS
    ? words
    : words.slice(0, MAX_TITLE_CHARS + 1).replace(/\s+\S*$/, "").trim();
  // Repeatedly: "purpose and the" loses both words, never leaving another connective behind.
  for (let previous = ""; previous !== fitted && fitted.includes(" "); ) {
    previous = fitted;
    fitted = fitted.replace(DANGLING_TAIL, "").trim();
  }
  return fitted.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
}

/**
 * An instruction written as a title — "Explore the fundamental purpose of…", "Understand how…".
 * The planner sometimes titles a subtopic with what the TUTOR should do; the student should see
 * what is being taught. The leading verb (and a following article) is dropped.
 */
const INSTRUCTION_OPENER = /^(?:explore|understand|learn(?: about)?|discover|discuss|examine|describe|define|identify|introduce|investigate|review|study|cover|analy[sz]e|master|grasp|see|look at|dive into|delve into|get to know)\s+(?:the\s+|a\s+|an\s+)?/i;

/** Turns a user's request into the subject label used on title cards. */
export function topicKeywords(value: string, maxWords = MAX_TITLE_WORDS): string {
  const subject = compact(value)
    .replace(/^(?:please\s+)*(?:(?:can|could|would)\s+you\s+)?(?:explain|teach|show|tell|help)\s+(?:me|us)?\s*(?:about\s+)?/i, "")
    .replace(/\b(?:please|plz)\b/gi, "")
    .replace(/\b(?:step[- ]by[- ]step|in detail|from scratch|for beginners?)\b.*$/i, "")
    .replace(/\s+(?:to|for)\s+(?:a|an|the)?\s*$/i, "")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "");
  return trimTitle(subject || value, maxWords)
    .split(" ")
    .map((word, index) => {
      if (/^(?:a|an|and|as|at|by|for|in|of|on|or|the|to|vs\.?)$/i.test(word) && index > 0) return word.toLowerCase();
      if (/[A-Z].*[A-Z]|[a-z][A-Z]/.test(word)) return word;
      return word.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
    })
    .join(" ");
}

/**
 * A SLIDE TITLE AS A NOUN PHRASE, for a typed-prompt lecture.
 *
 * The planner is asked for noun-phrase titles ("Hydraulic Actuators"), and this is the safety net for
 * when it still writes a question or a sentence: "Why Do Leaves Look Green?" becomes "Leaves Look
 * Green", "Understanding Hydraulic Actuators" becomes "Hydraulic Actuators", "How X Works" becomes
 * "X", "Photosynthesis Explained" becomes "Photosynthesis". It never returns less than a word of the
 * original: if stripping leaves nothing, the original stands.
 */
export function nounTitle(value: string): string {
  const original = compact(value);
  const stripped = original
    .replace(/[?!.]+$/, "")
    .replace(/^(?:what|why|how|when|where|which|who)\s+(?:is|are|was|were|does|do|did|can|could|will|would|should)\s+/i, "")
    .replace(/^(?:what|why|how|when|where|which|who)\s+/i, "")
    .replace(/^(?:understanding|exploring|learning about|discovering|examining|introducing|mastering)\s+/i, "")
    .replace(INSTRUCTION_OPENER, "")
    .replace(/^(?:an?\s+)?(?:introduction|intro|overview|basics|fundamentals)\s+(?:to|of)\s+/i, "")
    .replace(/[\s:,-]+(?:explained|an overview|overview|basics|an introduction|introduction|in a nutshell)$/i, "")
    .replace(/\s+(?:works?|matters?|happens?|occurs?)$/i, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim();
  if (!/[A-Za-z]{3,}/.test(stripped)) return original;
  return topicKeywords(stripped, 6) || original;
}

function keywordTitle(value: string, topic: string, maxWords = MAX_TITLE_WORDS): string {
  const subject = topicKeywords(topic);
  const stripped = compact(value)
    /*
     * Strip a leading interrogative ONLY when what follows still reads as a phrase.
     *
     * "What is linear regression" became "Is Linear Regression" — an ungrammatical fragment that
     * then went on to become a SEPARATE SUBTOPIC beside the real one, so the lesson listed both
     * "What Is Linear Regression" and "Is Linear Regression". Dropping the question word is only
     * safe when the remainder does not start with a copula or auxiliary; "what IS x" and "why DOES
     * y" need the question word to make sense at all.
     */
    .replace(/^(?:why|how|what)\s+(?!(?:is|are|was|were|does|do|did|can|could|will|would|should)\b)/i, "")
    .replace(/^(?:explain|teach|show|tell)\s+(?:me|us)?\s*/i, "")
    .replace(INSTRUCTION_OPENER, "")
    .replace(/\b(?:step[- ]by[- ]step|in detail)\b.*$/i, "")
    .replace(/\s+(?:matters?|works?)\??$/i, "")
    .replace(new RegExp(`^${escapeRegExp(compact(topic))}\\s*:\\s*`, "i"), "")
    .replace(/^(?:a|an|the)\s+/i, "");
  const candidate = topicKeywords(stripped, maxWords);
  return candidate || subject;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function weakTitle(value: string, topic: string): boolean {
  const title = compact(value).toLowerCase();
  const normalizedTopic = compact(topic).toLowerCase();
  if (!title) return true;
  if (/^(?:introduction|overview|core idea|basics?|idea \d+|quick check|summary|recap)$/.test(title)) return true;
  if (/^(?:page|slide|figure|fig\.?|chapter|section)\s*[\w.-]*(?:\s*[:—-].*)?$/i.test(title)) return true;
  if (normalizedTopic && title.startsWith(`${normalizedTopic}:`)) {
    const suffix = title.slice(normalizedTopic.length + 1).trim();
    return /^(?:core idea|how it works|a worked example|common mistake|compare and connect|try it|deeper layer|transfer|idea \d+|put it together)$/.test(suffix);
  }
  return false;
}

/** "<topic>: <role>" — a title from the default lecture plan, not one anyone wrote for this beat. */
function isPlanTemplateTitle(value: string): boolean {
  return /:\s*(?:core idea|how it works|a worked example|common mistake|compare and connect|try it|deeper layer|transfer|idea \d+|put it together)\s*$/i.test(compact(value));
}

function objectiveTitle(objective: string): string {
  // A document beat's objective is a pipeline instruction ("Teach these source blocks completely…"),
  // not a description of the idea — as a title it put "These source blocks completely" on a slide.
  if (/\bsource blocks?\b/i.test(objective)) return "";
  const stripped = compact(objective)
    .replace(/^(?:open with|define|explain|show|demonstrate|apply|trace|teach|introduce|connect|contrast|compare|expose and repair|give)\s+/i, "")
    .split(/[.;!?]/, 1)[0]
    .replace(/^(?:that|how|why)\s+/i, "");
  return trimTitle(stripped.replace(/^(?:a|an|the)\s+/i, ""));
}

/**
 * A beat planned as a recap or summary. Lectures no longer have them — the student asked for
 * lessons strictly on their question, and the whole-lecture crux is a one-slide summary they open
 * once they finish — so the plan builders drop any beat this matches.
 */
export function isRecapTitle(title: string): boolean {
  return /\b(?:recap|summary|summari[sz]ing|review|wrap[- ]?up|conclusion|putting it (?:all )?together|key takeaways?)\b/i.test(compact(title));
}

function roleTitle(topic: string, sequence: number, total: number): string {
  void total;
  const subject = topicKeywords(topic) || "Core Concept";
  if (sequence === 0) return subject;
  const roles = [
    `${subject} Fundamentals`,
    `${subject} Mechanism`,
    "Worked Example",
    "Common Pitfalls",
    "Concept Connections",
    "Practice",
    "Advanced Concepts",
    "Applications",
  ];
  return trimTitle(roles[(sequence - 1) % roles.length]);
}

/**
 * Improves only titles that are demonstrably weak. Specific titles authored by the planner or
 * source remain untouched; generic templates, locators and duplicates are replaced with a title
 * based on the beat's actual objective and teaching role.
 */
/**
 * A section taught over several beats keeps its own name, numbered — "Testing a Leaf for Starch
 * (Part 2)" — rather than borrowing a generic role title ("Worked Example") about nothing in it.
 */
function numberedParts(title: string): string[] {
  return title ? Array.from({ length: 8 }, (_, index) => `${title} (Part ${index + 2})`) : [];
}

export type PolishOptions<T> = {
  /**
   * The opening words of THIS beat's own source text. Setting it marks the plan as built from an
   * uploaded document (see polishSourceTitle).
   */
  sourceOpening?: (entry: T, sequence: number) => string;
};

/**
 * A source heading is authored text: the five-word cut made for model-written titles turned
 * "Questions: Testing a leaf for starch" into "Questions: Testing a Leaf" — a heading visibly cut
 * off mid-phrase on the title card. Source titles keep up to eight words; the 42-character cap,
 * which is what the title card and header actually have room for, still applies.
 */
const SOURCE_TITLE_WORDS = 8;

/**
 * The title of a beat planned from an uploaded document: the source's own heading, or — when that
 * is only a locator like "Page 3" or "Figure 1.2" — the source's own opening words.
 *
 * NEVER a generic role title. `roleTitle` exists to name the slots of a typed topic's default
 * ladder; on a document it put "Worked Example", "Common Pitfalls" or "Applications" over a section
 * that contained no example, pitfall or application. The script prompt then told the model to keep
 * that title exactly, and the board drew it as its subject — the plan itself inventing content.
 */
function polishSourceTitle(original: string, topic: string, opening: string, objective: string, used: Set<string>, sequence: number): string {
  const own = weakTitle(original, topic) ? "" : original;
  // Cased like every other title on the plan ("Energy Transfer"), so the slides read as one set.
  const said = opening.trim() ? topicKeywords(opening, SOURCE_TITLE_WORDS) : "";
  const base = own || said || objective;
  const candidates = [own, said, objective, ...numberedParts(base)].filter(Boolean);
  return candidates.find((candidate) => !used.has(candidate.toLowerCase())) ?? `Part ${sequence + 1}`;
}

export function polishBeatPlan<T extends PlannedBeat>(entries: T[], topic: string, options: PolishOptions<T> = {}): T[] {
  const used = new Set<string>();
  const sourceOpening = options.sourceOpening;
  if (sourceOpening) {
    return entries.map((entry, sequence) => {
      const title = polishSourceTitle(keywordTitle(entry.title, topic, SOURCE_TITLE_WORDS), topic, sourceOpening(entry, sequence) ?? "", objectiveTitle(entry.objective), used, sequence);
      used.add(title.toLowerCase());
      return { ...entry, title };
    });
  }
  return entries.map((entry, sequence) => {
    const original = keywordTitle(entry.title, topic);
    const objective = objectiveTitle(entry.objective);
    const role = roleTitle(topic, sequence, entries.length);
    /*
     * A default-plan beat ("1857 War: Core idea", used when the student skipped planning and there
     * is no outline) takes its ROLE title. Its objective is an instruction to the tutor — "Define
     * 1857 War plainly and establish the mental model" — and turning that into a title put "1857 War
     * plainly and establish" on the title slide; "How it works" lost its verb and became "How It".
     * The raw title is tested, because `keywordTitle` has already mangled `original`.
     */
    // Only the OPENING beat prefers its role title (the subject). The last beat is titled like any
    // other: it used to be forced to "<subject> Recap" whatever it actually taught.
    const candidates = sequence === 0
      ? [role, original, objective]
      : isPlanTemplateTitle(entry.title)
        ? [role]
        : weakTitle(original, topic)
          ? [objective, role]
          : [original, objective, ...numberedParts(original), role];
    let title = candidates.find((candidate) => candidate && !used.has(candidate.toLowerCase())) ?? role;
    if (used.has(title.toLowerCase())) {
      title = trimTitle(role);
    }
    used.add(title.toLowerCase());
    return { ...entry, title };
  });
}

function deterministicTransition(previousTitle: string, currentTitle: string): string {
  const current = trimTitle(currentTitle) || "the next idea";
  if (/\b(?:example|action|practice|try)\b/i.test(current)) {
    return "Let’s put what we just learned to work in a concrete example.";
  }
  if (/\b(?:compare|versus|vs\.?|difference|contrast)\b/i.test(current)) {
    return `Keep that foundation in mind as we notice what changes in ${current}.`;
  }
  if (/\b(?:recap|together|mental model|complete)\b/i.test(current)) {
    return `We have the pieces, so let’s connect them through ${current}.`;
  }
  if (/\b(?:check|predict|test)\b/i.test(current)) {
    return `Before we continue, let’s use ${current} to check the key idea.`;
  }
  return `That foundation leads directly into ${current}.`;
}

/** One short, speakable sentence. Missing values get a deterministic bridge for old lectures. */
export function transitionSentence(raw: unknown, previousTitle: string, currentTitle: string): string {
  const fallback = deterministicTransition(previousTitle, currentTitle);
  return oneSentence(raw, fallback);
}

const OPENING_LINES = [
  (topic: string) => `Let’s get into ${topic}.`,
  (topic: string) => `Here’s ${topic}, from the ground up.`,
  (topic: string) => `We’re looking at ${topic} today.`,
  (topic: string) => `Let’s work through ${topic} together.`,
];

/**
 * THE FIRST THING THE STUDENT HEARS, and why it exists.
 *
 * Every beat but the first carries a transitionIn, and a beat that has one narrates the moment its
 * title slide appears. The first beat had none, so it sat through the title-slide timer in silence
 * and only then asked for its first audio clip — the pause at the start of every lecture, and the
 * one place the lecture felt slower than the joins inside it. Giving beat one an opening line puts
 * it on exactly the same path as every transition, with no special case anywhere downstream.
 *
 * A lecture written before this, or one whose opener came back empty, gets a deterministic line
 * chosen by the topic, so it is stable for the same lecture rather than changing on every replay.
 */
export function openingSentence(raw: unknown, topic: string): string {
  const clean = trimTitle(topic) || "today’s topic";
  let hash = 0;
  for (const char of clean.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  const fallback = OPENING_LINES[hash % OPENING_LINES.length](clean);
  return oneSentence(raw, fallback);
}

function oneSentence(raw: unknown, fallback: string): string {
  const candidate = typeof raw === "string" && compact(raw) ? compact(raw) : fallback;
  const firstSentence = candidate.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? candidate;
  const words = firstSentence.split(" ").filter(Boolean).slice(0, MAX_TRANSITION_WORDS);
  let result = words.join(" ").slice(0, 160).trim();
  if (!/[.!?]$/.test(result)) result += ".";
  return result || fallback;
}
