/**
 * One planning conversation, whichever way each line arrived.
 *
 * WHY THIS EXISTS. The planning screen showed typed questions and answers as chat bubbles, and
 * showed Aria's VOICE as a single truncated caption that was overwritten by the next line. A
 * student who answered by speaking saw their answer vanish, and one who looked away missed what
 * she said. Now voice lines join the same transcript.
 *
 * The one subtlety is duplicates. Aria speaks the question that is already on screen as a bubble
 * (with its quick-answer chips); showing her spoken version as a second bubble would print every
 * question twice. So a spoken Aria line that is recognisably the open question is left out — the
 * bubble already says it — while everything else she says (acknowledgements, answers to the
 * student's own questions) is shown.
 *
 * Pure: no React. components/pages/LearnPage.tsx applies it.
 */

export type TranscriptRole = "aria" | "you";

export type TranscriptEntry = {
  role: TranscriptRole;
  text: string;
  /** Present on a question the student is being asked to answer. */
  isDiagnostic?: boolean;
};

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "you", "your", "do", "does", "what", "how", "with", "it", "this", "that", "be", "about", "would", "like"]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * True when a spoken line contains the question — most of the question's meaningful words appear
 * in it. Spoken lines usually wrap the question in an acknowledgement ("Got it. So, …"), so the
 * test is containment, not equality.
 */
export function speaksQuestion(spoken: string, question: string, threshold = 0.6): boolean {
  const wanted = new Set(contentWords(question));
  if (wanted.size === 0) return false;
  const said = new Set(contentWords(spoken));
  let hits = 0;
  for (const word of wanted) if (said.has(word)) hits += 1;
  return hits / wanted.size >= threshold;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Should this voice line be added to the transcript?
 *
 *   - The student's line: yes, unless it repeats the line just added (a typed answer can also come
 *     back as a transcription).
 *   - Aria's line: yes, unless it is her speaking one of the recent questions already shown.
 */
export function shouldAddVoiceLine(log: TranscriptEntry[], line: { role: TranscriptRole; text: string }): boolean {
  const text = line.text.trim();
  if (!text) return false;
  if (line.role === "you") {
    const lastYou = [...log].reverse().find((entry) => entry.role === "you");
    return !lastYou || normalise(lastYou.text) !== normalise(text);
  }
  const recentQuestions = log.filter((entry) => entry.role === "aria" && entry.isDiagnostic).slice(-3);
  return !recentQuestions.some((q) => speaksQuestion(text, q.text));
}

/** Aria's plan message in the chat: short enough to read at a glance, full plan is on the page. */
export function planMessage(subtopicTitles: string[], learnerSummary: string): string {
  const who = learnerSummary.trim() ? `Here's what I understood about you: ${learnerSummary.trim()}. ` : "";
  const shown = subtopicTitles
    .slice(0, 6)
    .map((title, i) => `${i + 1}. ${title.trim().replace(/[.;,:]+$/, "")}`)
    .join("; ");
  const more = subtopicTitles.length > 6 ? `; and ${subtopicTitles.length - 6} more` : "";
  const list = `${shown}${more}`;
  const end = /[?!]$/.test(list) ? "" : ".";
  return `${who}Here's the plan I'd teach you — ${list}${end} Shall we start, or would you like to change or focus on something?`;
}

export const PLAN_CHOICES = {
  accept: "Accept and start",
  change: "Change something",
  focus: "Focus on…",
} as const;
