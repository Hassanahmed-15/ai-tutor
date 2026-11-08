// Step player: play / pause / next / prev / reset / speed over a template's steps. "Previous" and
// "reset" rebuild the scene and replay earlier steps instantly, so every state is exact.
import type { Board } from "./board";
import type { Step } from "../contract";

export type StepEvent =
  | { type: "step_started"; index: number; total: number; caption: string }
  | { type: "step_done"; index: number; total: number }
  | { type: "finished"; total: number };

export class StepPlayer {
  steps: Step[] = [];
  /** Number of steps applied so far. */
  index = 0;
  playing = false;
  private rebuild: () => Promise<void> = async () => {};
  private run = 0;
  private readonly board: Board;
  private readonly emit: (e: StepEvent) => void;

  constructor(board: Board, emit: (e: StepEvent) => void = () => {}) {
    this.board = board;
    this.emit = emit;
  }

  load(steps: Step[], rebuild: () => Promise<void>) {
    this.run++;
    this.playing = false;
    this.steps = steps;
    this.index = 0;
    this.rebuild = rebuild;
  }

  get total() { return this.steps.length; }
  get done() { return this.index >= this.steps.length; }

  async next(animate = !this.board.reducedMotion): Promise<boolean> {
    if (this.done) return false;
    const k = this.index;
    const s = this.steps[k];
    this.emit({ type: "step_started", index: k, total: this.total, caption: s.caption });
    this.board.caption(s.caption);
    await s.apply(this.board, { animate });
    this.index = k + 1;
    this.emit({ type: "step_done", index: k, total: this.total });
    if (this.done) this.emit({ type: "finished", total: this.total });
    return true;
  }

  /** Jump to the state after `count` steps (no animation). */
  async seek(count: number) {
    this.run++;
    this.playing = false;
    await this.rebuild();
    this.index = 0;
    const target = Math.max(0, Math.min(count, this.total));
    for (let k = 0; k < target; k++) await this.steps[k].apply(this.board, { animate: false });
    this.index = target;
    this.board.caption(target ? this.steps[target - 1].caption : "");
  }

  prev() { return this.seek(this.index - 1); }
  reset() { return this.seek(0); }

  async play(gapMs = 380) {
    if (this.playing) return;
    this.playing = true;
    const my = ++this.run;
    while (this.playing && my === this.run && !this.done) {
      await this.next();
      if (!this.done) await new Promise((r) => setTimeout(r, this.board.reducedMotion ? 0 : gapMs / Math.max(this.board.speed, 0.05)));
    }
    if (my === this.run) this.playing = false;
  }

  pause() { this.playing = false; }

  /** Show the final state at once (reduced motion, or "skip to the end"). */
  finish() { return this.seek(this.total); }
}
