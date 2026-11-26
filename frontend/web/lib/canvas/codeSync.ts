import { canvasSentences } from "./plan";
import { wordPositions } from "./blocks";
import type { CanvasBoardSpec } from "./types";

/**
 * NOTHING ON A CODE BOARD GOES UNSAID (owner's manager, a CS teacher, 2026-10-22: "it should explain
 * while it draws … nothing should be left on the board that is not being said"). A recorded recursion
 * lecture lit lines 1–5 of a six-line function on one sentence and never explained four of them.
 *
 * Every line that does something must be lit, on its own or with one neighbour, by the sentence that
 * explains it. The writer can fix that only when the narration has a sentence to spare — then it is a
 * fault; otherwise it is a note (the narration itself is the CS examiner's business). A board that runs
 * code also shows it working beside the code: variables, the call stack or the structure.
 */
const TRIVIAL = /^\s*(?:[{}()[\];,]*|else\s*:?|end\w*|pass|try\s*:|finally\s*:|\}\s*else\s*\{|(?:#|\/\/).*)\s*$/i;

export type CodeSyncFinding = { gate: "code-sync" | "code-sync-note"; message: string };

const STATEMENT = /^(?:if|elif|else|for|foreach|while|return|def|function|procedure|func|fn|sub|class|print|output|input|end\w*|repeat|until|do|then|import|from|let|var|const|try|except|catch|raise|throw|break|continue|pass|switch|case|call|declare|set|yield|await|async|public|private|static|void|int|float|string|bool|char|struct|new|delete|assert|next|loop|begin|endif|goto|go to|swap)\b/i;

/** A line of English standing in a listing: no operator, no call, no keyword — or a "label: words" line. */
export function proseLine(text: string): boolean {
  const t = text.trim();
  if (!t || /^(?:#|\/\/|--|\/\*|\*)/.test(t)) return false;
  // "push(stack, item): add item to top" — a signature followed by a description, not a body.
  if (/^[^:]*\)[^:=]*:\s*[A-Za-z]+(?:\s+[A-Za-z]+){2,}\s*$/.test(t)) return true;
  if (STATEMENT.test(t)) return false;
  // "known-node update: node.next = new", "search cost: inspect up to n nodes" — a label, then a fact.
  if (/^[A-Za-z][\w -]{2,}:\s+\S/.test(t) && !/^\w+\s*\(/.test(t)) return true;
  if (/[=←→<>(){}[\]+*/%]/.test(t)) return false;
  // Two words or more and nothing a program would write ("shift 7 right", "left side stays sorted").
  return (t.match(/[A-Za-z]{2,}/g) ?? []).length >= 2;
}

export function codeSyncIssues(spec: CanvasBoardSpec, script: string): CodeSyncFinding[] {
  const st = spec.stage;
  if (st.kind !== "code" || !st.lines.length) return [];
  const sentences = canvasSentences(script).length;
  const spare = Math.max(0, sentences - new Set(st.steps.map((s) => s.s)).size);
  const real = st.lines.map((text, i) => ({ text: text.trim(), n: i + 1 })).filter((l) => l.text && !TRIVIAL.test(l.text));
  const alone = new Set(st.steps.filter((s) => s.lines.length <= 2).flatMap((s) => s.lines));
  const lit = new Set(st.steps.flatMap((s) => s.lines));
  const out: CodeSyncFinding[] = [];
  const name = (l: { text: string; n: number }) => `${l.n} ("${l.text.slice(0, 36)}")`;
  const never = real.filter((l) => !lit.has(l.n));
  if (never.length) {
    out.push({ gate: never.length <= spare ? "code-sync" : "code-sync-note", message: `line${never.length > 1 ? "s" : ""} ${never.map(name).join(", ")} ${never.length > 1 ? "are" : "is"} on the board but never lit: give each its own step on the sentence that explains it` });
  }
  const lumped = real.filter((l) => lit.has(l.n) && !alone.has(l.n));
  if (lumped.length) {
    out.push({ gate: lumped.length <= spare ? "code-sync" : "code-sync-note", message: `line${lumped.length > 1 ? "s" : ""} ${lumped.map(name).join(", ")} ${lumped.length > 1 ? "are" : "is"} only ever lit in a block of three or more: light each on the sentence that explains it (one line, or two that form one statement)` });
  }
  // PROSE DRESSED AS CODE: "shift 7 right", "search cost: inspect up to n nodes" and "push(stack, item):
  // add item to top" stood on code boards as lines of the program (CS round, 2026-10-22).
  const prose = real.filter((l) => proseLine(l.text));
  if (prose.length) out.push({ gate: "code-sync", message: `line${prose.length > 1 ? "s" : ""} ${prose.map(name).join(", ")} ${prose.length > 1 ? "are descriptions" : "is a description"}, not code: write each as a real statement (an assignment, a call, a condition, a loop), or say it instead of writing it` });
  // ONE FUNCTION PER BOARD: three functions in fifteen lines, explained in five sentences, left most of
  // the board unexplained (linked list, BST and BFS edge-case boards).
  const defs = real.filter((l) => /^(?:def|function|procedure|func|fn|sub)\b/i.test(l.text)).length;
  if (defs >= 2 && sentences < real.length / 2) out.push({ gate: "code-sync", message: `this board shows ${defs} functions in ${real.length} lines for ${sentences} sentences: show only what its narration explains — one function, or just the lines this board adds or changes` });
  // A BODY IS INDENTED UNDER ITS LOOP, CONDITION OR FUNCTION: a heap sort in ten unindented lines read
  // as one flat list (CS round 4).
  const blocks = st.lines.filter((l) => /^\s*(?:for|foreach|while|if|elif|else|def|function|procedure|repeat)\b|:\s*$/i.test(l)).length;
  if (blocks && st.lines.length >= 4 && !st.lines.some((l) => /^\s+\S/.test(l))) out.push({ gate: "code-sync", message: "no line is indented: indent the body of each loop, condition and function under it (4 spaces a level), as the language writes it" });
  const runs = real.some((l) => /=|\w\s*\(|\bprint\b|\breturn\b/.test(l.text));
  const working = Boolean(st.structure) || Boolean(st.trace) || st.steps.some((s) => s.state?.length || s.stack?.length || s.ops?.length);
  if (runs && real.length >= 3 && !working) {
    out.push({ gate: "code-sync-note", message: "nothing beside the code shows it working: give the steps \"state\" (the variables after each line), \"stack\" (recursion) or a \"structure\" with \"ops\"" });
  }
  return out;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen"];
const KEYWORDS = new Set(["def", "function", "procedure", "if", "elif", "else", "while", "for", "in", "return", "and", "or", "not", "true", "false", "none", "null", "len", "range", "print", "the", "is", "of", "to", "then", "end", "each", "from", "do"]);
const INCREMENT = /\+=|\+\+|\b(\w+)\s*(?:=|←)\s*\1\s*\+\s*1\b/;
const DECREMENT = /-=|--|\b(\w+)\s*(?:=|←)\s*\1\s*-\s*1\b/;
/** What a line must contain to do what the verb right after "line N" says it does. */
const VERB_CODE: Array<[RegExp, RegExp]> = [
  [/^(?:sees|checks|tests|compares|determines|asks|confirms|decides)\b/, /\b(?:if|elif|while|until)\b/i],
  [/^returns?\b/, /\breturn\b/i],
  [/^(?:prints|outputs|displays)\b/, /\bprint\b|\boutput\b/i],
  [/^(?:increments|increases)\b/, INCREMENT],
  [/^(?:decrements|decreases)\b/, DECREMENT],
  [/^(?:appends|pushes)\b/, /append|push/i],
  [/^(?:pops|removes)\b/, /\bpop\b|\bremove\b|\bdel\b/i],
  [/^(?:loops|iterates|goes through|runs through|repeats)\b/, /\b(?:for|while|repeat)\b/i],
  [/^(?:defines|declares)\b/, /^\s*(?:def|function|procedure|class)\b/i],
  [/^(?:creates|sets|stores|assigns|initiali[sz]es|converts|computes|calculates|saves|records|updates|changes|moves)\b/, /(?<![=!<>])=(?!=)|←/],
];

/**
 * THE LINE ARIA NAMES IS THE LINE SHE MEANS, AND IT IS THE LINE LIT. The narration is written before the
 * code, so its line numbers can miss: "line 7 sees that the total is too large" while line 7 is the
 * return (CS round 4). The verb right after "line N" says what that line does; when line N cannot do it
 * and exactly one line can — narrowed by the code's names the clause mentions and, for a check, the
 * comparison it describes — the narration names that line. Either way the sentence lights the line it
 * names. Conservative: no clear single answer, no change. Returns the narration and how many it fixed.
 */
export function fixLineReferences(spec: CanvasBoardSpec, script: string): { script: string; fixed: number } {
  const st = spec.stage;
  if (st.kind !== "code" || !st.lines.length) return { script, fixed: 0 };
  const lineWords = st.lines.map((l) => (l.match(/[A-Za-z_]\w*/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !KEYWORDS.has(w) && w.length > 1));
  const sentences = canvasSentences(script);
  let fixed = 0;
  sentences.forEach((sentence, i) => {
    const refs = [...sentence.matchAll(/\b([Ll]ine) (\d+|[a-z]+)\b/g)].filter((m) => /^\d+$/.test(m[2]) || NUMBER_WORDS.includes(m[2].toLowerCase()));
    if (refs.length !== 1) return;
    let named = /^\d+$/.test(refs[0][2]) ? Number(refs[0][2]) : NUMBER_WORDS.indexOf(refs[0][2].toLowerCase());
    if (named < 1 || named > st.lines.length) return;
    const after = sentence.slice((refs[0].index ?? 0) + refs[0][0].length).trim().toLowerCase();
    const rule = VERB_CODE.find(([verb]) => verb.test(after));
    if (rule && !rule[1].test(st.lines[named - 1])) {
      const clause = after.split(/\band\b/)[0];
      const clauseWords = clause.match(/[a-z_]\w*/g) ?? [];
      const comparison = /too (?:large|big|high)|greater|larger|above/.test(clause) ? />/ : /too (?:small|low)|less than|smaller|below/.test(clause) ? /</ : /\bequal/.test(clause) ? /==/ : null;
      const fits = st.lines.map((l, k) => ({ n: k + 1, ok: rule[1].test(l) })).filter((c) => c.ok);
      const scored = fits.map((c) => ({ n: c.n, score: lineWords[c.n - 1].filter((w) => clauseWords.some((cw) => cw === w || (w.length >= 4 && cw.startsWith(w)))).length + (comparison && comparison.test(st.lines[c.n - 1]) ? 2 : 0) }));
      const best = Math.max(0, ...scored.map((c) => c.score));
      const top = scored.filter((c) => c.score === best);
      const pick = fits.length === 1 ? fits[0].n : top.length === 1 && best >= 1 ? top[0].n : 0;
      if (pick) {
        const word = /^\d+$/.test(refs[0][2]) ? String(pick) : NUMBER_WORDS[pick] ?? String(pick);
        sentences[i] = sentence.replace(refs[0][0], `${refs[0][1]} ${word}`);
        named = pick;
        fixed++;
      }
    }
    // The line she names is the line lit on that sentence.
    for (const step of st.steps) if (step.s === i && !step.lines.includes(named)) step.lines = [named];
  });
  return { script: fixed ? sentences.join(" ") : script, fixed };
}

/**
 * EACH STEP OF A TRACE WHEN SHE SAYS IT (sync QA, 2026-11-26). The binary-search board put its whole trace —
 * mid becomes 2, low becomes 3, mid becomes 3, found — on the sentence "Line 4 repeats the search while low is
 * less than or equal to high", and the card shows only a sentence's LAST step: the variables jumped to the end
 * state three sentences before "it starts with low 0 and high 4, computes mid 2, moves low to 3, then computes
 * mid 3 and returns 3". So, on a code board:
 *   - a step that changes a variable moves to where she says that name and value ("mid 2", "low to 3"), at that
 *     word's place in the sentence (s = sentence + fraction; the card, variables and structure read the
 *     sentence's progress), never earlier than it was written;
 *   - a step that changes nothing follows the step before it; the steps are then put in the order she says them
 *     and every step's variables rebuilt in that order, so nothing shows a value before she says it;
 *   - the sentence that names "line N" lights line N.
 * Pure. Returns how many steps moved or were relit.
 */
export function timeCodeSteps(spec: CanvasBoardSpec, script: string): { moved: number } {
  const st = spec.stage;
  if (st.kind !== "code" || st.steps.length < 2) return { moved: 0 };
  const sentences = canvasSentences(script);
  const words = sentences.map((sentence) => wordPositions(sentence));
  type Step = (typeof st.steps)[number];
  const valueOf = (step: Step | undefined, name: string) => step?.state?.find((v) => v.name === name)?.value;
  // What each step changes, against the step before it as written.
  const changes = st.steps.map((step, k) => (step.state ?? []).filter((v) => valueOf(st.steps[k - 1], v.name) !== v.value));
  const say = (v: string) => {
    const plain = v.toLowerCase().replace(/^["']|["']$/g, "");
    const n = Number(plain);
    return Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? [plain, NUMBER_WORDS[n]] : [plain];
  };
  // Where she first says `name … value` (the value within four words of the name), at or after `from`.
  const spoken = (change: { name: string; value: string }, from: number): number | null => {
    const name = change.name.toLowerCase();
    if (!/^[a-z_]\w*$/.test(name)) return null;
    const values = say(change.value);
    for (let j = Math.floor(from); j < words.length; j++) {
      const w = words[j];
      for (let i = 0; i < w.length; i++) {
        if (w[i].word !== name) continue;
        const hit = w.slice(i + 1, i + 5).find((x) => values.includes(x.word));
        if (hit && j + hit.at >= from) return j + Math.min(0.95, hit.at);
      }
    }
    return null;
  };
  let moved = 0;
  const timed = st.steps.map((step, k) => ({ step, k, s: step.s }));
  for (let k = 1; k < timed.length; k++) {
    const own = changes[k];
    // Said in its own sentence already: it stays.
    const j = Math.floor(st.steps[k].s);
    const saidHere = own.some((c) => {
      const at = spoken(c, j);
      return at !== null && Math.floor(at) === j;
    });
    if (own.length && !saidHere) {
      const at = own.map((c) => spoken(c, Math.max(st.steps[k].s, timed[k - 1].s))).filter((x): x is number => x !== null).sort((a, b) => a - b)[0];
      if (at !== undefined && at > timed[k].s) { timed[k].s = at; moved++; continue; }
    }
    // Nothing of its own said later: it keeps its sentence, or follows a step of its own sentence that moved on.
    if (!own.length && st.steps[k].s === st.steps[k - 1].s && timed[k - 1].s > timed[k].s) { timed[k].s = timed[k - 1].s + 0.01; moved++; }
  }
  if (moved) {
    timed.sort((a, b) => a.s - b.s || a.k - b.k);
    // Variables rebuilt in the order she says them: each step holds what came before plus its own changes.
    let state: Array<{ name: string; value: string }> = [];
    st.steps = timed.map(({ step, k, s }) => {
      if (step.state) {
        const next = [...state];
        for (const c of changes[k]) {
          const i = next.findIndex((v) => v.name === c.name);
          if (i >= 0) next[i] = c;
          else next.push(c);
        }
        // Nothing it did not change itself: a value it carries that no step before it set is from later on.
        state = next;
        return { ...step, s, state: next };
      }
      return { ...step, s };
    });
  }
  // The sentence that names one line lights it.
  sentences.forEach((sentence, i) => {
    const refs = [...sentence.matchAll(/\b[Ll]ine (\d+)\b/g)];
    if (refs.length !== 1) return;
    const named = Number(refs[0][1]);
    if (named < 1 || named > st.lines.length) return;
    const inSentence = st.steps.filter((step) => step.s >= i && step.s < i + 1);
    if (!inSentence.length) {
      // No step of its own (its step was the one that moved to when its value is said): one lights the line,
      // holding the variables as they stand.
      const before = st.steps.filter((step) => step.s < i).at(-1);
      const at = st.steps.findIndex((step) => step.s >= i + 1);
      const step = { s: i, lines: [named], ...(before?.state ? { state: before.state } : {}) };
      if (at < 0) st.steps.push(step);
      else st.steps.splice(at, 0, step);
      moved++;
      return;
    }
    if (inSentence.length === 1 && !inSentence[0].lines.includes(named)) {
      // Not a step of the trace (it changes nothing): a trace step's lines are what ran, not what she names.
      const before = st.steps[st.steps.indexOf(inSentence[0]) - 1];
      const changesSomething = (inSentence[0].state ?? []).some((v) => valueOf(before, v.name) !== v.value);
      if (!changesSomething) { inSentence[0].lines = [named]; moved++; }
    }
  });
  return { moved };
}
