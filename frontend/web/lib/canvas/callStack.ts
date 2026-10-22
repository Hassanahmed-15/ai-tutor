import type { StackFrame } from "./types";

/**
 * THE CALL STACK OF A RECURSIVE FUNCTION, CHECKED AND NAMED (2026-10-20, from the Visuals Lab).
 *
 * A code board's steps may each carry `stack`: the calls still running after that step, first call
 * first. A real stack only grows by one call at a time and shrinks from the top, so consecutive
 * snapshots must each keep the calls below the top unchanged and either push one call, pop calls, or
 * just update what a call shows. A board whose stack breaks that is drawn as plain code — never a
 * stack that could not happen.
 *
 * Each call gets a stable id ("frame-1", "frame-2", …) in the order it was first made, so the pen can
 * point at it and a finished call stays on the board, crossed out, after it returns (Xie et al. 2018:
 * one table per call, crossed out on return — the student keeps the history).
 */

export const MAX_FRAMES = 6;

type Snap = { s: number; stack?: StackFrame[] };

/** Is this sequence of stack snapshots one a real program could make? */
export function stackIsConsistent(steps: Snap[]): boolean {
  const snaps = steps.filter((st) => st.stack);
  if (snaps.length < 2) return false;
  let prev: StackFrame[] = [];
  for (const { stack } of snaps) {
    const now = stack!;
    // One new call at a time (the first snapshot holds at most the program's first call).
    if (now.length > MAX_FRAMES || now.length > prev.length + 1) return false;
    // Up to the shorter stack's height the calls are the same ones: a push keeps every call below
    // it, a pop takes calls off the top only, and a same-depth step only changes what a call shows.
    for (let i = 0; i < Math.min(prev.length, now.length); i++) if (now[i].call !== prev[i].call) return false;
    prev = now;
  }
  return true;
}

export type StackView = {
  /** Every call ever made, in the order it was made (top of the board first). */
  frames: Array<{ id: string; call: string }>;
  /** What is running after each step: the calls by id, with what each shows then. */
  snaps: Array<{ s: number; active: Array<{ id: string; value?: string }> }>;
};

/** Ids and history for drawing; null when the board has no usable stack. */
export function stackView(steps: Snap[]): StackView | null {
  if (!stackIsConsistent(steps)) return null;
  const frames: StackView["frames"] = [];
  const snaps: StackView["snaps"] = [];
  let active: string[] = [];
  for (const st of steps) {
    if (!st.stack) continue;
    const ids = st.stack.map((f, depth) => {
      if (depth < active.length && frames.find((x) => x.id === active[depth])?.call === f.call) return active[depth];
      const id = `frame-${frames.length + 1}`;
      frames.push({ id, call: f.call });
      return id;
    });
    active = ids;
    snaps.push({ s: st.s, active: st.stack.map((f, depth) => ({ id: ids[depth], ...(f.value ? { value: f.value } : {}) })) });
  }
  return frames.length ? { frames, snaps } : null;
}

/** What the board shows at a sentence: each call, whether it is still running, and its latest value. */
export function stackAt(view: StackView, shownThrough: number): Array<{ id: string; call: string; value?: string; done: boolean; top: boolean }> {
  const reached = view.snaps.filter((sn) => sn.s <= shownThrough);
  if (!reached.length) return [];
  const now = reached[reached.length - 1];
  const live = new Set(now.active.map((a) => a.id));
  const last = new Map<string, string | undefined>();
  for (const sn of reached) for (const a of sn.active) last.set(a.id, a.value ?? last.get(a.id));
  const made = new Set(reached.flatMap((sn) => sn.active.map((a) => a.id)));
  const topId = now.active[now.active.length - 1]?.id;
  return view.frames.filter((f) => made.has(f.id)).map((f) => ({ id: f.id, call: f.call, value: last.get(f.id), done: !live.has(f.id), top: f.id === topId }));
}

/** The names of functions the listing defines that call themselves. */
export function recursiveFunctions(lines: string[]): string[] {
  const names: string[] = [];
  lines.forEach((line, i) => {
    const m = /^\s*(?:def|function|FUNCTION|PROCEDURE|func|fn)\s+([A-Za-z_]\w*)\s*\(/.exec(line) ?? /^\s*(?:[\w<>[\]]+\s+)+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{?\s*$/.exec(line);
    if (!m) return;
    const name = m[1];
    const indent = line.length - line.trimStart().length;
    for (const body of lines.slice(i + 1)) {
      if (body.trim() && body.length - body.trimStart().length <= indent && !/^\s*[}]/.test(body)) break;
      if (new RegExp(`\\b${name}\\s*\\(`).test(body)) { names.push(name); break; }
    }
  });
  return names;
}

/**
 * A board about the call stack of a recursive function must draw it: "Call stack: factorial(4)"
 * shipped as plain code with no stack (QA batch 3, 2026-10-21). Null when the board is fine.
 */
export function missingStackProblem(stage: { lines: string[]; steps: Array<{ stack?: unknown }>; structure?: unknown }, heading: string, script: string): string | null {
  if (stage.structure || stage.steps.some((st) => st.stack)) return null;
  if (!/\b(call stack|stack frames?|frames?|unwind\w*|calls? (?:wait|pile|return)|base case returns)\b/i.test(`${heading} ${script}`)) return null;
  const rec = recursiveFunctions(stage.lines);
  if (!rec.length) return null;
  return `this board teaches how ${rec[0]} calls itself, so draw its call stack: give every step a "stack" list of the calls still running (first call first, each with "call" and a short "value" such as "waits for 3 × ?" or "returns 6")`;
}
