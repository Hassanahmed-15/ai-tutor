import type { CanvasInteraction } from "./types";

/**
 * QUIZ ITEM-WRITING FLAWS, CHECKED BY CODE. Rule-based detectors find more of the classic flaws than
 * a model judge does (arXiv 2307.08161: 91% vs 79%). An audited card offered "The participants'
 * birth dates after publication" as a wrong answer (2026-10-15): a throwaway option makes the
 * question a test of common sense, not of the idea. These are the flaws worth a retry.
 */
const STOP = new Set("the a an and or of to in on for with by as at from is are be that this which what will would does do if when it its they their them can more less than into only".split(" "));
const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length > 3 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/, "");

export function quizIssues(interaction: CanvasInteraction | undefined, context: string): string[] {
  if (interaction?.kind !== "quiz") return [];
  const issues: string[] = [];
  const options = interaction.options;
  // "Both x and a are positive" can be a real misconception; a bare "Both" or "None of the above" is not.
  if (options.some((o) => /\b(all|none) of the above\b|^(both|neither|all of these|none of these)( of (these|them))?\.?$/i.test(o.text.trim()))) issues.push(`no "all/none of the above" or bare "both"/"neither" options`);
  // Two options with the same words (one right, one wrong) make the card unanswerable.
  // Signs stay: "a ≈ −121" and "a ≈ +121" are different answers.
  const norm = (t: string) => t.toLowerCase().replace(/[−–]/g, "-").replace(/[^a-z0-9+\-.]+/g, " ").trim();
  if (new Set(options.map((o) => norm(o.text))).size < options.length) issues.push("two options say the same thing — every option must be different");
  // A card option is a short answer, not the narration's sentence (copied whole, it was cut off on the card).
  const long = options.filter((o) => o.text.length > 100);
  if (long.length) issues.push(`options must be short answers (at most 100 characters), not whole sentences: ${long.map((o) => `"${o.text.slice(0, 40)}…"`).join(", ")}`);
  const lengths = options.map((o) => o.text.length);
  const right = options.findIndex((o) => o.correct);
  const others = lengths.filter((_, i) => i !== right).sort((a, b) => a - b);
  const median = others[Math.floor(others.length / 2)] ?? 0;
  if (median > 0 && lengths[right] > median * 1.8 && lengths[right] - median > 25) issues.push("the correct option is much longer than the others — a student can spot it without knowing the idea; make the options similar in length");
  // Every wrong option must be about this board: it shares a word with the question, the board or the narration.
  const known = new Set(words(`${interaction.question} ${context}`).map(stem));
  // Options with fewer than two words to compare (numbers, symbols, "As zero") are judged by the number check instead.
  const offTopic = options.filter((o) => !o.correct && words(o.text).length >= 2 && !/\d|[=<>±−+→]|(^|\s)[a-zA-Zα-ω](\s|$)/.test(o.text) && !words(o.text).some((w) => known.has(stem(w))));
  if (offTopic.length) issues.push(`wrong options must be real misconceptions about this idea, not throwaways: ${offTopic.map((o) => `"${o.text}"`).join(", ")}`);
  return issues;
}
