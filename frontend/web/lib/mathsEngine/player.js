// Plays a scene spec like a teacher at a board: one sentence at a time, the pencil drawing what the
// sentence names, the working written on the right in matching colours, and an animation only
// where a step asks for one. All animations are the same few general moves (change a value,
// apply a transformation, move a point); none is written for a particular diagram.
import { Scene, INK, colour } from "./scene.js";
import { layoutAll, placeLabel, overlappingTexts } from "./labels.js";
import { lintSpec } from "./lint.js";
import { formatNumber } from "./expr.js";
import { expandSpec } from "./expand.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const WORDS_PER_SECOND = 2.2; // about 130 a minute, the pace of the exam channels students use

export class Player {
  constructor(ui) {
    this.ui = ui; // { boxId, wrap, pencil, working, say, caption, voice: () => bool }
    this.speed = 1;
    this.run = 0;
    this.board = null;
    this.scene = null;
    this.state = { done: false, step: -1, errors: [], warnings: [] };
  }

  /** Builds the board for a spec. Returns the checker's verdict; nothing plays if there are errors. */
  load(spec) {
    this.stop();
    try {
      spec = expandSpec(spec);
    } catch (err) {
      this.state = { done: false, step: -1, errors: [err.message], warnings: [], id: spec?.id };
      return this.state;
    }
    this.spec = spec;
    const verdict = lintSpec(spec);
    this.state = { done: false, step: -1, errors: [...verdict.errors], warnings: [...verdict.warnings], id: spec.id };
    if (this.board) JXG.JSXGraph.freeBoard(this.board);
    this.board = null;
    this.ui.working.replaceChildren();
    this.ui.pencil.style.opacity = 0;
    if (verdict.errors.length) return this.state;
    const bb = spec.board;
    this.board = JXG.JSXGraph.initBoard(this.ui.boxId, {
      boundingbox: [bb.x[0], bb.y[1], bb.x[1], bb.y[0]], keepaspectratio: bb.aspect !== "free",
      axis: false, grid: false, showCopyright: false, showNavigation: false, showInfobox: false,
      pan: { enabled: false }, zoom: { enabled: false }, renderer: "svg",
    });
    this.scene = new Scene(this.board, spec).build();
    if (this.scene.problems.length) this.state.errors.push(...this.scene.problems);
    else {
      this.layout();
      this.checkTypedAngles();
      this.checkTypedLengths();
    }
    return this.state;
  }

  /** Every element the lesson will ever show, in the order it appears, so labels can be laid out against the finished board. */
  layout() {
    const sc = this.scene;
    const els = [];
    const add = (list) => {
      for (const el of list) if (el && !els.includes(el)) els.push(el);
    };
    for (const st of this.spec.steps ?? []) {
      for (const ref of [].concat(st.draw ?? [])) {
        try {
          add(sc.itemsFor(ref));
        } catch {
          // Reported when the step runs.
        }
      }
      for (const id of [].concat(st.show ?? [])) add(sc.allElements(id));
      for (const a of [].concat(st.animate ?? [])) {
        for (const id of [].concat(a.show ?? [])) add(sc.allElements(id));
        if (a.transform) for (const [id, o] of sc.objs) if (o.imageOf === a.transform && !o.hidden) add(sc.allElements(id).filter((el) => !el.__label));
      }
    }
    layoutAll(this.board, sc, els, els.filter((el) => el.__label).map((el) => el.__label));
  }

  /**
   * A side labelled with a typed length ("8 cm", "6 km") must be that long on the board (one board
   * unit per unit of length), unless the board says "notToScale": true.
   */
  checkTypedLengths() {
    if (this.spec.board?.notToScale) return;
    const unitRe = /^\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|km)\s*$/;
    const check = (where, text, length) => {
      const m = unitRe.exec(String(text));
      if (!m || !Number.isFinite(length)) return;
      const said = Number(m[1]);
      if (Math.abs(length - said) > Math.max(0.02 * said, 0.01)) this.state.warnings.push(`${where}: the label says ${text} but the side drawn is ${length.toFixed(2)} long (set "notToScale" on the board if that is meant)`);
    };
    for (const d of this.spec.objects ?? []) {
      const o = this.scene.objs.get(d.id);
      if (!o) continue;
      if ((d.type === "segment" || d.type === "segment3") && typeof d.label === "string") {
        if (o.line3) {
          const { u } = o.line3();
          check(`object ${d.id}`, d.label, Math.hypot(...u));
        } else if (o.line) {
          const [a, b] = o.line();
          check(`object ${d.id}`, d.label, Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
      }
      if (d.type === "solid" && d.edgeLabels) {
        for (const [pair, text] of Object.entries(d.edgeLabels)) {
          const [n1, n2] = pair.length === 2 ? pair.split("") : pair.split(/[-,]/);
          const p = this.scene.objs.get(n1)?.pos3?.(), q = this.scene.objs.get(n2)?.pos3?.();
          if (p && q) check(`object ${d.id}.edgeLabels.${pair}`, text, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
        }
      }
    }
  }

  /** An angle labelled with a typed number ("30°", "1.2 rad") must be that size on the board. */
  checkTypedAngles() {
    for (const d of this.spec.objects ?? []) {
      if (!["angle", "angle3"].includes(d.type) || typeof d.label !== "string" || !d.points?.every((p) => typeof p === "string")) continue;
      const m = /^\s*(\d+(?:\.\d+)?)\s*(°|rad)\s*$/.exec(d.label);
      if (!m) continue;
      try {
        const actual = this.scene.ev(`angle(${d.points.join(",")})`);
        const said = m[2] === "rad" ? (Number(m[1]) * 180) / Math.PI : Number(m[1]);
        if (Math.abs(actual - said) > 0.6) this.state.warnings.push(`object ${d.id}: the label says ${d.label} but the angle drawn is ${actual.toFixed(1)}°`);
      } catch {
        // Points that cannot be measured are reported elsewhere.
      }
    }
  }

  stop() {
    this.run++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  // ── Low-level drawing ──────────────────────────────────────────────────────────────────────
  movePencil(x, y) {
    this.ui.pencil.style.transform = `translate(${x}px, ${y}px)`;
  }

  tween(ms, fn, my) {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        if (my !== this.run) return resolve();
        const t = Math.min(1, (now - start) / Math.max(1, ms));
        fn(t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  reveal(el) {
    el.setAttribute({ visible: true });
    this.board.update();
  }

  /** Lines and curves are traced; fills fade in after their outline; text is written left to right. */
  async drawEl(el, ms, my) {
    if (el.visPropCalc?.visible) return;
    this.reveal(el);
    if (el.__label && !el.__label.placed) placeLabel(this.board, this.scene, el.__label);
    const node = el.rendNode;
    if (!node) return;
    const wrap = this.ui.wrap.getBoundingClientRect();
    // Aria's board is zoomed by its camera: screen pixels back to the board's own (1 when unzoomed).
    const k = wrap.width / (this.ui.wrap.offsetWidth || wrap.width) || 1;
    const pencil = this.ui.pencil;
    if (el.elType === "text") {
      const r = node.getBoundingClientRect();
      node.style.clipPath = "inset(0 100% 0 0)";
      pencil.style.opacity = 1;
      await this.tween(ms, (t) => {
        node.style.clipPath = `inset(0 ${100 - t * 100}% 0 0)`;
        this.movePencil((r.left - wrap.left + r.width * t) / k, (r.top - wrap.top + r.height * 0.8) / k);
      }, my);
      node.style.clipPath = "";
      return;
    }
    if (el.elType === "point") {
      const c = el.coords.scrCoords;
      pencil.style.opacity = 1;
      this.movePencil(c[1], c[2]);
      node.style.opacity = 0;
      await this.tween(Math.min(ms, 300), (t) => (node.style.opacity = t), my);
      node.style.opacity = "";
      return;
    }
    if (typeof node.getTotalLength !== "function") return;
    let len = 0;
    try {
      len = node.getTotalLength();
    } catch {
      return;
    }
    const fill = el.visProp.fillopacity ?? 0;
    const fills = el.visProp.fillcolor && el.visProp.fillcolor !== "none" && fill > 0;
    const strokeShown = (el.visProp.strokeopacity ?? 1) > 0.02 && (el.visProp.strokewidth ?? 1) > 0;
    if (!len) return;
    const marker = node.getAttribute("marker-end");
    if (marker) node.removeAttribute("marker-end");
    if (fills) node.style.fillOpacity = 0;
    node.style.strokeDasharray = `${len} ${len}`;
    node.style.strokeDashoffset = len;
    pencil.style.opacity = 1;
    // A shape with no outline (shading) gets a quick pass of the pencil, then its fill.
    const traceMs = fills ? ms * (strokeShown ? 0.6 : 0.35) : ms;
    await this.tween(traceMs, (t) => {
      node.style.strokeDashoffset = len * (1 - t);
      const p = node.getPointAtLength(len * t);
      this.movePencil(p.x, p.y);
    }, my);
    node.style.strokeDasharray = "";
    node.style.strokeDashoffset = "";
    if (marker) node.setAttribute("marker-end", marker);
    if (fills) {
      await this.tween(ms - traceMs, (t) => (node.style.fillOpacity = fill * t), my);
      node.style.fillOpacity = "";
    }
  }

  weight(el) {
    if (el.__quick) return 0.06;
    if (el.__small) return 0.15;
    if (el.elType === "text") return 0.45;
    if (el.elType === "point") return 0.25;
    if (el.elType === "segment" && (el.visProp.strokewidth ?? 3) <= 2) return 0.12; // tick marks
    return 1;
  }

  async drawItems(refs, span, my) {
    const els = [];
    for (const ref of refs) {
      try {
        els.push(...this.scene.itemsFor(ref));
      } catch (err) {
        this.state.warnings.push(err.message);
      }
    }
    const todo = els.filter((el) => !el.visPropCalc?.visible);
    const total = todo.reduce((n, el) => n + this.weight(el), 0);
    for (const el of todo) await this.drawEl(el, (span * this.weight(el)) / Math.max(total, 0.001), my);
    this.ui.pencil.style.opacity = 0;
  }

  // ── The working on the right ───────────────────────────────────────────────────────────────
  /** "{=expr:2}" → a computed value; then "{cyan|text}" or "{@A|text}" (the colour of object A). */
  workLine(src) {
    const computed = String(src).replace(/\{=([^}:]+)(?::([^}]*))?\}/g, (_, e, fmt) => {
      try {
        return formatNumber(this.scene.ev(e), fmt);
      } catch {
        return "?";
      }
    });
    const div = document.createElement("div");
    div.className = "ln";
    const re = /\{(@?[\w.]+)\|([^}]*)\}|([^{]+|\{)/g;
    let m;
    while ((m = re.exec(computed))) {
      const span = document.createElement("span");
      span.textContent = m[2] ?? m[3];
      const key = m[1];
      span.style.color = key ? (key.startsWith("@") ? this.scene.objs.get(key.slice(1))?.color ?? INK.white : colour(key)) : INK.white;
      div.append(span);
    }
    return div;
  }

  async write(lines, ms, my) {
    const list = [].concat(lines ?? []);
    for (const src of list) {
      const div = this.workLine(src);
      this.ui.working.append(div);
      const spans = [...div.children];
      const full = spans.map((s) => s.textContent);
      spans.forEach((s) => (s.textContent = ""));
      const total = full.join("").length || 1;
      await this.tween(ms / list.length, (t) => {
        let left = Math.round(total * t);
        spans.forEach((s, i) => {
          const take = Math.max(0, Math.min(full[i].length, left));
          s.textContent = full[i].slice(0, take);
          left -= take;
        });
      }, my);
      this.ui.working.scrollTop = this.ui.working.scrollHeight;
    }
  }

  speak(text, my) {
    const ms = ((text.split(/\s+/).length / WORDS_PER_SECOND) * 1000) / this.speed;
    if (!this.ui.voice() || !("speechSynthesis" in window)) return sleep(ms);
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95 * this.speed;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      setTimeout(resolve, ms * 2.5 + 2000);
      void my;
    });
  }

  // ── Animations: three general moves ────────────────────────────────────────────────────────
  frame() {
    this.board.update();
    this.scene.tick();
  }

  async animate(a, my) {
    const ms = (a.ms ?? 3000) / this.speed;
    const sc = this.scene;
    // Anything the move needs on screen from its first frame.
    for (const id of [].concat(a.show ?? [])) for (const el of sc.allElements(id)) if (!el.__label) this.reveal(el);
    if (a.param !== undefined) {
      // Change a value: everything defined from it (a point on a curve, a tangent, a graph's
      // coefficients, an area's limit, a live label) follows.
      const legs = a.path ?? [a.to];
      let from = sc.params[a.param];
      for (const target of legs) {
        const to = sc.ev(target);
        const f0 = from;
        await this.tween(ms / legs.length, (t) => {
          sc.params[a.param] = f0 + (to - f0) * ease(t);
          this.frame();
        }, my);
        from = to;
      }
    } else if (a.transform !== undefined) {
      // Apply a transformation: the image starts on the original and moves to where it belongs;
      // the original stays behind as a faint "before".
      const tf = sc.transforms.get(a.transform);
      for (const id of [].concat(a.ghost ?? [])) for (const el of sc.allElements(id)) {
        el.setAttribute({ strokeOpacity: 0.28, fillOpacity: (el.visProp.fillopacity ?? 0) * 0.4 });
      }
      // The image appears on top of the original as the move starts (labels wait for their sentence).
      for (const [id, o] of sc.objs) {
        if (o.imageOf === a.transform && !o.hidden) for (const el of sc.allElements(id)) if (!el.__label) this.reveal(el);
      }
      tf.s = 0;
      await this.tween(ms, (t) => {
        tf.s = ease(t);
        this.frame();
      }, my);
      tf.s = 1;
      this.frame();
    } else if (a.move !== undefined) {
      // Move a point to a new place.
      const o = sc.objs.get(a.move);
      const state = o?.pos?.state;
      if (!state) return this.state.warnings.push(`"${a.move}" can't move: only a point given by "at" can`);
      const start = o.pos();
      const target = sc.pointRef(a.to)();
      await this.tween(ms, (t) => {
        const s = ease(t);
        state.p = [start[0] + (target[0] - start[0]) * s, start[1] + (target[1] - start[1]) * s];
        this.frame();
      }, my);
    }
  }

  async highlight(ids, my) {
    const els = ids.flatMap((id) => this.scene.allElements(id)).filter((el) => el.visPropCalc?.visible && el.rendNode && el.elType !== "text");
    await this.tween(900 / this.speed, (t) => {
      const k = 1 + Math.sin(Math.PI * t) * 1.2;
      for (const el of els) el.rendNode.style.strokeWidth = `${(el.visProp.strokewidth ?? 3) * k}px`;
    }, my);
    for (const el of els) el.rendNode.style.strokeWidth = "";
  }

  // ── A whole lesson ─────────────────────────────────────────────────────────────────────────
  async play() {
    if (this.state.errors.length) return this.state;
    this.load(this.spec);
    if (this.state.errors.length) return this.state;
    const my = ++this.run;
    const steps = this.spec.steps ?? [];
    for (let i = 0; i < steps.length; i++) {
      if (my !== this.run) return this.state;
      const st = steps[i];
      this.state.step = i;
      this.ui.say.textContent = st.say;
      this.ui.caption.classList.add("talking");
      const span = ((st.say.split(/\s+/).length / WORDS_PER_SECOND) * 1000) / this.speed;
      const speech = this.speak(st.say, my);
      const writing = this.write(st.write, Math.min(span * 0.9, 2600 / this.speed), my);
      if (st.set) {
        Object.assign(this.scene.params, Object.fromEntries(Object.entries(st.set).map(([k, v]) => [k, this.scene.ev(v)])));
        this.frame();
      }
      for (const id of [].concat(st.hide ?? [])) for (const el of this.scene.allElements(id)) el.setAttribute({ visible: false });
      // The pencil fits the drawing into the sentence (it never keeps her waiting long).
      const draws = [].concat(st.draw ?? []);
      await this.drawItems(draws, Math.max(span * 0.85, draws.length ? 700 / this.speed : 0), my);
      if (st.highlight) await this.highlight([].concat(st.highlight), my);
      const anims = (async () => {
        for (const a of [].concat(st.animate ?? [])) {
          // Labels that ride on something that moves are placed again where they end up.
          const before = new Map(this.scene.labels.map((lab) => [lab, lab.anchor().join()]));
          await this.animate(a, my);
          for (const lab of this.scene.labels) if (lab.el.visPropCalc?.visible && before.get(lab) !== lab.anchor().join()) placeLabel(this.board, this.scene, lab);
        }
      })();
      await Promise.all([speech, writing, anims]);
      this.ui.caption.classList.remove("talking");
      await sleep(350 / this.speed);
    }
    if (my === this.run) {
      const ov = overlappingTexts(this.board);
      if (ov.n) this.state.warnings.push(`${ov.n} pair(s) of texts overlap on the finished board: ${ov.pairs.map((p) => p.join(" / ")).join("; ")}`);
      this.state.done = true;
    }
    return this.state;
  }
}
