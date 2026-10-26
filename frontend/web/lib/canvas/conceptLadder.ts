import type { PartReading } from "../learnerProfile";

/**
 * THE CONCEPT LADDER (owner, 2026-10-20): "if I don't know a topic I want to learn it from scratch,
 * from the very basics, the concept built step by step in a very structured way". The intake
 * (lib/intake.ts) tells Aria, part by part, what the student already knows. Here that becomes the
 * lesson's structure:
 *
 *   NEW part   → built from scratch over 2 to 4 boards that climb the ladder below;
 *   SHAKY part → the same ladder, shorter: 1 to 2 boards;
 *   KNOWN part → no board: a one-line recap opens the part that builds on it.
 *
 * The rungs are what the instructional-design research agrees on (Merrill's first principles,
 * Mayer's pre-training, Reigeluth's simple-to-complex, concreteness fading, refutation of the common
 * mistake): a reason to care, the new words first, the simplest concrete case, the name, the
 * mechanism in small steps, a worked example, the common mistake, and a link to what comes next.
 *
 * Pure text and arithmetic: the outline planner reads ladderOutlineInstruction, the canvas planner
 * ladderCanvasSection and ladderBoardBudget.
 */

export type PartStatus = PartReading["status"];
export type LadderPart = { title: string; caption?: string; status?: PartStatus };

/** Boards each kind of part may take. */
export const LADDER_BOARDS: Record<PartStatus, { min: number; max: number }> = {
  new: { min: 2, max: 3 },
  shaky: { min: 1, max: 2 },
  known: { min: 0, max: 0 },
};

/** True when the parts carry the student's statuses: the lesson is built on the ladder. */
export function isLadder(parts: LadderPart[] | undefined): boolean {
  return Boolean(parts?.length && parts.some((p) => p.status));
}

/** A beginner's map board opens the lesson when two or more parts are built from scratch. */
export function wantsMap(parts: LadderPart[]): boolean {
  return parts.filter((p) => (p.status ?? "new") === "new").length >= 2;
}

/**
 * A typed computer-science lesson's ladder (lib/canvas/csLessons.ts): one or two boards a new part,
 * ten at most. Six new parts of Kahn's algorithm at two to three boards each ran to 18 boards, the
 * full trace told twice (CS test, 2026-10-23).
 */
export const COMPACT_LADDER_BOARDS: Record<PartStatus, { min: number; max: number }> = {
  new: { min: 1, max: 2 },
  shaky: { min: 1, max: 1 },
  known: { min: 0, max: 0 },
};
export const COMPACT_LADDER_MAX = 10;

/** The fewest and most boards the ladder allows for these parts (the map board included). */
export function ladderBoardBudget(parts: LadderPart[], compact = false): { min: number; max: number } {
  const table = compact ? COMPACT_LADDER_BOARDS : LADDER_BOARDS;
  const map = wantsMap(parts) ? 1 : 0;
  const sum = (k: "min" | "max") => parts.reduce((n, p) => n + table[p.status ?? "new"][k], 0);
  const min = Math.max(1, sum("min") + map);
  const max = Math.max(1, sum("max") + map);
  return compact ? { min: Math.min(min, COMPACT_LADDER_MAX), max: Math.min(max, COMPACT_LADDER_MAX) } : { min, max };
}

const WORD: Record<PartStatus, string> = {
  new: "NEW: build it from scratch",
  shaky: "SHAKY: they half know it, build it again properly",
  known: "KNOWN: one-line recap only",
};

/**
 * For the outline planner: plan the subtopics FROM the student's parts, in their order, each with
 * its status. Overrides the learner lines above it about skipping what they know: a known part
 * keeps its place, as the recap the next part stands on.
 */
export function ladderOutlineInstruction(parts: PartReading[]): string {
  if (!parts.length) return "";
  return `\n\nTHE STUDENT'S PARTS OF THIS TOPIC, in teaching order (they marked what they know; "known" was confirmed by a basic check):\n${parts.map((p, i) => `${i + 1}. ${p.label}: ${WORD[p.status]}`).join("\n")}\nPlan the subtopics FROM these parts, in this order: one subtopic per part, titled for it in the topic's proper terms, its caption saying what that part teaches, and "status" copied from its line ("new", "shaky" or "known"). Never drop a part and never merge two. A subtopic that combines others (the overall equation, the whole process in one line) comes AFTER the parts it combines. The parts ARE the outline: add a subtopic (status "new") only where the syllabus checklist or the document needs a point none of the parts covers (at most two otherwise), placed where it belongs in the order. A known part keeps its place: the lesson recaps it in one line where the next part needs it. Every subtopic object carries "status". This overrides any rule above about leaving out what the student already knows.`;
}

/**
 * For the canvas planner: how the boards climb the ladder, part by part. Replaces the "one board per
 * part" outline block and the rules against hook boards.
 */
export function ladderCanvasSection(parts: LadderPart[], compact = false): string[] {
  const budget = ladderBoardBudget(parts, compact);
  const table = compact ? COMPACT_LADDER_BOARDS : LADDER_BOARDS;
  const map = wantsMap(parts);
  const lines = [
    "",
    `THE CONCEPT LADDER: this student told Aria, part by part, what they already know. Build what they do not know FROM SCRATCH, step by step, in a structured way: ${budget.min} to ${budget.max} boards in all, ids b1 onward, the parts in this order (teach exactly these parts, nothing beyond them):`,
    ...parts.map((p, i) => `P${i + 1}. ${p.title}${p.caption ? `: ${p.caption}` : ""} [${WORD[p.status ?? "new"]}${(p.status ?? "new") === "known" ? ", no board" : `, ${table[p.status ?? "new"].min} to ${table[p.status ?? "new"].max} board${table[p.status ?? "new"].max === 1 ? "" : "s"}`}]`),
  ];
  if (map) lines.push(`- b1 is THE MAP: the whole topic's parts as a flow in teaching order, with the known parts marked as known. Its script names each part with the everyday question it answers ("where does the plant get its raw materials?"), and says which parts Aria will build from scratch. No facts, no equation, no terms, no definitions: it explains nothing yet.`);
  lines.push(
    "- A NEW part is built over consecutive boards that climb these rungs IN ORDER, never skipping one the part needs and never going back down:",
    "  1. WHY IT MATTERS: open with one puzzle, surprising fact or everyday question the part answers (one or two sentences).",
    "  2. THE NEW WORDS: only the two to four new words the explanation will use, each said with what it is and drawn on the board, before they are used.",
    "  3. THE SIMPLEST CASE: one concrete, everyday instance of the idea, with no jargon yet.",
    "  4. NAME IT: the term in one exact sentence that maps back to the case, plus one thing it is NOT, so its edges are clear. An analogy only with where it breaks.",
    "  5. HOW IT WORKS: three to five small steps, one step per sentence, each drawn as it is said.",
    "  6. WORKED EXAMPLE: one fully worked case, every step shown.",
    "  7. THE COMMON MISTAKE: only when a well-known one exists: say it, say why it is wrong, say what is true.",
    "  8. CONNECT: one sentence that sums the part up and raises what the next part answers.",
    compact
      ? "  Rungs 1 to 6 share the part's board (rung 1 in a sentence, rung 3 folded into the worked example); only a part with a long mechanism or a long trace takes a second board. The full worked trace is told ONCE in the lesson, never again in a later part."
      : "  Rungs 1 to 4 share the part's first board; rungs 5 to 8 its second board. Only a part with a long mechanism or a hard worked example takes a third board.",
    "- A SHAKY part climbs the same ladder in one or two boards: rung 1 in a sentence, then rungs 4, 5, 6 and 7.",
    "- A KNOWN part gets NO board of its own: one sentence recapping it (\"You already know that …\") opens the first board of the part that builds on it, as its stepping stone. It is never explained again.",
    "- Each board's title says WHAT it teaches, as a noun phrase (\"Chlorophyll traps light\", \"How a model memorises noise\"), never the name of a rung (never \"the new words\", \"worked example\", \"how it works\").",
    "THE WHOLE LESSON (an independent structure audit found each of these broken, 2026-10-20):",
    "- NO WORD BEFORE ITS BOARD: a term is used only on or after the board that teaches it. A sentence that needs something a later part teaches says it in everyday words (\"the green stuff in leaves\"), never by its term. Check every sentence of every board against this.",
    "- COMBINED THINGS COME LAST: an overall equation, a summary formula or the whole process in one line is taught AFTER the parts it combines (the equation after the raw materials, the light, the pigment and the products), even when the outline mentions it first.",
    "- EVERY PART IS BUILT, NONE IS LISTED: a later part climbs its rungs as fully as the first; a part is never a list of facts.",
    "- EVERY PART LEADS ON: the last sentence of a part's last board raises the question the next part answers.",
    "- NOTHING TWICE: a board never restates what an earlier board said (refer back in half a sentence at most); every new word is defined once. No closing board restates the lesson.",
    "- This ladder REPLACES the rules above about one board per part and about never adding a hook or check board: follow it.",
  );
  return lines;
}

/**
 * A STRICT PDF on the ladder: there is no outline, so the planner reads the student's parts here.
 * Every page is still taught and only what the pages say: the ladder decides how deep each part
 * goes, and its rungs are climbed with the pages' own words, examples and figures.
 */
export function strictLadderSection(parts: PartReading[]): string[] {
  if (!parts.length) return [];
  return [
    "",
    `THE STUDENT'S PARTS OF THESE PAGES, in order (they marked what they know; "known" was confirmed by a basic check from the pages):`,
    ...parts.map((p, i) => `P${i + 1}. ${p.label}: ${WORD[p.status]}`),
    "HOW DEEP EACH PART GOES (every page is still taught, and only what the pages say):",
    "- A NEW part is built from scratch over 2 to 4 boards, climbing these rungs in order with the pages' OWN words, examples and figures, never outside facts: why it matters (only if the pages give a reason); the new words (the pages' own terms, each with what the pages say it is, before it is used); the simplest case (the pages' own simplest example); name it; how it works, step by step, one step per sentence; the pages' worked example; a mistake only where the pages warn of one.",
    "- A SHAKY part climbs the same rungs in 1 to 2 boards.",
    "- A KNOWN part: two or three sentences recapping what its pages say, on the first board of the part that builds on it (or one short board of two or three sentences when none does), naming its pages. Never skipped: every page is taught. Never re-taught.",
    ...(parts.filter((p) => p.status === "new").length >= 2 ? ["- b1 is THE MAP: the pages' parts as a flow, in order, each named with the everyday question it answers, the known ones marked as known. No facts or terms yet."] : []),
    "- NO WORD BEFORE ITS BOARD: a term from a later part is said in everyday words until its board teaches it. COMBINED THINGS COME LAST: an overall equation comes after the parts it combines. EVERY PART LEADS ON: its last sentence raises what the next part answers. NOTHING TWICE: no board restates an earlier one.",
  ];
}

/**
 * THE STATUSES ARE ATTACHED BY CODE (A/B bench, 2026-10-20): asked to copy each part's status, the
 * outline planner did so in one plan of four, so the ladder never switched on for the other three
 * and a beginner got the same flat lesson as a student who knew most of it. Each subtopic keeps the
 * status the planner gave it; otherwise it takes the status of the student's part it shares the
 * most words with, and one matching no part is new. And the outline stays on the student's parts:
 * without a syllabus or document to cover, at most two subtopics beyond them (one plan grew five
 * parts into fifteen, and the ladder made that 32 boards).
 */
export function withPartStatuses<T extends { title: string; caption: string; status?: PartStatus }>(subtopics: T[], parts: PartReading[], opts: { keepAll?: boolean } = {}): T[] {
  if (!parts.length) return subtopics;
  const stems = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(ies|es|s|ing|ed)$/, "").slice(0, 6)).filter((w) => w.length >= 4 && !COMMON.has(w)));
  const partStems = parts.map((p) => stems(p.label));
  // ONE-TO-ONE: each of the student's parts claims the one subtopic that matches it best (title
  // words count double). A part named only by the topic's own word ("Overfitting") matched every
  // subtopic that mentioned it, so nothing was trimmed and statuses spread (A/B bench, 2026-10-20).
  const pairs: Array<{ si: number; pi: number; score: number }> = [];
  subtopics.forEach((s, si) => {
    const title = stems(s.title);
    const all = stems(`${s.title} ${s.caption}`);
    partStems.forEach((ps, pi) => {
      if (!ps.size) return;
      const hits = [...ps].filter((w) => all.has(w)).length;
      if (hits / ps.size < 0.5) return;
      pairs.push({ si, pi, score: hits + [...ps].filter((w) => title.has(w)).length });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.si - b.si);
  const partOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const { si, pi } of pairs) {
    if (partOf.has(si) || taken.has(pi)) continue;
    partOf.set(si, pi);
    taken.add(pi);
  }
  // Kept: the subtopics that are the student's parts, and at most two others, in order. The planner
  // marks the extras it adds "new" too, so its own status decides nothing here.
  let extra = 0;
  return subtopics
    .map((s, si) => ({ s, best: partOf.get(si) ?? -1 }))
    .filter((m) => opts.keepAll || m.best >= 0 || extra++ < 2)
    .map(({ s, best }) => ({ ...s, status: best >= 0 ? parts[best].status : s.status ?? "new" }));
}
const COMMON = new Set(["what", "this", "that", "with", "from", "their", "they", "them", "into", "about", "makes", "make", "work", "works", "role", "part", "parts", "basic", "basics", "using", "used", "learn", "explain", "underst", "introd"]);
