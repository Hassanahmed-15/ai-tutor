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
    return super.load(withSentences(spec));
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
