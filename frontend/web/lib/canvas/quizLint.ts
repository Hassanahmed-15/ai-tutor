import { checkNumbers } from "./numberCheck";
import type { CanvasInteraction, QuizInteraction } from "./types";

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
  if (options.some((o) => /\b(all|none) of the above\b|^(both|neither|all of these|none of these)( of (these|them))?\.?$|^(both|neither)( of the)? (descriptions?|statements?|options?|answers?|claims?|views?)( (is|are))? (correct|right|true|wrong)\.?$|^the (first|second) (description|statement|option|claim) is (correct|right|true)\.?$/i.test(o.text.trim()))) issues.push(`no "all/none of the above" or bare "both"/"neither" options`);
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
  // A yes/no card is answered by the way it is asked ("Would one attainment pattern represent every
  // student?", audit 2026-10-16): ask for a choice between specific outcomes instead.
  if (options.filter((o) => /^(yes|no|sí|si|oui|non|ja|nein|ہاں|جی ہاں|نہیں|جی نہیں|نعم|لا)(?=[\s:;،؛,.!—–-]|$)/i.test(o.text.trim())).length >= 2) issues.push("a yes/no question is answered by how it is asked — ask the student to choose between specific outcomes, each option a real answer (not Yes/No)");
  // The card is read on its own after the narration: it names what it is about, never "that pattern",
  // "the same plot" or "instead" (audit 2026-10-16: "Is commercial, shareware or open-source the strongest choice?").
  if (/\b(that|those|these|this|the same) (pattern|graph|plot|example|case|one|board|diagram|situation|cluster|idea|scenario|option|choice|company|student|patient|point|points|views|arguments|factors|results|ideas|examples|options|cases|statements)\b|\binstead\b|\bthe above\b|\bstrongest choice\b/i.test(interaction.question)) issues.push("the question must make sense on the card alone — name the case it is about instead of pointing back to the narration (\"that pattern\", \"instead\", \"the same plot\")");
  // An option is an answer, not its working: "ȳ=23, σy=8. Decoding gives ȳ = 3 + 4(5) = 23…" gave
  // itself away next to three bare answers (audit 2026-10-17).
  const explained = options.filter((o) => /(?<!\b(?:e\.g|i\.e|etc|vs))[.!?]\s+[A-Z(]/.test(o.text.trim()) || /\b(decoding gives|this gives|which gives|so the answer|working:)\b/i.test(o.text));
  if (explained.length) issues.push(`each option is a bare answer in one clause — no working or explanation inside an option: ${explained.map((o) => `"${o.text.slice(0, 50)}…"`).join(", ")}`);
  // A question that spells out its options, where the right one is a wrong one plus a qualifier
  // ("output alone or output plus acceptable quality?", "wholly valuable or valuable with
  // limitations?"), is answered by picking the fuller, hedged one (audit 2026-10-17). An honest
  // either/or ("an external cost or an external benefit?") is a fair question and stays.
  const asked = new Set(words(interaction.question).map(stem));
  const ABSOLUTE = /^(alone|only|just|wholly|whol|completely|complete|entirely|entire|always|never|purely|pure|solely|sole)$/;
  const spelled = options.filter((o) => { const w = words(o.text).map(stem); return w.length >= 2 && w.filter((x) => asked.has(x)).length / w.length >= 0.6; });
  const correct = options.find((o) => o.correct);
  if (correct && spelled.includes(correct)) {
    const has = new Set(words(correct.text).map(stem));
    const hedged = spelled.filter((o) => !o.correct).some((o) => {
      const core = words(o.text).map(stem).filter((w) => !ABSOLUTE.test(w));
      return core.length > 0 && core.every((w) => has.has(w)) && has.size > core.length;
    });
    if (hedged) issues.push(`the question lists its answers and the right one is a wrong one plus a qualifier ("${correct.text}") — a student picks the fuller-sounding option without knowing the idea; ask without naming the options`);
  }
  // Every wrong option must be about this board: it shares a word with the question, the board or the narration.
  const known = new Set(words(`${interaction.question} ${context}`).map(stem));
  // Options with fewer than two words to compare (numbers, symbols, "As zero") are judged by the number check instead.
  const offTopic = options.filter((o) => !o.correct && words(o.text).length >= 2 && !/\d|[=<>±−+→]|(^|\s)[a-zA-Zα-ω](\s|$)/.test(o.text) && !words(o.text).some((w) => known.has(stem(w))));
  if (offTopic.length) issues.push(`wrong options must be real misconceptions about this idea, not throwaways: ${offTopic.map((o) => `"${o.text}"`).join(", ")}`);
  return issues;
}

/** The longest option a "Check it" card shows (lib/canvas/checkCard.ts). */
export const OPTION_MAX = 60;

/** Code checks on a written card; the problems to fix, empty when it may be verified. */
export function checkCardIssues(card: QuizInteraction, script: string): string[] {
  const issues = [...quizIssues(card, script)];
  const long = card.options.filter((o) => o.text.length > OPTION_MAX);
  if (long.length) issues.push(`options must be at most ${OPTION_MAX} characters: ${long.map((o) => `"${o.text}"`).join(", ")}`);
  const right = card.options.find((o) => o.correct);
  const sums = checkNumbers([right?.text ?? "", ...card.options.map((o) => o.feedback)].join(" \n "));
  if (sums.length) issues.push(`wrong arithmetic: ${sums.map((n) => `${n.calculation} (it is ${Number(n.computed.toPrecision(6))})`).join("; ")}`);
  if (card.question.length > 220) issues.push("the question must be at most 220 characters");
  return issues;
}

