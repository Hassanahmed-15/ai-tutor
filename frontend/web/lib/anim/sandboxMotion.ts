/**
 * MOTION ON THE BOARD — the Motion library (formerly Framer Motion) inside the animation sandbox.
 *
 * Boards are generated as MOTION BOARDS (see MOTION_BOARD_SIGNATURE below): the component receives
 * the narration clock (`sentence`, `sentenceProgress`) and reveals and animates every part itself —
 * `<motion.g initial={false} animate={reveal(2)} transition={REVEAL}>` appears when sentence 2 is
 * spoken, strokes draw with pathLength, parts glide and swell. Every target is still computed from
 * the clock and nothing loops, so a paused lesson freezes and the finished frame is deterministic
 * for the critics (prompt rules: MOTION_LIBRARY_BLOCK in lib/drawPrompt.ts).
 *
 * Boards saved before that take `({ progress })` and are revealed by the host timeline
 * (data-teach-*: handwriting, stroke tracing) exactly as they always were.
 *
 * TWO IMPLEMENTATIONS OF `motion`, ONE CONTRACT:
 *  - In the student's sandbox, the real library: public/sandbox/framer-motion.production.min.js
 *    (framer-motion 13.4.4 UMD, MIT — framer-motion.LICENSE.md beside it). It binds to the sandbox's
 *    global React 18 and is INLINED like React itself, because the opaque-origin iframe's CSP
 *    blocks every external script (see loadReactRuntime in ReactAnimationSandbox.tsx).
 *  - Everywhere Motion cannot run — the server-side critic/layout render (renderStaticFrame), and
 *    the sandbox if the library ever fails to load — `staticMotion`: each motion element renders
 *    as the plain SVG element it wraps, settled at its `animate` target. That is exactly the frame
 *    the student sees once Motion arrives, so the critic scores the board the student gets.
 *
 * The static transforms are written as a `transform` ATTRIBUTE, not CSS: resvg (the critic's
 * rasteriser) ignores CSS transforms entirely, so a CSS-transformed part would be scored where it
 * started, not where it ends. Scale and rotate pivot on the element's centre, as Motion's do on
 * SVG (transform-box: fill-box; transform-origin: 50% 50%); the centre is estimated from the
 * element's own geometry props, which is exact for circles/rects/lines and close for groups.
 *
 * ES5 source text, like ANIM_SANDBOX_RUNTIME, because the sandbox has no module loader.
 */

/** The vendored library, fetched once per page and inlined into each sandbox document. */
export const SANDBOX_MOTION_URL = "/sandbox/framer-motion.production.min.js";

export const STATIC_MOTION_SOURCE = `
  function staticMotion(React) {
    var MOTION_ONLY = { initial: 1, animate: 1, exit: 1, transition: 1, variants: 1, whileHover: 1, whileTap: 1,
      whileFocus: 1, whileDrag: 1, whileInView: 1, drag: 1, dragConstraints: 1, dragElastic: 1, dragMomentum: 1,
      layout: 1, layoutId: 1, custom: 1, inherit: 1, viewport: 1, onAnimationStart: 1, onAnimationComplete: 1, onUpdate: 1 };
    var TRANSFORM = { x: 1, y: 1, scale: 1, scaleX: 1, scaleY: 1, rotate: 1 };
    var PATH_ONLY = { pathLength: 1, pathOffset: 1, pathSpacing: 1 };
    function last(v) { return Array.isArray(v) ? v[v.length - 1] : v; }
    function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

    function add(box, x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
    }
    function addPairs(box, text) {
      var n = String(text || "").match(/-?\\d*\\.?\\d+(?:e-?\\d+)?/gi) || [];
      for (var i = 0; i + 1 < n.length; i += 2) add(box, parseFloat(n[i]), parseFloat(n[i + 1]));
    }
    function walk(tag, p, box, depth) {
      if (!p || depth > 8) return;
      if (tag === "circle" || tag === "ellipse") {
        var rx = num(p.rx != null ? p.rx : p.r), ry = num(p.ry != null ? p.ry : p.r);
        add(box, num(p.cx) - rx, num(p.cy) - ry); add(box, num(p.cx) + rx, num(p.cy) + ry);
      } else if (tag === "rect" || tag === "image" || tag === "use") {
        add(box, num(p.x), num(p.y)); add(box, num(p.x) + num(p.width), num(p.y) + num(p.height));
      } else if (tag === "line") {
        add(box, num(p.x1), num(p.y1)); add(box, num(p.x2), num(p.y2));
      } else if (tag === "polygon" || tag === "polyline") {
        addPairs(box, p.points);
      } else if (tag === "path") {
        // Absolute commands only: relative ones are offsets, not points.
        if (typeof p.d === "string" && !/[a-df-y]/.test(p.d.replace(/e-?\\d/gi, ""))) addPairs(box, p.d.replace(/[A-Za-z]/g, " "));
      } else if (tag === "text") {
        add(box, num(p.x), num(p.y));
      }
      var kids = [].concat(p.children == null ? [] : p.children);
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (Array.isArray(kid)) { kids = kids.concat(kid); continue; }
        if (!kid || typeof kid !== "object" || !kid.props) continue;
        var kidTag = typeof kid.type === "string" ? kid.type : kid.type && kid.type.staticMotionTag;
        if (kidTag) walk(kidTag, kid.props, box, depth + 1);
      }
    }
    function centreOf(tag, props) {
      var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      walk(tag, props, box, 0);
      return isFinite(box.x0) ? [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2] : [0, 0];
    }

    function build(tag) {
      function StaticMotion(props) {
        var out = {};
        var style = props.style ? Object.assign({}, props.style) : null;
        var t = {};
        for (var key in props) if (!MOTION_ONLY[key] && key !== "style") out[key] = props[key];
        if (style) {
          for (var s in style) if (TRANSFORM[s] || PATH_ONLY[s]) { if (TRANSFORM[s]) t[s] = last(style[s]); delete style[s]; }
          out.style = style;
        }
        var anim = props.animate && typeof props.animate === "object" && !Array.isArray(props.animate) ? props.animate : null;
        if (anim) {
          for (var a in anim) {
            if (a === "transition" || PATH_ONLY[a]) continue;
            var v = last(anim[a]);
            if (TRANSFORM[a]) t[a] = v;
            else if (a === "attrX") out.x = v;
            else if (a === "attrY") out.y = v;
            else out[a] = v;
          }
        }
        var tx = num(t.x), ty = num(t.y), r = num(t.rotate);
        var sx = t.scaleX != null ? num(t.scaleX) : t.scale != null ? num(t.scale) : 1;
        var sy = t.scaleY != null ? num(t.scaleY) : t.scale != null ? num(t.scale) : 1;
        if (tx || ty || r || sx !== 1 || sy !== 1) {
          // Motion's order: translate, then rotate and scale about the element's centre. Like CSS
          // over an attribute in the browser, an animated transform replaces the authored one.
          var parts = [];
          if (tx || ty) parts.push("translate(" + tx + " " + ty + ")");
          if (r || sx !== 1 || sy !== 1) {
            var c = centreOf(tag, props);
            parts.push("translate(" + c[0] + " " + c[1] + ")");
            if (r) parts.push("rotate(" + r + ")");
            if (sx !== 1 || sy !== 1) parts.push("scale(" + sx + " " + sy + ")");
            parts.push("translate(" + -c[0] + " " + -c[1] + ")");
          }
          out.transform = parts.join(" ");
        }
        return React.createElement(tag, out);
      }
      StaticMotion.staticMotionTag = tag;
      return StaticMotion;
    }

    var cache = {};
    return new Proxy({}, {
      get: function (_, tag) {
        if (typeof tag !== "string") return undefined;
        return cache[tag] || (cache[tag] = build(tag));
      }
    });
  }
`;

/**
 * <BoardLabels labels={[{ text, x, y, sentence }]} sentence={sentence} sentenceProgress={sentenceProgress} side="right" />
 * (`side` is optional: without it each label takes the column on its point's side.)
 *
 * LABELS ARE LAID OUT BY THE HOST, NOT THE MODEL. Left to place its own labels a model printed two
 * 12 px apart ("residual" through "observed value"), ran leaders across the drawing, and relied on
 * the host's layout pass to rescue it — which only ran when the board was visible at mount, so in
 * the player the overlap stayed on screen (reported 2026-09-29). Now the model names a part and
 * gives a point ON it; this component places the words: each in the column on its point's side
 * (balanced), rows sorted by height and LABEL_GAP apart so no two leaders can cross, a leader from
 * the words to a dot on the part. Revealed on the label's sentence; highlighted while it is spoken.
 *
 * ES5 source, defined in the sandbox after `motion` and in the server render (static `motion`), so
 * the critics measure the very labels the student sees.
 */
export const BOARD_LABELS_SOURCE = `
  function BoardLabels(props) {
    var GAP = 40, TOP = 140, BOTTOM = 535, FONT = 20, MIN_FONT = 15;
    /*
     * WHAT IS ALREADY ON THE BOARD, measured once mounted (and again once the host's layout pass
     * has moved things): the drawing's horizontal extent, every word written on it, and every drawn
     * shape. Measured in the sandbox only — the server render has no layout, so there every listed
     * label is drawn, and the critics judge the board as the model wrote it.
     *
     * 2026-09-29, reported on real boards: a label "ReLU" whose dot sat on the letters of
     * "ReLU / sigmoid" already written in the box, and the column pushed into the "output" box beside
     * it. So, with the measurement:
     *  - a label repeating words the board already writes is dropped (it names nothing new);
     *  - a dot that lands on written letters moves just off them;
     *  - a label whose words would touch any drawn shape, written word or other label, on its own
     *    side or the other, is left out. A missing label costs less than one printed over the board.
     */
    var groupRef = React.useRef(null);
    var measureState = React.useState(null);
    var measured = measureState[0], setMeasured = measureState[1];
    React.useLayoutEffect(function () {
      function rootBox(svg, el) {
        var b = el.getBBox();
        var m = svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
        var xs = [b.x, b.x + b.width], ys = [b.y, b.y + b.height], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
          var px = m.a * xs[i] + m.c * ys[j] + m.e, py = m.b * xs[i] + m.d * ys[j] + m.f;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      function hiddenIn(el, svg) {
        for (var n = el; n && n !== svg; n = n.parentNode) {
          var tag = n.tagName;
          if (tag === "defs" || tag === "clipPath" || tag === "marker" || tag === "mask" || tag === "pattern") return true;
          if (n.getAttribute && (n.getAttribute("data-board-labels") || n.getAttribute("data-board-pen") || n.getAttribute("data-board-annotation"))) return true;
        }
        return false;
      }
      function measure() {
        try {
          var g = groupRef.current, svg = g && g.ownerSVGElement;
          if (!svg || typeof svg.getBBox !== "function") return;
          var width = 1000;
          var x0 = Infinity, x1 = -Infinity;
          Array.prototype.forEach.call(svg.children, function (el) {
            if (el === g || el.tagName === "defs" || el.tagName === "style" || typeof el.getBBox !== "function") return;
            var b = rootBox(svg, el);
            // The paper, a full-width band, and the title block are not the drawing.
            if (!b || b.w <= 0 || b.w > width * 0.9 || b.y + b.h < 125) return;
            x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.w);
          });
          var texts = [], shapes = [];
          Array.prototype.forEach.call(svg.querySelectorAll("text"), function (t) {
            if (hiddenIn(t, svg)) return;
            var words = (t.textContent || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            if (!words) return;
            var b = rootBox(svg, t);
            if (b.w > 0) texts.push({ words: words, box: b });
          });
          Array.prototype.forEach.call(svg.querySelectorAll("rect, circle, ellipse, path, polygon, polyline, line, image"), function (el) {
            if (hiddenIn(el, svg)) return;
            var b = rootBox(svg, el);
            if (b.w <= 0 && b.h <= 0) return;
            if (b.w > width * 0.9) return;
            shapes.push(b);
          });
          setMeasured({ x0: isFinite(x0) ? x0 : null, x1: isFinite(x1) ? x1 : null, texts: texts, shapes: shapes });
        } catch (e) {}
      }
      measure();
      // Again once the host's layout pass (lib/anim/sandboxLayout.ts) has moved and fitted words.
      var again = setTimeout(measure, 700);
      return function () { clearTimeout(again); };
    }, []);
    var sentence = typeof props.sentence === "number" ? props.sentence : 0;
    var within = typeof props.sentenceProgress === "number" ? props.sentenceProgress : 0;
    var leftX = typeof props.left === "number" ? props.left : 290;
    var rightX = typeof props.right === "number" ? props.right : 710;
    var mid = (leftX + rightX) / 2;
    // side="right" (or "left") sends every label to one column: the other holds the board's notes.
    var forced = props.side === "right" || props.side === "left" ? props.side : null;
    function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
    var placed = (props.labels || []).filter(function (l) {
      return l && typeof l.text === "string" && l.text.trim() && isFinite(l.x) && isFinite(l.y);
    }).slice(0, 6).map(function (l, i) {
      var k = Number(l.sentence);
      return { text: l.text.trim().slice(0, 40), x: Number(l.x), y: Number(l.y), k: isFinite(k) ? Math.max(0, Math.round(k)) : 0, side: forced || (Number(l.x) < mid ? "left" : "right"), i: i, ly: 0, hidden: false };
    });
    if (measured) {
      placed = placed.filter(function (p) {
        var words = " " + norm(p.text) + " ";
        return !measured.texts.some(function (t) { return (" " + t.words + " ").indexOf(words) >= 0; });
      });
      placed.forEach(function (p) {
        measured.texts.forEach(function (t) {
          var b = t.box;
          if (p.x > b.x - 3 && p.x < b.x + b.w + 3 && p.y > b.y - 3 && p.y < b.y + b.h + 3) p.y = p.y < b.y + b.h / 2 ? b.y - 6 : b.y + b.h + 6;
        });
      });
    }
    var limit = forced ? Infinity : Math.ceil(placed.length / 2) + 1;
    ["left", "right"].forEach(function (side) {
      var mine = placed.filter(function (p) { return p.side === side; })
        .sort(function (a, b) { return Math.abs(a.x - mid) - Math.abs(b.x - mid); });
      while (mine.length > limit) mine.shift().side = side === "left" ? "right" : "left";
    });
    function columnFor(side, col) {
      if (side === "left") return Math.min(leftX, col.length ? Math.min.apply(null, col.map(function (p) { return p.x; })) - 28 : leftX, measured && measured.x0 !== null ? measured.x0 - 16 : Infinity);
      return Math.max(rightX, col.length ? Math.max.apply(null, col.map(function (p) { return p.x; })) + 28 : rightX, measured && measured.x1 !== null ? measured.x1 + 16 : -Infinity);
    }
    function rowsFor(col) {
      var rows = col.map(function (p) { return Math.max(TOP, Math.min(BOTTOM, p.y)); });
      for (var a = 0; a < rows.length; a++) rows[a] = Math.max(rows[a], a ? rows[a - 1] + GAP : TOP);
      for (var b = rows.length - 1; b >= 0; b--) rows[b] = Math.min(rows[b], b < rows.length - 1 ? rows[b + 1] - GAP : BOTTOM);
      for (var c = 0; c < rows.length; c++) rows[c] = Math.max(rows[c], c ? rows[c - 1] + GAP : TOP);
      return rows;
    }
    var colX = { left: leftX, right: rightX };
    function layout() {
      ["left", "right"].forEach(function (side) {
        var col = placed.filter(function (p) { return p.side === side && !p.hidden; }).sort(function (a, b) { return a.y - b.y; });
        colX[side] = columnFor(side, col);
        var rows = rowsFor(col);
        col.forEach(function (p, i) { p.ly = rows[i]; });
      });
    }
    function geometry(p) {
      var left = p.side === "left";
      var edge = left ? colX.left : colX.right;
      var textX = left ? edge - 10 : edge + 10;
      // One line, always: shrink (never below MIN_FONT) rather than let the host wrap it into the next row.
      var room = left ? textX - 56 : 1000 - 56 - textX;
      var size = Math.max(MIN_FONT, Math.min(FONT, Math.floor(room / Math.max(1, p.text.length * 0.5))));
      var w = p.text.length * 0.52 * size;
      return { left: left, edge: edge, textX: textX, size: size, fits: w <= room + 1, box: { x: left ? textX - w : textX, y: p.ly - size * 0.8, w: w, h: size * 1.1 } };
    }
    function clashes(p) {
      if (!measured) return false;
      var g = geometry(p);
      if (!g.fits) return true;
      var b = g.box, pad = 4;
      function hit(o) { return b.x < o.x + o.w + pad && o.x < b.x + b.w + pad && b.y < o.y + o.h + pad && o.y < b.y + b.h + pad; }
      if (measured.texts.some(function (t) { return hit(t.box); })) return true;
      if (measured.shapes.some(hit)) return true;
      // Its leader may cross drawn lines, but never written words.
      var elbow = g.left ? Math.min(g.edge + 14, p.x) : Math.max(g.edge - 14, p.x);
      var legs = [[g.edge, p.ly, elbow, p.ly], [elbow, p.ly, p.x, p.y]];
      var throughWords = legs.some(function (leg) {
        var len = Math.hypot(leg[2] - leg[0], leg[3] - leg[1]), steps = Math.max(1, Math.ceil(len / 4));
        for (var i = 0; i <= steps - 2; i++) {
          var x = leg[0] + (leg[2] - leg[0]) * i / steps, y = leg[1] + (leg[3] - leg[1]) * i / steps;
          if (measured.texts.some(function (t) { var b = t.box; return x > b.x - 1 && x < b.x + b.w + 1 && y > b.y - 1 && y < b.y + b.h + 1; })) return true;
        }
        return false;
      });
      if (throughWords) return true;
      return placed.some(function (q) { return q !== p && !q.hidden && q.side === p.side && Math.abs(q.ly - p.ly) < GAP - 1; });
    }
    layout();
    if (measured) {
      placed.forEach(function (p) {
        if (!clashes(p)) return;
        // Its own side is blocked: the other column, if it is clear there; otherwise left out.
        p.side = p.side === "left" ? "right" : "left";
        layout();
        if (clashes(p)) { p.hidden = true; layout(); }
      });
    }
    var h = React.createElement;
    var REVEAL = { duration: 0.5, ease: "easeOut" };
    return h("g", { "data-board-labels": "1", ref: groupRef }, placed.filter(function (p) { return !p.hidden; }).map(function (p) {
      var on = sentence >= p.k, speaking = sentence === p.k;
      var g = geometry(p);
      var pillW = p.text.length * 0.55 * g.size + 26;
      var pillX = g.left ? g.textX - pillW + 13 : g.textX - 13;
      var d = "M" + g.edge.toFixed(1) + " " + p.ly.toFixed(1) + " L" + (g.left ? Math.min(g.edge + 14, p.x) : Math.max(g.edge - 14, p.x)).toFixed(1) + " " + p.ly.toFixed(1) + " L" + p.x.toFixed(1) + " " + p.y.toFixed(1);
      return h(motion.g, { key: "label-" + p.i, initial: false, animate: { opacity: on ? 1 : 0, y: on ? 0 : 6 }, transition: REVEAL },
        h(motion.rect, { x: pillX, y: p.ly - 17, width: pillW, height: 30, rx: 15, fill: "#fef3c7", initial: false, animate: { opacity: speaking ? 1 : 0 }, transition: { duration: 0.35 } }),
        h(motion.path, { d: d, fill: "none", stroke: "#475569", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", initial: false, animate: { pathLength: on ? 1 : 0 }, transition: { duration: 0.8, ease: "easeInOut" } }),
        h(motion.circle, { cx: p.x, cy: p.y, fill: "#ffffff", stroke: "#1e293b", strokeWidth: 2.2, initial: false, animate: { r: on ? 5 : 0 }, transition: { type: "spring", stiffness: 260, damping: 18 } }),
        h("text", { x: g.textX, y: p.ly + 7, fontSize: g.size, fontWeight: 600, fill: "#1e293b", textAnchor: g.left ? "end" : "start" }, p.text)
      );
    }));
  }
`;

/**
 * Declares `motion` for the generated component inside the sandbox: the real library when its
 * UMD loaded (it sets the `Motion` global), otherwise the static stand-in, so a board that cannot
 * get the library still renders — settled, not blank.
 */
export const SANDBOX_MOTION_RUNTIME = `${STATIC_MOTION_SOURCE}
  var motion = (typeof Motion !== "undefined" && Motion && Motion.motion) ? Motion.motion : staticMotion(React);
${BOARD_LABELS_SOURCE}
  /*
   * Instant mode for the layout pre-pass and the first frame. prepareBoardLayout renders the board
   * at progress 1, then 0.5, and measures each synchronously; the first real frame then renders
   * the opening progress. With Motion gliding, those renders would be measured mid-glide and the
   * board would visibly "rewind" from its finished state at the start of every beat.
   */
  function setMotionInstant(on) {
    try { if (typeof Motion !== "undefined" && Motion.MotionGlobalConfig) Motion.MotionGlobalConfig.skipAnimations = on; } catch (e) {}
  }
`;


/**
 * THE PEN. Every word on a Motion board is WRITTEN, by a pen whose tip is where the ink ends.
 *
 * Asked for on 2026-09-29: "the pen should write and exactly at that moment the text should come".
 * So the text and the pen are one thing: each text element, when it becomes visible (its group is
 * revealed on its sentence), is clipped to zero width and uncovered left to right, and the pen's tip
 * is drawn at the clip's edge in the same frame — the ink can only ever appear under the tip.
 *
 *  - One pen, one line at a time, in the order texts appear; ~16 characters a second, faster when a
 *    backlog would let the writing fall behind the narration.
 *  - It stops when the student pauses the lesson (the player's `settled`), after finishing the word
 *    it is on — a frozen "chlo" is worse than a stopped pen — and goes on when the lesson does. A
 *    gap between sentences does not stop it: a teacher keeps writing while they draw breath.
 *  - A board opened mid-lesson shows what was already written at once; only new text is written.
 *  - A text hidden again (the clock scrubbed back) is written again when it reappears.
 *  - ANNOTATION (lib/revisit.ts): when a question sends the student back to an earlier slide, the
 *    same pen rings what Aria is talking about — a written word, or a point on a picture — and then
 *    writes her short note in a free spot of that board. Rings are strokes in the same queue, so the
 *    tip travels along each ring as it is inked.
 *
 * ES5, started by the sandbox for Motion boards only (legacy boards have their own writer). The
 * server render has no pen: its finished frame shows every word, which is what the critics judge.
 */
export const PEN_WRITER_SOURCE = `
  var PEN = (function () {
    var SVG_NS = "http://www.w3.org/2000/svg";
    var states = typeof WeakMap !== "undefined" ? new WeakMap() : null;
    var queue = [];
    var current = null;
    var pen = null, defs = null, uid = 0;
    var lastTs = 0, idleFor = 0, started = false, instantUntil = 0;
    var paused = false, finishTo = -1;
    var annotation = null, annotationKey = "", annotated = true;
    var CPS = 16, CATCH_UP_CPS = 30;

    function root() { return document.querySelector("#root > svg"); }
    function hidden(el, svg) {
      for (var n = el; n && n !== svg; n = n.parentNode) {
        if (n.tagName === "defs" || n.tagName === "clipPath" || n.tagName === "marker" || n.tagName === "mask") return true;
        var cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return true;
      }
      return false;
    }
    function ensurePen(svg) {
      if (pen && pen.parentNode === svg) { svg.appendChild(pen); return pen; }
      pen = document.createElementNS(SVG_NS, "g");
      pen.setAttribute("data-board-pen", "1");
      pen.setAttribute("pointer-events", "none");
      pen.innerHTML =
        '<g transform="rotate(32)">' +
          '<path d="M-1.2 0 L1.2 0 L5 -12 L-5 -12 Z" fill="#1e293b"/>' +
          '<rect x="-5.5" y="-52" width="11" height="41" rx="3" fill="#334155"/>' +
          '<rect x="-5.5" y="-52" width="11" height="9" rx="2.5" fill="#f59e0b"/>' +
          '<rect x="-3.5" y="-40" width="2" height="24" rx="1" fill="#ffffff" opacity="0.25"/>' +
        '</g>';
      pen.style.opacity = "0";
      pen.style.transition = "opacity 180ms linear";
      svg.appendChild(pen);
      return pen;
    }
    function ensureDefs(svg) {
      if (defs && defs.parentNode === svg) return defs;
      defs = document.createElementNS(SVG_NS, "defs");
      defs.setAttribute("data-board-pen-defs", "1");
      svg.insertBefore(defs, svg.firstChild);
      return defs;
    }
    function begin(text, svg) {
      var box;
      try { box = text.getBBox(); } catch (e) { box = null; }
      if (!box || box.width <= 0) return null;
      var id = "pen-clip-" + (++uid);
      var clip = document.createElementNS(SVG_NS, "clipPath");
      clip.setAttribute("id", id);
      var rect = document.createElementNS(SVG_NS, "rect");
      var pad = box.height;
      rect.setAttribute("x", String(box.x - 2));
      rect.setAttribute("y", String(box.y - pad));
      rect.setAttribute("width", "0");
      rect.setAttribute("height", String(box.height + pad * 2));
      clip.appendChild(rect);
      ensureDefs(svg).appendChild(clip);
      text.setAttribute("clip-path", "url(#" + id + ")");
      var chars = Math.max(1, (text.textContent || "").length);
      return { el: text, clip: clip, rect: rect, box: box, chars: chars, f: 0, done: false };
    }
    function finish(state) {
      state.done = true;
      state.f = 1;
      if (state.el) state.el.removeAttribute("clip-path");
      if (state.clip && state.clip.parentNode) state.clip.parentNode.removeChild(state.clip);
    }
    function place(state, svg) {
      var w = state.box.width * state.f;
      state.rect.setAttribute("width", String(w + 2));
      var p = ensurePen(svg);
      try {
        var m = svg.getScreenCTM().inverse().multiply(state.el.getScreenCTM());
        var x = state.box.x + w, y = state.box.y + state.box.height * 0.82;
        var tx = m.a * x + m.c * y + m.e, ty = m.b * x + m.d * y + m.f;
        var scale = Math.max(0.5, Math.min(1.6, state.box.height / 26));
        p.setAttribute("transform", "translate(" + tx.toFixed(1) + " " + ty.toFixed(1) + ") scale(" + scale.toFixed(2) + ")");
        p.style.opacity = "1";
      } catch (e) {}
    }
    /* A ring the pen draws: the stroke is uncovered along its length, the tip on its leading end. */
    function drawStroke(state, svg) {
      var len = state.len;
      state.el.style.strokeDashoffset = String(len * (1 - state.f));
      var p = ensurePen(svg);
      try {
        var pt = state.el.getPointAtLength(len * state.f);
        p.setAttribute("transform", "translate(" + pt.x.toFixed(1) + " " + pt.y.toFixed(1) + ") scale(1)");
        p.style.opacity = "1";
      } catch (e) {}
    }
    function toBoard(svg, el, x, y) {
      var m = svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
      return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    }
    function boxOf(svg, el) {
      var b = el.getBBox();
      var a = toBoard(svg, el, b.x, b.y), c = toBoard(svg, el, b.x + b.width, b.y + b.height);
      return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
    }
    function applyAnnotation(svg) {
      annotated = true;
      var spec = annotation;
      var old = svg.querySelector("[data-board-annotation]");
      if (old) old.parentNode.removeChild(old);
      var g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("data-board-annotation", "1");
      g.setAttribute("pointer-events", "none");
      var vb = svg.viewBox && svg.viewBox.baseVal;
      // The host fits the viewBox to the board's ink, so its origin is not 0,0.
      var X0 = vb && vb.width ? vb.x : 0, Y0 = vb && vb.height ? vb.y : 0;
      var W = vb && vb.width ? vb.width : 1000, H = vb && vb.height ? vb.height : 560;
      // What is already on the board, before anything of the annotation is added.
      var occupied = [];
      Array.prototype.forEach.call(svg.children, function (el) {
        if (el === pen || el === defs || el.tagName === "defs" || el.tagName === "style" || typeof el.getBBox !== "function") return;
        try {
          var b = boxOf(svg, el);
          // The paper (and any full-width band) is background, not something a note can collide with.
          if (b.w <= 0 || b.h <= 0 || b.w > W * 0.9) return;
          occupied.push(b);
        } catch (e) {}
      });
      var texts = Array.prototype.slice.call(svg.querySelectorAll("text"));
      svg.appendChild(g);
      (spec.marks || []).slice(0, 3).forEach(function (mark) {
        var cx, cy, rx, ry;
        if (mark && typeof mark.text === "string") {
          var want = mark.text.trim().toLowerCase();
          var t = texts.filter(function (el) { return (el.textContent || "").trim().toLowerCase() === want; })[0] ||
            texts.filter(function (el) { return (el.textContent || "").toLowerCase().indexOf(want) >= 0; })[0];
          if (!t) return;
          var b = boxOf(svg, t);
          cx = b.x + b.w / 2; cy = b.y + b.h / 2; rx = b.w / 2 + 16; ry = b.h / 2 + 11;
        } else if (mark && isFinite(mark.x) && isFinite(mark.y)) {
          cx = Number(mark.x); cy = Number(mark.y); rx = 32; ry = 28;
        } else return;
        // A hand-drawn loop: slightly uneven, overshooting where it started, as a pen ring does.
        var d = "";
        for (var k = 0; k <= 27; k++) {
          var a = -Math.PI * 0.6 + (k / 24) * Math.PI * 2;
          var wob = 1 + 0.05 * Math.sin(k * 1.9);
          d += (k ? " L" : "M") + (cx + rx * wob * Math.cos(a)).toFixed(1) + " " + (cy + ry * wob * Math.sin(a)).toFixed(1);
        }
        var path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#e11d48");
        path.setAttribute("stroke-width", "3.5");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        g.appendChild(path);
        var len = path.getTotalLength();
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        queue.push({ el: path, stroke: true, len: len, f: 0, chars: 0, done: false });
      });
      var note = typeof spec.note === "string" ? spec.note.trim() : "";
      if (note) {
        var size = Math.max(17, Math.min(26, Math.floor(300 / Math.max(1, note.length * 0.52))));
        var w = note.length * size * 0.52, h = size * 1.3;
        var spots = [[56, 420], [56, 470], [56, 520], [56, 548], [X0 + W - 40 - w, Y0 + H - 16], [X0 + W - 40 - w, Y0 + 50]];
        var spot = spots[4];
        for (var i = 0; i < spots.length; i++) {
          var r = { x: spots[i][0] - 6, y: spots[i][1] - size - 6, w: w + 12, h: h + 12 };
          var clash = occupied.some(function (o) { return r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h; });
          if (!clash && r.x >= X0 && r.y >= Y0 && r.x + r.w <= X0 + W && r.y + r.h <= Y0 + H) { spot = spots[i]; break; }
        }
        var text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", String(spot[0]));
        text.setAttribute("y", String(spot[1]));
        text.setAttribute("font-size", String(size));
        text.setAttribute("font-weight", "700");
        text.setAttribute("fill", "#e11d48");
        text.textContent = note;
        // Written after the rings: the pen picks it up as new text once they are queued.
        g.appendChild(text);
      }
      try { window.parent.postMessage({ type: "annotated" }, "*"); } catch (e) {}
    }
    function wordEnd(state) {
      var text = state.el.textContent || "";
      var at = Math.ceil(state.f * text.length);
      var space = text.indexOf(" ", at);
      return space < 0 ? 1 : space / text.length;
    }
    function tick(ts) {
      requestAnimationFrame(tick);
      var svg = root();
      if (!svg || !started) return;
      var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
      lastTs = ts;
      var texts = svg.querySelectorAll("text");
      for (var i = 0; i < texts.length; i++) {
        var t = texts[i];
        if (pen && pen.contains(t)) continue;
        var st = states && states.get(t);
        var isHidden = hidden(t, svg);
        if (!st) {
          if (isHidden) continue;
          if (ts < instantUntil) { states && states.set(t, { done: true }); continue; }
          st = begin(t, svg);
          if (!st) { states && states.set(t, { done: true }); continue; }
          states && states.set(t, st);
          queue.push(st);
        } else if (isHidden && st.el) {
          // Hidden again — the clock went back (or the layout pass's finished frame was replaced).
          // Nothing half-written stays clipped; it is written afresh when it returns.
          if (!st.done) finish(st);
          states.delete(t);
        } else if (isHidden && st.done) {
          states.delete(t);
        }
      }
      if (annotation && !annotated && ts > instantUntil + 150) applyAnnotation(svg);
      if (current && (!current.el.isConnected || current.done)) current = null;
      // Paused, the pen finishes the word it is on and then rests: it never starts another line.
      while (!current && queue.length && !paused) {
        var next = queue.shift();
        if (next.el.isConnected && !next.done) current = next;
      }
      if (current && current.stroke) {
        idleFor = 0;
        if (!paused) current.f = Math.min(1, current.f + dt / 0.9);
        drawStroke(current, svg);
        if (current.f >= 1) { current.done = true; current = null; }
        return;
      }
      if (!current) {
        idleFor += dt;
        if (pen && idleFor > 0.35) pen.style.opacity = "0";
        return;
      }
      idleFor = 0;
      if (!paused) finishTo = -1;
      else if (finishTo < 0) finishTo = current.f > 0 ? wordEnd(current) : 0;
      var backlog = current.chars * (1 - current.f);
      for (var q = 0; q < queue.length; q++) backlog += queue[q].chars;
      var cps = backlog > 40 ? CATCH_UP_CPS : CPS;
      var target = paused ? finishTo : 1;
      if (current.f < target) current.f = Math.min(target, current.f + dt * cps / current.chars);
      place(current, svg);
      if (current.f >= 1) {
        finish(current);
        current = null;
        // The "finish this word" mark belongs to the line just finished. Kept, a pause on a line's
        // last word (mark = 1) went on to write every following line in full while paused.
        finishTo = -1;
      }
    }
    requestAnimationFrame(tick);
    return {
      /** The board is on screen. Opened mid-lesson, what is already visible counts as written. */
      start: function (sentenceIndex, sentenceProgress) {
        if (started) return;
        started = true;
        var fresh = sentenceIndex === 0 && sentenceProgress < 0.15;
        instantUntil = fresh ? 0 : performance.now() + 250;
      },
      /** The student paused (true) or resumed (false) the lesson. */
      pause: function (on) { paused = !!on; if (!on) finishTo = -1; },
      /** Ring these words or points and write this note, with the pen (see applyAnnotation). */
      annotate: function (spec) {
        var key = JSON.stringify(spec || {});
        if (key === annotationKey) { if (annotated) { try { window.parent.postMessage({ type: "annotated" }, "*"); } catch (e) {} } return; }
        annotationKey = key;
        annotation = spec || {};
        annotated = false;
      }
    };
  })();
`;

/** What `import ... from "framer-motion"` (and friends) resolves to in the sandbox's require shim. */
export const MOTION_MODULE_NAMES = ["motion/react", "framer-motion", "motion"];

/**
 * THE MOTION BOARD CONTRACT (current generation): `export default function Animation({ sentence,
 * sentenceProgress })`. The board reveals and animates EVERYTHING itself with Motion, keyed on the
 * sentence being spoken; the host's teaching timeline (handwriting, stroke tracing, data-teach-*)
 * does not run on it. Boards generated before it take `({ progress })` alone — the sanitizer has
 * always required exactly that signature — so the signature tells the two apart with no flag stored
 * anywhere, and every lecture already saved keeps playing through the host timeline unchanged.
 */
export const MOTION_BOARD_SIGNATURE = /export\s+default\s+function\s+Animation\s*\(\s*\{[^}]*\bsentence\b[^}]*\}\s*\)/;

export function isMotionBoard(code: string | null | undefined): boolean {
  return typeof code === "string" && MOTION_BOARD_SIGNATURE.test(code);
}

/**
 * How many sentences a Motion board is keyed to: one more than the highest literal sentence number
 * in its reveals (reveal(N), draw(N), on(N), sentence >= N). The sandbox needs it because not every
 * caller has a narration clock — a follow-up answer's board is driven by progress alone — and a
 * board must still reveal every step, in order, and all of them by the end.
 */
export function motionBoardSentenceCount(code: string): number {
  let highest = -1;
  for (const match of code.matchAll(/\b(?:reveal|draw|on)\(\s*(\d+)\s*\)|\bsentence\s*>=?\s*(\d+)/g)) {
    highest = Math.max(highest, Number(match[1] ?? match[2]));
  }
  return Math.max(1, highest + 1);
}

/**
 * The props a board is rendered with. A Motion board gets the narration clock: `sentence` is the
 * index of the sentence being spoken and equals `sentenceTotal` once the narration has finished, so
 * `sentence >= k` holds for every step at the end. A legacy board gets `progress` as it always has.
 */
export type MotionBoardProps = { progress: number; sentence: number; sentenceProgress: number; sentenceTotal: number };

/**
 * The finished frame, for every render that has no narration clock — the critics, the layout check,
 * the sandbox's own layout pre-pass. A sentence index past any real script reveals every step.
 */
export const FINISHED_BOARD_PROPS: MotionBoardProps = { progress: 1, sentence: 999, sentenceProgress: 1, sentenceTotal: 999 };
