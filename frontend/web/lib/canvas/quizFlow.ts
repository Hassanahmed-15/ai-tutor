/**
 * THE LESSON'S OWN QUESTIONS, ASKED FAIRLY (QA brief, 2026-11-28). Pure and client-safe; unit-tested in
 * lib/anim/quizFlow.test.ts.
 *
 * - `isThinkPrompt`: a sentence that asks the student to work something out ("Pause and think: …?",
 *   "Check yourself: …?"). Aria used to say the answer 0.05 s later; the player now waits before it.
 * - `veiledBlocks`: the pieces of a full board that give a quick question's answer away while its card
 *   is open (a "Check yourself" box, an answer reveal, a line that says the right option).
 * - `tapHotspots`: the tappable region of each part a tap card asks about — the part's whole drawn area,
 *   never smaller than a finger.
 */

import type { BoardBlock } from "./blocks";

/** The words that make a question an invitation to think, not a rhetorical one. */
const THINK = /\b(?:pause and think|stop and think|think about it|think it through|check yourself|ask yourself|quick check|test yourself|your turn|try (?:it|this|to answer)|can you (?:work out|say|tell|find|spot)|what do you think|predict|guess|before I tell you)\b/i;

/** A question the student is asked to answer in their head: the player leaves thinking time after it. */
export function isThinkPrompt(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (THINK.test(s)) return true;
  // "Think: which …?" / "Question: …?" — a labelled question.
  return /^(?:think|question|check)\s*[:—-]/i.test(s) && /[?؟]\s*$/.test(s);
}

/** The board sentence (0-based) a full board asks a "Check yourself" question in, if `s` is one. */
export function inCheckBlock(blocks: BoardBlock[] | undefined, s: number): boolean {
  return Boolean(blocks?.some((b) => (b.kind === "question" || (b.kind === "callout" && b.callout === "check")) && s >= b.s && s <= b.e));
}

/** Thinking time after a think prompt, at 1x (the owner asked for at least 4–5 s). */
export const THINK_MS = 5_000;

const STOP = new Set("the a an and or of to in on for with by as at from is are was were be been it its this that these those which what why how who when where than then so because not no more most less very can could would should will do does did has have had into over under about their there they them his her he she you your we our".split(" "));
const words = (s: string) => (s.toLowerCase().replace(/\*\*|\$/g, "").match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * The blocks to cover while a quick question is open: every "Check yourself" box and answer reveal (they
 * hold a question and its answer), and any other block that says most of the right answer. Only blocks
 * already on the board matter; the caller covers them until the student has answered.
 */
export function veiledBlocks(blocks: BoardBlock[] | undefined, correct: string): Set<string> {
  const out = new Set<string>();
  if (!blocks?.length) return out;
  const answer = [...new Set(words(correct))];
  blocks.forEach((b, i) => {
    if (b.kind === "answer_reveal" || b.kind === "question" || (b.kind === "callout" && b.callout === "check")) {
      out.add(b.id);
      // The line straight after a check box is where its answer is said ("The answer is 2 units of A.").
      const next = blocks[i + 1];
      if (next && (next.kind === "paragraph" || next.kind === "quote" || next.kind === "answer_reveal") && /\b(?:answer|because|so|therefore|it is|this is)\b/i.test(next.board_text)) out.add(next.id);
      return;
    }
    if (answer.length < 2 || b.kind === "heading" || b.kind === "image" || b.kind === "visual_ref") return;
    const have = new Set(words([b.board_text, ...(b.items ?? [])].join(" ")));
    const hit = answer.filter((w) => have.has(w)).length;
    if (hit / answer.length >= 0.75 && hit >= 2) out.add(b.id);
  });
  return out;
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Each asked part's tap area, in board units: the part's drawn region (its rect on the board, or a box
 * round its point), grown to at least `min` on each side and centred on the part. Where two areas would
 * overlap, both are trimmed back toward their own centres so a tap always means one part.
 */
export function tapHotspots(parts: Array<{ center?: { x: number; y: number } | null; region?: Rect | null }>, min: number, bounds?: Rect): Array<Rect | null> {
  const boxes = parts.map((p): Rect | null => {
    const r = p.region && p.region.w > 0 && p.region.h > 0 ? p.region : null;
    const c = p.center ?? (r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null);
    if (!c) return null;
    // A huge region (a whole picture) is no help to tap: the part's own neighbourhood is.
    const w = Math.max(min, Math.min(r?.w ?? 0, min * 3));
    const h = Math.max(min, Math.min(r?.h ?? 0, min * 3));
    let box = { x: c.x - w / 2, y: c.y - h / 2, w, h };
    if (bounds) {
      const x = Math.min(Math.max(box.x, bounds.x), bounds.x + bounds.w - box.w);
      const y = Math.min(Math.max(box.y, bounds.y), bounds.y + bounds.h - box.h);
      box = { ...box, x, y };
    }
    return box;
  });
  // Trim overlaps: split the shared band between the two, along the axis where they overlap least.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!a || !b) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox <= 0 || oy <= 0) continue;
      const floor = min * 0.6;
      if (ox <= oy) {
        const [l, r] = a.x <= b.x ? [a, b] : [b, a];
        const mid = (Math.max(l.x, r.x) + Math.min(l.x + l.w, r.x + r.w)) / 2;
        l.w = Math.max(floor, mid - l.x);
        const right = r.x + r.w;
        r.x = Math.min(mid, right - floor);
        r.w = right - r.x;
      } else {
        const [t, u] = a.y <= b.y ? [a, b] : [b, a];
        const mid = (Math.max(t.y, u.y) + Math.min(t.y + t.h, u.y + u.h)) / 2;
        t.h = Math.max(floor, mid - t.y);
        const bottom = u.y + u.h;
        u.y = Math.min(mid, bottom - floor);
        u.h = bottom - u.y;
      }
    }
  }
  return boxes;
}
