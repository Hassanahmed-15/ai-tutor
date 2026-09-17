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

function trimTitle(value: string): string {
  const words = trimWords(value.replace(/[.!]+$/, ""), MAX_TITLE_WORDS);
  const fitted = words.length <= MAX_TITLE_CHARS
    ? words
    : words.slice(0, MAX_TITLE_CHARS + 1).replace(/\s+\S*$/, "").trim();
  return fitted.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
}

/** Turns a user's request into the subject label used on title cards. */
export function topicKeywords(value: string): string {
  const subject = compact(value)
    .replace(/^(?:please\s+)*(?:(?:can|could|would)\s+you\s+)?(?:explain|teach|show|tell|help)\s+(?:me|us)?\s*(?:about\s+)?/i, "")
    .replace(/\b(?:please|plz)\b/gi, "")
    .replace(/\b(?:step[- ]by[- ]step|in detail|from scratch|for beginners?)\b.*$/i, "")
    .replace(/\s+(?:to|for)\s+(?:a|an|the)?\s*$/i, "")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "");
  return trimTitle(subject || value)
    .split(" ")
    .map((word, index) => {
      if (/^(?:a|an|and|as|at|by|for|in|of|on|or|the|to|vs\.?)$/i.test(word) && index > 0) return word.toLowerCase();
      if (/[A-Z].*[A-Z]|[a-z][A-Z]/.test(word)) return word;
      return word.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
    })
    .join(" ");
}

function keywordTitle(value: string, topic: string): string {
  const subject = topicKeywords(topic);
  const stripped = compact(value)
    .replace(/^(?:why|how|what)\s+/i, "")
    .replace(/^(?:explain|teach|show|tell)\s+(?:me|us)?\s*/i, "")
    .replace(/\b(?:step[- ]by[- ]step|in detail)\b.*$/i, "")
    .replace(/\s+(?:matters?|works?)\??$/i, "")
    .replace(new RegExp(`^${escapeRegExp(compact(topic))}\\s*:\\s*`, "i"), "")
    .replace(/^(?:a|an|the)\s+/i, "");
  const candidate = topicKeywords(stripped);
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

function objectiveTitle(objective: string): string {
  const stripped = compact(objective)
    .replace(/^(?:open with|define|explain|show|demonstrate|apply|trace|teach|introduce|connect|contrast|compare|expose and repair|give)\s+/i, "")
    .split(/[.;!?]/, 1)[0]
    .replace(/^(?:that|how|why)\s+/i, "");
  return trimTitle(stripped.replace(/^(?:a|an|the)\s+/i, ""));
}

function roleTitle(topic: string, sequence: number, total: number): string {
  const subject = topicKeywords(topic) || "Core Concept";
  if (sequence === 0) return subject;
  if (sequence === total - 1) return trimTitle(`${subject} Recap`);
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
export function polishBeatPlan<T extends PlannedBeat>(entries: T[], topic: string): T[] {
  const used = new Set<string>();
  return entries.map((entry, sequence) => {
    const original = keywordTitle(entry.title, topic);
    const objective = objectiveTitle(entry.objective);
    const role = roleTitle(topic, sequence, entries.length);
    const candidates = sequence === 0 || sequence === entries.length - 1
      ? [role, original, objective]
      : weakTitle(original, topic)
        ? [objective, role]
        : [original, objective, role];
    let title = candidates.find((candidate) => candidate && !used.has(candidate.toLowerCase())) ?? role;
    if (used.has(title.toLowerCase())) {
      title = trimTitle(sequence === entries.length - 1 ? `${topicKeywords(topic)} Recap` : role);
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
  const candidate = typeof raw === "string" && compact(raw) ? compact(raw) : fallback;
  const firstSentence = candidate.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? candidate;
  const words = firstSentence.split(" ").filter(Boolean).slice(0, MAX_TRANSITION_WORDS);
  let result = words.join(" ").slice(0, 160).trim();
  if (!/[.!?]$/.test(result)) result += ".";
  return result || fallback;
}
