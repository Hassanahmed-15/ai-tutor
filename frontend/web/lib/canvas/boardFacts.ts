/**
 * WRONG TEXT ON A CLEAN BOARD (owner, 2026-10-25, on the bipartite check lecture: "U = {A, B}" while the
 * colours put more vertices in that set; "E = blue" while Aria said red). Two fixes that need no model call:
 *
 *   1. THE EXAMINER'S CORRECTION, APPLIED (applyExaminerFixes). The examiner quotes the wrong text and gives
 *      the right one; a board whose rewrite ran out of time shipped with the fault anyway. Now the quoted text
 *      is replaced on the board itself.
 *   2. NOTES THAT AGREE WITH THE DRAWING (alignNotesWithStructure). A note naming a vertex's colour or a
 *      set's members is checked against the structure at the sentence it appears on, and corrected from it —
 *      the drawing is the one thing that is stepped and checked by code.
 *
 * Pure: unit-tested in lib/anim/boardFacts.test.ts.
 */
import type { CanvasBoardSpec, DsOp, DsStart } from "./types";
import type { MathsProblem } from "./mathsCheck";
import { runStructure } from "./structure";
import { canvasSentences } from "./plan";

/** Notes the examiner corrected: the drawing check leaves them as the examiner wrote them. */
const examinerFixed = new WeakSet<object>();

const QUOTE = /[“"‘']([^“”"‘’']{3,80})[”"’']/g;
const TEXT_KEYS = new Set(["text", "label", "sub", "note", "detail", "caption", "title"]);
const quotes = (s: string) => [...s.matchAll(QUOTE)].map((m) => m[1].trim()).filter(Boolean);

/** The right text in an examiner's fix: its last quoted text, or the fix itself when it is short and not an instruction. */
function correctText(fix: string): string | null {
  const q = quotes(fix);
  if (q.length) return q[q.length - 1];
  const t = fix.trim().replace(/\.$/, "");
  return t && t.length <= 60 && !/\b(?:should|must|instead|replace|change|show|add|remove|draw|label)\b/i.test(t) ? t : null;
}

function walkText(node: unknown, visit: (obj: Record<string, unknown>, key: string, value: string) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkText(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && TEXT_KEYS.has(key)) visit(obj, key, value);
    else if (value && typeof value === "object") walkText(value, visit);
  }
}

/**
 * The examiner's board corrections, applied where the wrong text it quotes is on the board: "E = blue" with
 * the fix "It should read 'E = red'" becomes "E = red". Returns what was fixed and the faults it could not
 * place (those still need a rewrite).
 */
export function applyExaminerFixes(spec: CanvasBoardSpec, problems: MathsProblem[]): { fixed: number; left: MathsProblem[] } {
  let fixed = 0;
  const left: MathsProblem[] = [];
  for (const p of problems) {
    if (p.where !== "board") continue;
    const right = correctText(p.fix);
    const wrong = quotes(p.detail).filter((q) => q.length >= 3 && right && q !== right && !right.includes(q));
    let done = false;
    if (right) {
      walkText(spec, (obj, key, value) => {
        for (const w of wrong) {
          if (!value.includes(w)) continue;
          obj[key] = value === w ? right : value.split(w).join(right);
          // A typeset note is typeset again from its new words (lib/canvas/mathNotes.ts).
          if ("tex" in obj) delete obj.tex;
          examinerFixed.add(obj);
          done = true;
          return;
        }
      });
    }
    if (done) fixed++;
    else left.push(p);
  }
  return { fixed, left };
}

// The board draws Set A blue and Set B orange (CanvasPanel DS_LOOK): those words start as votes.
const SEED: Record<string, 0 | 1> = { blue: 0, "set a": 0, orange: 1, "set b": 1 };
const SINGLE = /^\s*([A-Za-z0-9]{1,4})\s*(?:=|:|→|->|is|in|gets|joins|goes to)\s*(?:the\s+)?((?:set|colou?r|group)?\s*[A-Za-z0-9]{1,12})\s*(?:set|group)?\s*$/i;
const LISTING = /^\s*(?:set\s+)?([A-Za-z0-9]{1,6})\s*[:=]\s*\{?\s*([A-Za-z0-9]{1,4}(?:\s*,\s*[A-Za-z0-9]{1,4})+|[A-Za-z0-9]{1,4})\s*\}?\s*$/i;
const norm = (w: string) => w.toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A two-coloured structure's notes, corrected from the drawing: a vertex's colour or set, and a set's
 * members, as the structure has them at the note's sentence. Only words the board's own notes tie to a set
 * (or the drawn blue/orange) are trusted; a note the examiner corrected is left alone.
 */
export function alignNotesWithStructure(spec: CanvasBoardSpec, script = ""): { fixed: number; log: string[] } {
  // When Aria says the same thing as the note ("C is coloured blue"), the note is right and the drawing is
  // wrong: the note is left alone (bipartite check lecture, board 5).
  const sentences = script ? canvasSentences(script) : [];
  const saidByAria = (s: number, ...words: string[]) => [s - 1, s, s + 1].some((i) => {
    const t = (sentences[i] ?? "").toLowerCase();
    return t && words.every((w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w.toLowerCase())}([^a-z0-9]|$)`).test(t));
  });
  const st = spec.stage;
  const start: DsStart | undefined = st.kind === "structure" || st.kind === "code" ? st.structure : undefined;
  const steps = (st.kind === "structure" || st.kind === "code" ? st.steps : []) as Array<{ s: number; ops?: DsOp[] }>;
  if (!start || !steps.some((x) => x.ops?.some((o) => o.op === "group"))) return { fixed: 0, log: [] };
  const { frames } = runStructure(start, steps);
  if (!frames.length) return { fixed: 0, log: [] };
  const idOf = (v: string) => frames[frames.length - 1].nodes.find((n) => n.value.toLowerCase() === v.toLowerCase())?.id;
  const valueOf = (id: string) => frames[frames.length - 1].nodes.find((n) => n.id === id)?.value ?? id;
  const frameAt = (s: number) => [...frames].reverse().find((f) => f.s <= s) ?? frames[0];
  // A vertex's set at the sentence, or — not yet coloured then — the first set it is given after.
  const groupOf = (id: string, s: number): 0 | 1 | undefined => frameAt(s).groups[id] ?? frames.find((f) => f.s >= s && f.groups[id] !== undefined)?.groups[id];

  type Claim = { note: (typeof spec.notes)[number]; kind: "single"; node: string; word: string } | { note: (typeof spec.notes)[number]; kind: "listing"; name: string; members: string[] };
  const claims: Claim[] = [];
  for (const note of spec.notes) {
    const one = SINGLE.exec(note.text);
    if (one && idOf(one[1])) { claims.push({ note, kind: "single", node: idOf(one[1])!, word: norm(one[2]) }); continue; }
    const many = LISTING.exec(note.text);
    if (many && !idOf(many[1])) {
      const members = many[2].split(/\s*,\s*/).map((v) => idOf(v)).filter((x): x is string => Boolean(x));
      if (members.length && members.length === many[2].split(/\s*,\s*/).length) claims.push({ note, kind: "listing", name: norm(many[1]), members });
    }
  }
  if (!claims.length) return { fixed: 0, log: [] };

  // Which set each word means on THIS board: the notes vote; the drawn colours break ties.
  const votes = new Map<string, [number, number]>();
  const vote = (w: string, g: 0 | 1, n = 1) => { const v = votes.get(w) ?? [0, 0]; v[g] += n; votes.set(w, v); };
  for (const [w, g] of Object.entries(SEED)) vote(w, g, 0.5);
  for (const c of claims) {
    if (c.kind === "single") { const g = groupOf(c.node, c.note.s); if (g !== undefined) vote(c.word, g); }
    else {
      const gs = c.members.map((m) => groupOf(m, c.note.s)).filter((g): g is 0 | 1 => g !== undefined);
      const zeros = gs.filter((g) => g === 0).length;
      if (gs.length) vote(c.name, zeros * 2 >= gs.length ? 0 : 1);
    }
  }
  const meaning = (w: string): 0 | 1 | undefined => { const v = votes.get(w); return !v || v[0] === v[1] ? undefined : v[0] > v[1] ? 0 : 1; };
  const wordFor = (g: 0 | 1, like: string) => {
    // The same kind of word the note used: another colour for a colour, another set name for a set.
    const used = claims.map((c) => (c.kind === "single" ? c.word : c.name)).filter((w) => meaning(w) === g);
    const sameKind = used.find((w) => /colou?r|set|group/.test(w) === /colou?r|set|group/.test(like));
    return sameKind ?? used[0] ?? (g === 0 ? "blue" : "orange");
  };

  let fixed = 0;
  const log: string[] = [];
  for (const c of claims) {
    if (examinerFixed.has(c.note)) continue;
    if (c.kind === "single") {
      const said = meaning(c.word);
      const actual = groupOf(c.node, c.note.s);
      if (said === undefined || actual === undefined || said === actual || saidByAria(c.note.s, valueOf(c.node), c.word)) continue;
      const right = wordFor(actual, c.word);
      const before = c.note.text;
      c.note.text = before.replace(new RegExp(escapeRe(c.word), "i"), right);
      if (c.note.text !== before) { fixed++; log.push(`"${before}" → "${c.note.text}"`); }
    } else {
      const g = meaning(c.name);
      if (g === undefined) continue;
      const frame = frameAt(c.note.s);
      const actual = frame.nodes.map((n) => n.id).filter((id) => frame.groups[id] === g);
      if (!actual.length || (actual.length === c.members.length && actual.every((id) => c.members.includes(id)))) continue;
      const before = c.note.text;
      const list = actual.map(valueOf).join(", ");
      c.note.text = /\{/.test(before) ? before.replace(/\{[^}]*\}/, `{${list}}`) : before.replace(/([:=]\s*).*$/, `$1${list}`);
      if (c.note.text !== before) { fixed++; log.push(`"${before}" → "${c.note.text}"`); }
    }
    delete (c.note as { tex?: string }).tex;
  }
  return { fixed, log };
}
