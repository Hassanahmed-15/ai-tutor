// The maths-lab pencil engine driven by Aria's lecture clock instead of its own: each step carries the
// sentence it belongs to ("s"), and the board draws a step when Aria reaches that sentence, fitting the
// pencil into the sentence. Steps of sentences already passed (a jump, a replay, a finished board) are
// drawn at once. Aria writes the working herself, so a step's "write" lines are ignored here.
import { Player } from "./player.js";
import { placeLabel } from "./labels.js";
import { withSentences } from "./aria-spec.js";

const noop = { textContent: "", classList: { add() {}, remove() {} } };

export class AriaPencil extends Player {
  constructor(ui) {
    super({ ...ui, say: noop, caption: noop, working: document.createElement("div"), voice: () => false });
    this.drawn = -1;
    this.busy = Promise.resolve();
  }

  load(spec) {
    this.drawn = -1;
    const st = super.load(withSentences(spec));
    if (st.errors.length || !this.board) return st;
    // The scene's x and y ranges are the model's guess: a cuboid's top can fall off them. Everything the
    // lesson will show is measured once built, and the ranges are widened once to hold it with a margin.
    const fit = this.#extent();
    const bb = spec.board;
    if (fit && (fit.x0 < bb.x[0] || fit.x1 > bb.x[1] || fit.y0 < bb.y[0] || fit.y1 > bb.y[1])) {
      const mx = (fit.x1 - fit.x0) * 0.08 || 0.5, my = (fit.y1 - fit.y0) * 0.08 || 0.5;
      const board = { ...bb, x: [Math.min(bb.x[0], fit.x0 - mx), Math.max(bb.x[1], fit.x1 + mx)], y: [Math.min(bb.y[0], fit.y0 - my), Math.max(bb.y[1], fit.y1 + my)] };
      this.drawn = -1;
      return super.load(withSentences({ ...spec, board }));
    }
    return st;
  }

  /** Where every point and line of the scene lands (hidden ones too: they are drawn later), in board units. */
  #extent() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const take = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    };
    for (const el of this.board.objectsList ?? []) {
      if (el.elType === "text" || el.elType === "axis" || el.elType === "ticks" || el.elType === "grid") continue;
      try {
        if (el.elType === "point" || el.elType === "glider") take(el.X(), el.Y());
        else if (el.point1 && el.point2 && el.elType === "segment") { take(el.point1.X(), el.point1.Y()); take(el.point2.X(), el.point2.Y()); }
        else if (Array.isArray(el.vertices)) for (const v of el.vertices) take(v.X(), v.Y());
        else if (Array.isArray(el.points) && el.elType === "curve") for (const c of el.points) take(c.usrCoords[1], c.usrCoords[2]);
      } catch {
        // An element with nothing to measure.
      }
    }
    return Number.isFinite(x0) ? { x0, x1, y0, y1 } : null;
  }

  /** Draws every step up to sentence `s`; `msFor(s)` is how long that sentence is spoken. */
  stepTo(s, msFor, animate = true) {
    this.busy = this.busy.then(() => this.#stepTo(s, msFor, animate)).catch(() => {});
    return this.busy;
  }

  async #stepTo(s, msFor, animate) {
    const steps = this.spec?.steps ?? [];
    const my = this.run;
    for (let i = this.drawn + 1; i < steps.length; i++) {
      const at = Number.isInteger(steps[i].s) ? steps[i].s : i;
      if (at > s) break;
      this.drawn = i;
      const live = animate && at === s;
      // Several steps on one sentence share it.
      const shared = steps.filter((st, j) => j >= i && (Number.isInteger(st.s) ? st.s : j) === at).length || 1;
      await this.#step(steps[i], live ? (msFor(at) * 0.85) / shared : 0, my);
      if (my !== this.run) return;
    }
  }

  async #step(st, span, my) {
    const sc = this.scene;
    if (!sc) return;
    if (st.set) {
      Object.assign(sc.params, Object.fromEntries(Object.entries(st.set).map(([k, v]) => [k, sc.ev(v)])));
      this.frame();
    }
    for (const id of [].concat(st.hide ?? [])) for (const el of sc.allElements(id)) el.setAttribute({ visible: false });
    const draws = [].concat(st.draw ?? []);
    await this.drawItems(draws, span ? Math.max(span, 600) : 0, my);
    if (span && st.highlight) await this.highlight([].concat(st.highlight), my);
    // An animation at its own pace when live; straight to its end otherwise.
    const pace = this.speed;
    if (!span) this.speed = 1e6;
    try {
      for (const a of [].concat(st.animate ?? [])) {
        // Labels that ride on something that moves are placed again where they end up.
        const before = new Map(sc.labels.map((lab) => [lab, lab.anchor().join()]));
        await this.animate(a, my);
        for (const lab of sc.labels) if (lab.el.visPropCalc?.visible && before.get(lab) !== lab.anchor().join()) placeLabel(this.board, sc, lab);
      }
    } finally {
      this.speed = pace;
    }
  }

  destroy() {
    this.stop();
    if (this.board) JXG.JSXGraph.freeBoard(this.board);
    this.board = null;
  }
}
