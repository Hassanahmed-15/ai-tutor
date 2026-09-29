/**
 * THE BOARD'S HOST-SIDE LAYOUT, as ES5 source text for the sandboxed iframe.
 *
 * WHY THIS EXISTS. A generated board is authored blind: the model guesses text widths, never sees
 * the font, and places a title and subtitle by arithmetic it cannot check. The measured failures,
 * all on real lessons: a subtitle printed through its title's descenders; a verbatim source label
 * ("chloroplast containing chlorophyll", 350px) that could not fit its 200px column and was slid
 * sideways onto its own leader line; a label that froze on pause reading "chlo"; an arrow drawn
 * sentences before the part it points at existed, pointing at blank paper; and, in the PDF split
 * view, a 16:9 board letterboxed into a near-square column with 40% of the pane empty.
 *
 * None of those need a model call to fix. The iframe can MEASURE (getBBox, getExtentOfChar), so the
 * host now does the last-mile layout the model cannot: it wraps or shrinks before it ever moves a
 * label, carries the leader with a moved label, stacks the heading band by real ink height, reveals
 * handwriting on true word boundaries, holds an arrow until its target is on the board, and fits the
 * finished drawing to the pane it is shown in.
 *
 * WHY A SECOND COPY OF THE LOGIC IS NOT POSSIBLE, AND WHY THIS IS STILL TESTED. The sandbox is an
 * opaque-origin `srcdoc` document with no module loader (see lib/anim/sandboxRuntime.ts for the same
 * constraint and the `toString()` trap). So the functions live here as source text, and the unit
 * tests evaluate THIS text with `new Function` — the pure geometry that decides where things go is
 * exercised exactly as the iframe runs it, not through a TypeScript twin that could drift.
 *
 * Split in two:
 *   SANDBOX_LAYOUT_CORE   pure functions over plain numbers and boxes. No DOM. Unit-tested.
 *   SANDBOX_LAYOUT_HOST   the DOM glue that measures the live SVG and applies the core's answers.
 *                         Verified by rendering real boards (scripts/eval-boards.mjs, playback-lab).
 *
 * Coordinates: everything the core receives is in the board's AUTHORED user units (the model's
 * `viewBox="0 0 1000 560"`), measured through the screen CTM so a group transform or the fitted
 * viewBox never changes the answer.
 */

export const SANDBOX_LAYOUT_CORE = String.raw`
  function layoutClamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function boxUnion(a, b) {
    if (!a) return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    if (!b) return a;
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x: x, y: y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
  }

  /* Distance from a point to a box's edge; 0 when the point is inside. */
  function boxDistance(px, py, box) {
    var dx = Math.max(box.x - px, 0, px - (box.x + box.width));
    var dy = Math.max(box.y - py, 0, py - (box.y + box.height));
    return Math.sqrt(dx * dx + dy * dy);
  }

  /*
   * WHERE A STROKE THAT STARTS IN (OR ON) SOME WORDS SHOULD START INSTEAD. p is the end buried in,
   * or within "touch" of, the text box; q the stroke's other end. The answer is the point on p→q where
   * the stroke leaves the box plus "gap" — or null when p is clear of the words, or when clearing
   * them would eat most of the stroke (then it is not a leader running into its label; leave it).
   * "touch" matters: an arrow planned 24 px after a line of text ended 4 px from it once the embedded
   * face made the line wider, and with its round cap it read as one scribble with the last letter.
   */
  function strokeExit(p, q, box, gap, touch) {
    var t0 = typeof touch === "number" ? touch : 0;
    var inside = p.x > box.x - t0 && p.x < box.x + box.width + t0 && p.y > box.y - t0 && p.y < box.y + box.height + t0;
    if (!inside) return null;
    var x0 = box.x - gap, y0 = box.y - gap, x1 = box.x + box.width + gap, y1 = box.y + box.height + gap;
    var dx = q.x - p.x, dy = q.y - p.y;
    var t = Infinity;
    if (dx > 0) t = Math.min(t, (x1 - p.x) / dx); else if (dx < 0) t = Math.min(t, (x0 - p.x) / dx);
    if (dy > 0) t = Math.min(t, (y1 - p.y) / dy); else if (dy < 0) t = Math.min(t, (y0 - p.y) / dy);
    if (!isFinite(t) || t <= 0 || t > 0.8) return null;
    return { x: p.x + dx * t, y: p.y + dy * t };
  }

  /*
   * How far a text may shrink so a stroke end at p sits "gap" clear of it, given the anchor that
   * stays put. Only an end near the FREE edge can be cleared by shrinking (an end in the middle of
   * the words cannot), and never below minScale — a legible label that touches a stroke beats an
   * illegible one that does not. Returns the scale, or null when shrinking will not do it.
   */
  function shrinkToClear(box, anchor, p, gap, minScale) {
    var cx = box.x + box.width / 2;
    var keep;
    if (anchor === "end") { if (p.x >= cx) return null; keep = box.x + box.width - (p.x + gap); }
    else if (anchor === "middle") keep = 2 * (Math.abs(p.x - cx) - gap);
    else { if (p.x <= cx) return null; keep = p.x - gap - box.x; }
    var scale = keep / box.width;
    if (!(scale >= minScale) || scale >= 1) return null;
    return scale;
  }

  /*
   * THE PANE FIT. The drawing's ink box, padded, then widened or heightened around its own centre
   * to the pane's aspect — so the content fills the pane instead of a fixed 1000x560 frame being
   * letterboxed into it. Two guards: a zoom ceiling (a board that drew one small thing in the middle
   * is not blown up until its strokes look like crayon), and a floor on the padding so ink never
   * touches the pane edge.
   */
  function fitViewBox(content, container, authored, options) {
    var opts = options || {};
    if (!content || !(content.width > 0) || !(content.height > 0)) return null;
    if (!container || !(container.width > 0) || !(container.height > 0)) return null;
    var aw = authored && authored.width > 0 ? authored.width : 1000;
    var ah = authored && authored.height > 0 ? authored.height : 560;
    var marginRatio = typeof opts.margin === "number" ? opts.margin : 0.035;
    var pad = Math.max(typeof opts.minPad === "number" ? opts.minPad : 14, Math.max(content.width, content.height) * marginRatio);
    var x = content.x - pad, y = content.y - pad, w = content.width + pad * 2, h = content.height + pad * 2;
    var aspect = container.width / container.height;
    if (w / h < aspect) { var nw = h * aspect; x -= (nw - w) / 2; w = nw; }
    else { var nh = w / aspect; y -= (nh - h) / 2; h = nh; }
    var authoredScale = Math.min(container.width / aw, container.height / ah);
    var maxScale = authoredScale * (typeof opts.maxZoom === "number" ? opts.maxZoom : 1.4);
    var scale = container.width / w;
    if (scale > maxScale) {
      var grow = scale / maxScale, cx = x + w / 2, cy = y + h / 2;
      w *= grow; h *= grow; x = cx - w / 2; y = cy - h / 2;
    }
    return { x: x, y: y, width: w, height: h };
  }

  /*
   * An element's box as far as it can ever be SEEN: cut to the authored frame plus a small bleed.
   * The old letterboxed board never showed anything much past its 1000x560 frame, so ink out there
   * was already invisible — but measured whole, one malformed shape wrecked the fit. Measured on a
   * real cached board: an arrowhead written as points="315,231 303,224 303,2317" (a string "231"
   * concatenated with 7) reported a box 2,000 units tall, the "ink" grew to 75,000 x 42,000, and the
   * whole board shrank to a speck in the middle of its pane. Clipped, the fit can never be worse
   * than the old letterbox.
   */
  function visiblePart(box, authored) {
    var bleedX = authored.width * 0.04, bleedY = authored.height * 0.04;
    var x0 = Math.max(box.x, authored.x - bleedX), y0 = Math.max(box.y, authored.y - bleedY);
    var x1 = Math.min(box.x + box.width, authored.x + authored.width + bleedX);
    var y1 = Math.min(box.y + box.height, authored.y + authored.height + bleedY);
    // A horizontal or vertical line has zero height or width and is still ink; no overlap is not.
    if (x1 < x0 || y1 < y0 || (x1 === x0 && y1 === y0)) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /*
   * THE HAND'S POSITION IN A LINE OF WORDS. The same pacing the board always used (longer words
   * take longer, punctuation adds a breath), but reported as WHICH word and how far into it, so the
   * reveal can be placed on the word's real measured extent. The old reveal mapped word i to i/n of
   * the box width, which assumes every word is the same width: "a chloroplast" at halfway showed
   * "a chlor".
   */
  function writingPosition(words, local) {
    var t = layoutClamp(local, 0, 1);
    if (!words || !words.length) return { index: 0, fraction: t, count: 0 };
    var weights = words.map(function (word, index) {
      var writing = Math.max(0.8, Math.min(2.8, word.length * 0.28));
      var variation = 0.92 + ((word.length * 17 + index * 11) % 19) / 100;
      var pause = /[.!?]$/.test(word) ? 0.7 : /[,;:]$/.test(word) ? 0.3 : 0.1;
      return writing * variation + pause;
    });
    var total = weights.reduce(function (sum, w) { return sum + w; }, 0);
    var target = t * total;
    var consumed = 0;
    for (var i = 0; i < weights.length; i += 1) {
      var slot = weights[i];
      if (target < consumed + slot || i === weights.length - 1) {
        var word = words[i];
        var pauseRatio = /[.!?]$/.test(word) ? 0.24 : /[,;:]$/.test(word) ? 0.13 : 0.06;
        var written = layoutClamp((target - consumed) / (slot * (1 - pauseRatio)), 0, 1);
        return { index: i, fraction: written, count: words.length };
      }
      consumed += slot;
    }
    return { index: words.length - 1, fraction: 1, count: words.length };
  }

  /*
   * Where the ink stops, given measured word boxes [{x0, x1, line}] and the hand's position.
   *
   * settle = null     the hand is moving: the edge sweeps through the current word (handwriting).
   * settle = "word"   the hand stopped (pause, a stalled clock, a gap between sentences): finish
   *                   the word it is in, so a frozen board never reads "chlo".
   * settle = "line"   an explicit settle from the player: finish the whole line being written.
   */
  function writingEdge(wordBoxes, position, settle) {
    if (!wordBoxes || !wordBoxes.length) return null;
    var index = layoutClamp(position.index, 0, wordBoxes.length - 1);
    var box = wordBoxes[index];
    var fraction = layoutClamp(position.fraction, 0, 1);
    var x = box.x0 + (box.x1 - box.x0) * fraction;
    if (settle === "word" && fraction > 0) x = box.x1;
    if (settle === "line") {
      for (var i = index; i < wordBoxes.length && wordBoxes[i].line === box.line; i += 1) x = wordBoxes[i].x1;
    }
    return { line: box.line, x: x, done: index === wordBoxes.length - 1 && x >= box.x1 - 0.5 };
  }

  /*
   * WORDS THAT MUST STAY IN THEIR BOX. A step name inside a flowchart pill, a value in a cell: the
   * box was sized for the words' planned width. If the words now run past the box's inner edge (a
   * wider face, a guessed width), the scale that brings them back inside, measured from the anchor
   * that stays put — or null when they already fit, or when fitting would take more than the floor
   * allows (then the rect is not really their box, and shrinking would only hurt legibility).
   */
  /*
   * NODES: circles and ellipses. A tree's "parent" and "one child" were written wider than the
   * circles they label, and a "before" caption sat on top of the first node — the rect-only container
   * pass never looked at a round shape. These three answer, for an ellipse (cx, cy, rx, ry):
   */

  /* How wide the ellipse is across the whole vertical band a text box occupies (its narrowest chord). */
  function ellipseChordWidth(node, box) {
    var far = Math.max(Math.abs(box.y - node.cy), Math.abs(box.y + box.height - node.cy));
    if (far >= node.ry) return 0;
    return 2 * node.rx * Math.sqrt(1 - (far / node.ry) * (far / node.ry));
  }

  /* True when a box and an ellipse really overlap (not merely their bounding boxes). */
  function boxHitsEllipse(box, node, inset) {
    var px = layoutClamp(node.cx, box.x + inset, box.x + box.width - inset);
    var py = layoutClamp(node.cy, box.y + inset, box.y + box.height - inset);
    var dx = (px - node.cx) / node.rx, dy = (py - node.cy) / node.ry;
    return dx * dx + dy * dy < 1;
  }

  /*
   * Where a segment from p (outside) towards q first meets the ellipse grown by gap, or null when it
   * never does. An arrow into a node ends there, so its head stops on the rim instead of cutting in.
   */
  function segmentEllipseEntry(p, q, node, gap) {
    var rx = node.rx + gap, ry = node.ry + gap;
    var ux = (p.x - node.cx) / rx, uy = (p.y - node.cy) / ry;
    var vx = (q.x - p.x) / rx, vy = (q.y - p.y) / ry;
    var a = vx * vx + vy * vy, b = 2 * (ux * vx + uy * vy), c = ux * ux + uy * uy - 1;
    if (a < 1e-9 || c <= 0) return null;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    var t = (-b - Math.sqrt(disc)) / (2 * a);
    if (!(t > 0 && t < 1)) return null;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  }

  /* The same for a box node (a pill, a cell): where a segment from p towards q meets the grown box. */
  function segmentBoxEntry(p, q, box, gap) {
    var x0 = box.x - gap, y0 = box.y - gap, x1 = box.x + box.width + gap, y1 = box.y + box.height + gap;
    if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) return null;
    var t0 = 0, t1 = 1, dx = q.x - p.x, dy = q.y - p.y;
    var edges = [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]];
    for (var i = 0; i < 4; i += 1) {
      var pe = edges[i][0], qe = edges[i][1];
      if (pe === 0) { if (qe < 0) return null; continue; }
      var r = qe / pe;
      if (pe < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    if (!(t0 > 0 && t0 < 1)) return null;
    return { x: p.x + dx * t0, y: p.y + dy * t0 };
  }

  function containerFitScale(box, anchor, rect, pad, minScale) {
    var left = rect.x + pad, right = rect.x + rect.width - pad;
    if (box.x >= left - 0.5 && box.x + box.width <= right + 0.5) return null;
    var room;
    if (anchor === "end") room = box.x + box.width - left;
    else if (anchor === "middle") { var cx = box.x + box.width / 2; room = 2 * Math.min(cx - left, right - cx); }
    else room = right - box.x;
    var scale = room / box.width;
    if (!(scale >= minScale) || scale >= 1) return null;
    return scale;
  }

  /*
   * TWO LABELS ON ONE ROW THAT RUN INTO EACH OTHER ("minority" "majority" printed as
   * "minoritymajority"). a is the left box, b the right. Each can give way only from its free edge:
   * a start-anchored left label shrinks leftward, an end-anchored right label rightward, a centred
   * one from both sides. Returns the scale for each, or null when they are clear already or cannot
   * be cleared within the floor.
   */
  function rowClearScales(a, anchorA, b, anchorB, minGap, minScale) {
    var gap = b.x - (a.x + a.width);
    if (gap >= minGap) return null;
    var need = minGap - gap;
    var capA = anchorA === "end" ? 0 : a.width * (1 - minScale) * (anchorA === "middle" ? 0.5 : 1);
    var capB = anchorB === "start" || !anchorB ? 0 : b.width * (1 - minScale) * (anchorB === "middle" ? 0.5 : 1);
    if (capA + capB < need) return null;
    var shareA = capA / (capA + capB), shareB = 1 - shareA;
    var perA = anchorA === "middle" ? 0.5 : 1, perB = anchorB === "middle" ? 0.5 : 1;
    return {
      a: capA > 0 ? 1 - (need * shareA) / (a.width * perA) : 1,
      b: capB > 0 ? 1 - (need * shareB) / (b.width * perB) : 1
    };
  }

  /*
   * The word boundary that makes two lines most even: minimise the longer line. A label wraps to two
   * lines rather than being truncated or shrunk illegible — the source's own wording must fit.
   */
  function bestLineBreak(widths, spaceWidth) {
    if (!widths || widths.length < 2) return -1;
    var gap = spaceWidth > 0 ? spaceWidth : 0;
    var total = widths.reduce(function (sum, w) { return sum + w; }, 0) + gap * (widths.length - 1);
    var best = -1, bestWidth = Infinity, first = 0;
    for (var k = 1; k < widths.length; k += 1) {
      first += widths[k - 1] + (k > 1 ? gap : 0);
      var second = total - first - gap;
      var longest = Math.max(first, second);
      // Ties go to the later break: a longer first line reads as one phrase continuing, not a stub.
      if (longest <= bestWidth + 0.01) { bestWidth = Math.min(bestWidth, longest); best = k; }
    }
    return best;
  }

  /*
   * PUSH APART, TOP TO BOTTOM. Boxes that share horizontal extent keep at least "gap" between them;
   * a box that collides with one above it moves down. With allowLift, a stack that had to grow is
   * then lifted as a whole into the room above its top box (down to minTop), which is how a title
   * and its subtitle end up both readable and still in the heading band instead of the subtitle
   * being shoved into the drawing. Returns the dy for each input box, in input order.
   */
  function separateVertically(boxes, options) {
    var opts = options || {};
    var gap = typeof opts.gap === "number" ? opts.gap : 4;
    var minOverlapX = typeof opts.minOverlapX === "number" ? opts.minOverlapX : 4;
    var order = boxes.map(function (_, i) { return i; }).sort(function (a, b) { return boxes[a].y - boxes[b].y || a - b; });
    var dy = boxes.map(function () { return 0; });
    var placed = [];
    order.forEach(function (i) {
      var box = boxes[i];
      var top = box.y;
      placed.forEach(function (j) {
        var other = boxes[j];
        var overlapX = Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
        if (overlapX <= minOverlapX) return;
        var otherBottom = other.y + dy[j] + other.height;
        if (top < otherBottom + gap && top + box.height > other.y + dy[j]) top = otherBottom + gap;
      });
      dy[i] = top - box.y;
      placed.push(i);
    });
    if (opts.allowLift) {
      var pushed = dy.some(function (d) { return d > 0.5; });
      if (pushed) {
        var first = order[0];
        var room = Math.max(0, boxes[first].y - (typeof opts.minTop === "number" ? opts.minTop : -Infinity));
        var need = Math.max.apply(null, dy);
        var lift = Math.min(room, need / 2 + 0.5);
        if (lift > 0) dy = dy.map(function (d) { return d - lift; });
      }
    }
    if (typeof opts.maxBottom === "number") {
      var overflow = 0;
      boxes.forEach(function (box, i) { overflow = Math.max(overflow, box.y + dy[i] + box.height - opts.maxBottom); });
      if (overflow > 0) {
        // Out of room below: give back as much of the push as the moved boxes can afford.
        dy = dy.map(function (d) { return d > 0 ? Math.max(0, d - overflow) : d; });
      }
    }
    return dy;
  }

  /*
   * WHEN EACH STEP REALLY HAPPENS. Input: one entry per timed element, in document order —
   *   { order, sentence, kind, parent, head }
   * parent = index of the nearest timed ANCESTOR (or -1); head = index of the step an arrow's head
   * lands on (or -1). Output: { sentence, key } per step; the host sorts by (sentence, key, index).
   *
   * Three rules, each a measured failure:
   *  1. A label/arrow/annotate group that CONTAINS timed text rides with that text. Generated code
   *     nests <g kind="label" sentence=3> <leader/> <dot/> <text sentence=6/> </g>: the leader was
   *     swept in three sentences early and the word under it arrived alone.
   *  2. Nothing appears before the group it sits in (a child scheduled first was invisible behind
   *     its parent's opacity, then popped in whole).
   *  3. An arrow waits for what it points at. Drawn first, it points at blank paper for sentences.
   */
  function resolveTeachingSchedule(steps) {
    var n = steps.length;
    var eff = steps.map(function (s) { return { sentence: s.sentence, key: s.order }; });
    var children = steps.map(function () { return []; });
    steps.forEach(function (s, i) {
      if (s.parent >= 0 && s.parent < n && s.parent !== i) children[s.parent].push(i);
    });
    function before(a, b) { return a.sentence < b.sentence || (a.sentence === b.sentence && a.key < b.key); }
    function descendants(i) {
      var out = [], stack = children[i].slice();
      while (stack.length) { var j = stack.pop(); out.push(j); for (var c = 0; c < children[j].length; c += 1) stack.push(children[j][c]); }
      return out;
    }
    function clampToAncestors() {
      var roots = [];
      steps.forEach(function (s, i) { if (!(s.parent >= 0 && s.parent < n && s.parent !== i)) roots.push(i); });
      var queue = roots.slice();
      while (queue.length) {
        var i = queue.shift();
        children[i].forEach(function (j, rank) {
          if (before(eff[j], eff[i]) || (eff[j].sentence === eff[i].sentence && eff[j].key === eff[i].key)) {
            eff[j] = { sentence: eff[i].sentence, key: eff[i].key + 0.001 * (rank + 1) };
          }
          queue.push(j);
        });
      }
    }
    steps.forEach(function (s, i) {
      if (!children[i].length) return;
      if (s.kind !== "label" && s.kind !== "arrow" && s.kind !== "annotate") return;
      var earliest = null;
      descendants(i).forEach(function (j) {
        var candidate = { sentence: steps[j].sentence, key: steps[j].order };
        if (!earliest || before(candidate, earliest)) earliest = candidate;
      });
      if (earliest) eff[i] = { sentence: earliest.sentence, key: earliest.key - 0.5 };
    });
    clampToAncestors();
    for (var pass = 0; pass < 2; pass += 1) {
      steps.forEach(function (s, i) {
        if (s.kind !== "arrow" || !(s.head >= 0) || s.head === i || s.head >= n) return;
        var target = eff[s.head];
        if (!before(target, eff[i])) eff[i] = { sentence: target.sentence, key: target.key + 0.25 };
      });
      clampToAncestors();
    }
    return eff;
  }
`;

/**
 * The DOM half. Relies on SANDBOX_LAYOUT_CORE and on `numberAttr` from the sandbox script, and is
 * injected into the same scope. Every function degrades to "leave the board as authored" on any
 * measurement failure — layout polish must never be the reason a board does not render.
 */
export const SANDBOX_LAYOUT_HOST = String.raw`
  var SVG_NS = "http://www.w3.org/2000/svg";
  var SKIP_CONTAINERS = "defs,clipPath,marker,mask,pattern,symbol,linearGradient,radialGradient,filter";
  var GRAPHIC_SELECTOR = "path,line,polyline,polygon,circle,ellipse,rect,text,image,use";

  /* The model's own coordinate frame, captured before the host ever touches the viewBox. */
  function authoredFrame(svg) {
    var stored = svg.getAttribute("data-authored-viewbox");
    var raw = stored || svg.getAttribute("viewBox") || "0 0 1000 560";
    if (!stored) svg.setAttribute("data-authored-viewbox", raw);
    var parts = raw.split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || !parts.every(isFinite) || parts[2] <= 0 || parts[3] <= 0) return { x: 0, y: 0, width: 1000, height: 560 };
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  }

  /* Maps a node's local user space to the svg's user space, through the live screen CTMs. */
  function toRootMatrix(svg, node) {
    try {
      var rootCtm = svg.getScreenCTM();
      var nodeCtm = node.getScreenCTM();
      if (!rootCtm || !nodeCtm) return null;
      return rootCtm.inverse().multiply(nodeCtm);
    } catch (e) { return null; }
  }

  function transformBox(matrix, box) {
    if (!matrix) return { x: box.x, y: box.y, width: box.width, height: box.height };
    var xs = [], ys = [];
    [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].forEach(function (c) {
      xs.push(matrix.a * c[0] + matrix.c * c[1] + matrix.e);
      ys.push(matrix.b * c[0] + matrix.d * c[1] + matrix.f);
    });
    var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    return { x: x, y: y, width: Math.max.apply(null, xs) - x, height: Math.max.apply(null, ys) - y };
  }

  function rootBox(svg, node) {
    try {
      var box = node.getBBox();
      if (!box || !isFinite(box.x)) return null;
      return transformBox(toRootMatrix(svg, node), box);
    } catch (e) { return null; }
  }

  function rootPoint(svg, node, x, y) {
    var m = toRootMatrix(svg, node);
    if (!m) return { x: x, y: y };
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  function insideSkipped(node, svg) {
    for (var n = node.parentNode; n && n !== svg; n = n.parentNode) {
      if (n.matches && n.matches(SKIP_CONTAINERS)) return true;
    }
    return false;
  }

  /* ---------- measured words, for the reveal and for wrapping ---------- */

  /*
   * Word extents on the real glyphs. Cached per node and invalidated by anything the host itself
   * changes (content, size, line structure). SVG addresses characters AFTER whitespace collapsing,
   * so the collapsed string must line up with getNumberOfChars(); when it does not (odd markup),
   * this returns null and callers fall back to the old proportional estimate.
   */
  var measureCache = new WeakMap();
  function measuredWords(text) {
    var content = text.textContent || "";
    var key = content + "|" + (text.style.fontSize || text.getAttribute("font-size") || "") + "|" + text.childNodes.length + "|" + (text.getAttribute("transform") || "");
    var cached = measureCache.get(text);
    if (cached && cached.key === key) return cached.value;
    var value = null;
    try {
      var collapsed = content.replace(/[\n\r\t]/g, " ").replace(/ {2,}/g, " ").replace(/^ /, "").replace(/ $/, "");
      var count = text.getNumberOfChars();
      if (count > 0 && count === collapsed.length) {
        var words = [], lines = [], start = -1;
        var boxes = [];
        for (var i = 0; i <= collapsed.length; i += 1) {
          var ch = collapsed.charAt(i);
          if (i < collapsed.length && ch !== " ") { if (start < 0) start = i; continue; }
          if (start >= 0) {
            var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (var c = start; c < i; c += 1) {
              var ext = text.getExtentOfChar(c);
              x0 = Math.min(x0, ext.x); x1 = Math.max(x1, ext.x + ext.width);
              y0 = Math.min(y0, ext.y); y1 = Math.max(y1, ext.y + ext.height);
            }
            var line = -1;
            for (var l = 0; l < lines.length; l += 1) if (Math.abs(lines[l].y0 - y0) < 2) { line = l; break; }
            if (line < 0) { lines.push({ x0: x0, x1: x1, y0: y0, y1: y1 }); line = lines.length - 1; }
            else { var L = lines[line]; L.x0 = Math.min(L.x0, x0); L.x1 = Math.max(L.x1, x1); L.y0 = Math.min(L.y0, y0); L.y1 = Math.max(L.y1, y1); }
            words.push(collapsed.slice(start, i));
            boxes.push({ x0: x0, x1: x1, line: line, start: start, end: i });
            start = -1;
          }
        }
        if (boxes.length) value = { words: words, boxes: boxes, lines: lines, size: fontSizeOf(text) };
      }
    } catch (e) { value = null; }
    measureCache.set(text, { key: key, value: value });
    return value;
  }

  /* ---------- fitting text inside the board ---------- */

  function fontSizeOf(text) {
    var size = parseFloat(getComputedStyle(text).fontSize);
    return isFinite(size) && size > 0 ? size : 16;
  }

  /*
   * The leader a label hangs on: a line (or a two-point path/polyline) with one end at the label and
   * the other end well away from it. Only the end AT the label moves with the label — the dot end
   * stays on the part it names, which is the whole point of a leader.
   */
  function endpointsOf(el) {
    try {
      var tag = el.localName;
      if (tag === "line") return [[el.x1.baseVal.value, el.y1.baseVal.value], [el.x2.baseVal.value, el.y2.baseVal.value]];
      if (tag === "polyline") {
        var pts = el.points;
        if (!pts || pts.numberOfItems < 2 || pts.numberOfItems > 3) return null;
        var a = pts.getItem(0), b = pts.getItem(pts.numberOfItems - 1);
        return [[a.x, a.y], [b.x, b.y]];
      }
      if (tag === "path") {
        var d = el.getAttribute("d") || "";
        if (!/^\s*M\s*-?[\d.]+[\s,]+-?[\d.]+\s*L\s*-?[\d.]+[\s,]+-?[\d.]+\s*$/i.test(d)) return null;
        var nums = d.match(/-?[\d.]+/g).map(Number);
        return [[nums[0], nums[1]], [nums[2], nums[3]]];
      }
    } catch (e) {}
    return null;
  }

  /*
   * Every plausible leader for a label, scored: nearest end first, and level with the label's FIRST
   * line (where a leader meets a label), so a label never adopts the leader of the row above it.
   */
  function leaderCandidates(svg, text, box) {
    var out = [];
    var size = fontSizeOf(text);
    var firstLineMid = box.y + size * 0.55;
    var candidates = svg.querySelectorAll("line,polyline,path");
    for (var i = 0; i < candidates.length; i += 1) {
      var el = candidates[i];
      if (insideSkipped(el, svg)) continue;
      var ends = endpointsOf(el);
      if (!ends) continue;
      var p0 = rootPoint(svg, el, ends[0][0], ends[0][1]);
      var p1 = rootPoint(svg, el, ends[1][0], ends[1][1]);
      var d0 = boxDistance(p0.x, p0.y, box), d1 = boxDistance(p1.x, p1.y, box);
      var near = d0 <= d1 ? 0 : 1;
      var nearDist = Math.min(d0, d1), farDist = Math.max(d0, d1);
      if (nearDist > 16 || farDist < 24) continue;
      var nearY = near === 0 ? p0.y : p1.y;
      out.push({ el: el, end: near, distance: nearDist, score: nearDist + 0.6 * Math.abs(nearY - firstLineMid) });
    }
    return out;
  }

  function findLeader(svg, text, box) {
    var best = null;
    leaderCandidates(svg, text, box).forEach(function (c) {
      if (c.el.__hostLeaderOf && c.el.__hostLeaderOf !== text) return;
      if (!best || c.score < best.score) best = c;
    });
    return best;
  }

  /*
   * One leader per label, one label per leader, assigned once from the labels' AUTHORED positions
   * and kept: re-matching after a label had been wrapped and moved let it adopt its neighbour's
   * leader, and its own was left drawn from the first frame, pointing at nothing.
   */
  function assignLeaders(svg, texts) {
    var pairs = [];
    texts.forEach(function (text) {
      if (text.__hostLeader !== undefined) return;
      var box = rootBox(svg, text);
      if (!box) return;
      leaderCandidates(svg, text, box).forEach(function (c) {
        if (c.el.__hostLeaderOf && c.el.__hostLeaderOf !== text) return;
        pairs.push({ text: text, candidate: c });
      });
    });
    pairs.sort(function (a, b) { return a.candidate.score - b.candidate.score; });
    pairs.forEach(function (pair) {
      if (pair.text.__hostLeader || pair.candidate.el.__hostLeaderOf) return;
      pair.text.__hostLeader = { el: pair.candidate.el, end: pair.candidate.end, distance: pair.candidate.distance };
      pair.candidate.el.__hostLeaderOf = pair.text;
    });
    texts.forEach(function (text) { if (text.__hostLeader === undefined) text.__hostLeader = null; });
  }

  function moveLeaderEnd(svg, leader, dx, dy) {
    if (!leader || (!dx && !dy)) return;
    var el = leader.el;
    var m = toRootMatrix(svg, el);
    var lx = dx, ly = dy;
    if (m) {
      var det = m.a * m.d - m.b * m.c;
      if (Math.abs(det) > 1e-9) { lx = (m.d * dx - m.c * dy) / det; ly = (-m.b * dx + m.a * dy) / det; }
    }
    try {
      if (el.localName === "line") {
        var ax = leader.end === 0 ? "x1" : "x2", ay = leader.end === 0 ? "y1" : "y2";
        el.setAttribute(ax, String(el[ax].baseVal.value + lx));
        el.setAttribute(ay, String(el[ay].baseVal.value + ly));
      } else if (el.localName === "polyline") {
        var pts = el.points;
        var p = pts.getItem(leader.end === 0 ? 0 : pts.numberOfItems - 1);
        p.x += lx; p.y += ly;
      } else if (el.localName === "path") {
        var ends = endpointsOf(el);
        if (!ends) return;
        ends[leader.end][0] += lx; ends[leader.end][1] += ly;
        el.setAttribute("d", "M" + ends[0][0] + " " + ends[0][1] + " L" + ends[1][0] + " " + ends[1][1]);
      }
      // A dash-drawn leader caches its own length; re-measure after its geometry changed.
      el.removeAttribute("data-host-length");
    } catch (e) {}
  }

  function shiftText(svg, text, dx, dy) {
    if (!dx && !dy) return;
    var base = text.getAttribute("data-host-base-transform");
    if (base === null) { base = text.getAttribute("transform") || ""; text.setAttribute("data-host-base-transform", base); }
    var prior = text.__hostShift || { dx: 0, dy: 0 };
    var next = { dx: prior.dx + dx, dy: prior.dy + dy };
    text.__hostShift = next;
    // The shift is in ROOT units; convert to the text's parent space so a scaled group moves right.
    var m = toRootMatrix(svg, text.parentNode);
    var lx = next.dx, ly = next.dy;
    if (m) {
      var det = m.a * m.d - m.b * m.c;
      if (Math.abs(det) > 1e-9) { lx = (m.d * next.dx - m.c * next.dy) / det; ly = (-m.b * next.dx + m.a * next.dy) / det; }
    }
    text.setAttribute("transform", ("translate(" + lx + " " + ly + ") " + base).trim());
    moveLeaderEnd(svg, text.__hostLeader, dx, dy);
  }

  /* Rebuilds a plain one-string label as two <tspan> lines at the most even word boundary. */
  function wrapText(text) {
    if (text.childNodes.length !== 1 || text.firstChild.nodeType !== 3) return false;
    var x = text.getAttribute("x");
    if (x === null || !/^\s*-?[\d.]+\s*$/.test(x)) return false;
    var measured = measuredWords(text);
    if (!measured || measured.words.length < 2 || measured.lines.length !== 1) return false;
    var widths = measured.boxes.map(function (b) { return b.x1 - b.x0; });
    var gaps = [];
    for (var i = 1; i < measured.boxes.length; i += 1) gaps.push(Math.max(0, measured.boxes[i].x0 - measured.boxes[i - 1].x1));
    var space = gaps.length ? gaps.reduce(function (s, g) { return s + g; }, 0) / gaps.length : fontSizeOf(text) * 0.25;
    var k = bestLineBreak(widths, space);
    if (k < 1) return false;
    var first = measured.words.slice(0, k).join(" ");
    var second = measured.words.slice(k).join(" ");
    var t1 = document.createElementNS(SVG_NS, "tspan");
    t1.setAttribute("x", x.trim());
    // The trailing space keeps textContent reading "a b c", not "a bc": the pen, the tutor and the
    // grounding checks all read words from textContent.
    t1.textContent = first + " ";
    var t2 = document.createElementNS(SVG_NS, "tspan");
    t2.setAttribute("x", x.trim());
    t2.setAttribute("dy", "1.18em");
    t2.textContent = second;
    text.textContent = "";
    text.appendChild(t1);
    text.appendChild(t2);
    text.setAttribute("data-host-wrapped", "1");
    return true;
  }

  function overflowOf(box, safe) {
    return {
      left: Math.max(0, safe.x0 - box.x),
      right: Math.max(0, box.x + box.width - safe.x1),
      top: Math.max(0, safe.y0 - box.y),
      bottom: Math.max(0, box.y + box.height - safe.y1)
    };
  }

  /*
   * FIT, DON'T SHOVE. The old pass translated any overflowing text sideways by the overflow — which
   * is how a 350px source label in a 200px column landed on its own leader line. Now, in order:
   * wrap to two lines (body text first), shrink by at most a fifth (headings first, since a wrapped
   * title pushes everything under it), and only then move — carrying the label's leader with it.
   */
  function fitTextInside(svg, text, safe) {
    var box = rootBox(svg, text);
    if (!box || box.width <= 0) return;
    var over = overflowOf(box, safe);
    var tooWide = over.left + over.right > 0.5;
    var size = fontSizeOf(text);
    var heading = size >= 27;
    // Shrink in small steps until the text fits AT ITS OWN ANCHOR, never below 80% of its size.
    function shrinkToFit() {
      var floor = size * 0.8;
      for (var s = size - Math.max(0.5, size * 0.04); s >= floor - 0.01; s -= Math.max(0.5, size * 0.04)) {
        text.style.fontSize = s + "px";
        var b = rootBox(svg, text);
        if (!b) return;
        var o = overflowOf(b, safe);
        if (o.left + o.right <= 0.5) return;
      }
    }
    function horizontalOverflow() {
      box = rootBox(svg, text) || box;
      over = overflowOf(box, safe);
      return over.left + over.right > 0.5;
    }
    if (tooWide) {
      if (heading) {
        shrinkToFit();
        if (horizontalOverflow()) wrapText(text);
      } else if (!wrapText(text)) {
        shrinkToFit();
      }
      if (horizontalOverflow() && !heading && text.getAttribute("data-host-wrapped") === "1") shrinkToFit();
      horizontalOverflow();
    }
    var dx = over.left > 0 ? over.left : over.right > 0 ? -over.right : 0;
    var dy = over.top > 0 ? over.top : over.bottom > 0 ? -over.bottom : 0;
    if (dx || dy) shiftText(svg, text, dx, dy);
  }

  /*
   * THE HEADING BAND AND COLLIDING LABELS. Title and subtitle are stacked by their measured boxes
   * (a 34px heading's descenders reach ~9 units below its baseline; the model placed the subtitle
   * by guessing). Any other two text lines whose boxes collide are pushed apart the same way, the
   * lower one moving down with its leader.
   */
  function separateTexts(svg, texts, authored) {
    var entries = [];
    texts.forEach(function (text) {
      var box = rootBox(svg, text);
      if (!box || box.width <= 0 || box.height <= 0) return;
      // A deliberate duplicate (a halo or shadow copy under the same words) is not a collision.
      var content = (text.textContent || "").trim();
      var duplicate = entries.some(function (e) {
        return (e.text.textContent || "").trim() === content && Math.abs(e.box.x - box.x) < 4 && Math.abs(e.box.y - box.y) < 4;
      });
      if (!duplicate) entries.push({ text: text, box: box });
    });
    if (entries.length < 2) return;
    var bandBottom = authored.y + authored.height * 0.23;
    var band = entries.filter(function (e) { return e.box.y < bandBottom && fontSizeOf(e.text) >= 15; });
    var rest = entries.filter(function (e) { return band.indexOf(e) < 0; });
    // Text boxes are the font's ascent+descent (the board font's box is 1.0/0.35em, well outside
    // its letter ink), so boxes that merely touch are already clear of each other: push only on a
    // real overlap. The heading band keeps one unit of air so a title's descenders never kiss.
    var bandDy = separateVertically(band.map(function (e) { return e.box; }), { gap: 1, allowLift: true, minTop: authored.y + 10 });
    band.forEach(function (e, i) { if (Math.abs(bandDy[i]) > 0.5) shiftText(svg, e.text, 0, bandDy[i]); });
    var restDy = separateVertically(rest.map(function (e) { return e.box; }), { gap: -1.5, minOverlapX: 6, maxBottom: authored.y + authored.height - 12 });
    rest.forEach(function (e, i) { if (Math.abs(restDy[i]) > 0.5) shiftText(svg, e.text, 0, restDy[i]); });
  }

  function anchorOf(text) {
    try { return getComputedStyle(text).textAnchor || "start"; } catch (e) { return "start"; }
  }

  function scaleText(text, scale) {
    if (!(scale > 0) || scale >= 1) return;
    text.style.fontSize = (fontSizeOf(text) * scale) + "px";
  }

  /*
   * Words planned to sit inside a box (a flowchart step, a cell, a pill) are brought back inside it
   * when they overrun its inner edge. The box is the smallest drawn rect that holds the words' centre
   * and is at least as tall as the words; boards drawn for the old, narrower system face overran
   * such boxes by a letter or two once the embedded face landed.
   */
  function fitTextsToContainers(svg, texts, authored) {
    var rects = [];
    var frameArea = authored.width * authored.height;
    Array.prototype.slice.call(svg.querySelectorAll("rect")).forEach(function (rect) {
      if (insideSkipped(rect, svg)) return;
      var b = rootBox(svg, rect);
      if (b && b.width > 0 && b.height > 0 && b.width * b.height < frameArea * 0.25) rects.push(b);
    });
    if (!rects.length) return;
    texts.forEach(function (text) {
      var box = rootBox(svg, text);
      if (!box || box.width <= 0) return;
      var cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      var best = null;
      rects.forEach(function (r) {
        if (cx < r.x || cx > r.x + r.width || cy < r.y || cy > r.y + r.height) return;
        if (r.height < box.height * 0.8) return;
        if (!best || r.width * r.height < best.width * best.height) best = r;
      });
      if (!best) return;
      var scale = containerFitScale(box, anchorOf(text), best, fontSizeOf(text) * 0.25, 0.8);
      if (scale !== null) scaleText(text, scale);
    });
  }

  /* Labels on one row that run into each other give way from their free edges (see rowClearScales). */
  function clearRows(svg, texts) {
    var entries = [];
    texts.forEach(function (text) {
      var box = rootBox(svg, text);
      if (box && box.width > 0) entries.push({ text: text, box: box, anchor: anchorOf(text), size: fontSizeOf(text) });
    });
    entries.sort(function (p, q) { return p.box.x - q.box.x; });
    for (var i = 0; i < entries.length; i += 1) {
      for (var j = i + 1; j < entries.length; j += 1) {
        var a = entries[i], b = entries[j];
        var overlapY = Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y);
        if (overlapY < Math.min(a.box.height, b.box.height) * 0.6) continue;
        var overlapX = Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x);
        // A real overlap is separateTexts' job; this is for words that touch or nearly touch.
        if (overlapX > 6 || b.box.x < a.box.x + a.box.width * 0.5) continue;
        // A subscript or superscript ("CO" then a small "2") is meant to sit tight against its word.
        if (Math.min(a.size, b.size) < Math.max(a.size, b.size) * 0.8) continue;
        var scales = rowClearScales(a.box, a.anchor, b.box, b.anchor, Math.max(a.size, b.size) * 0.15, 0.86);
        if (!scales) continue;
        scaleText(a.text, scales.a);
        scaleText(b.text, scales.b);
        a.box = rootBox(svg, a.text) || a.box;
        b.box = rootBox(svg, b.text) || b.box;
      }
    }
  }

  /*
   * CLEAR THE WORDS. A board authored for a narrower face, or by a model that guessed a width, runs
   * its label into the leader that should start beside it ("surface membrane" printed through its own
   * leader) or starts an arrow inside the words it leaves from. Measured on cached real boards once
   * the embedded font made text ~7% wider than the old system face. The fix is at the stroke's end,
   * never the drawing:
   *   - a straight leader or arrow (a line, a two-point polyline, an "M L" path) that starts or ends
   *     inside a label is trimmed back along itself to just outside the words;
   *   - any other open stroke ending in the words shrinks the words (at most 14%) away from it.
   * Guards, each a real shape that must not be cut: a stroke whose other end is also at the words
   * (an underline, a ring round a term), an end shared with another stroke (the origin two axes
   * meet at, a vertex), and labels of one or two characters (a point "A" on a segment, a "0" tick).
   */
  var CLEAR_GAP = 8;   // the layout contract's "8 beside the words" (lib/drawPrompt.ts)
  var CLEAR_TOUCH = 5; // an end this close to the words already reads as touching them
  function connectorEnds(svg) {
    var out = [];
    var nodes = svg.querySelectorAll("line,polyline,path");
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (insideSkipped(el, svg)) continue;
      try {
        var style = getComputedStyle(el);
        if (el.localName !== "line" && style.fill !== "none") continue;
        var ends = endpointsOf(el);
        var straight = !!ends && !(el.localName === "polyline" && el.points.numberOfItems !== 2);
        if (!ends) {
          if (el.localName !== "path") continue;
          var length = el.getTotalLength();
          if (!(length >= 20)) continue;
          var s = el.getPointAtLength(0), e = el.getPointAtLength(length);
          ends = [[s.x, s.y], [e.x, e.y]];
        }
        var pa = rootPoint(svg, el, ends[0][0], ends[0][1]);
        var pb = rootPoint(svg, el, ends[1][0], ends[1][1]);
        if (Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) < 20) continue;
        var marked = (style.markerEnd && style.markerEnd !== "none") || (style.markerStart && style.markerStart !== "none");
        var step = closestStep(el, svg);
        var stepKind = step ? step.getAttribute("data-teach-kind") : "";
        out.push({ el: el, end: 0, p: pa, other: pb, straight: straight, pointer: marked || stepKind === "label" || stepKind === "arrow" });
        out.push({ el: el, end: 1, p: pb, other: pa, straight: straight, pointer: marked || stepKind === "label" || stepKind === "arrow" });
      } catch (e) {}
    }
    return out;
  }

  function hasDotAt(svg, point) {
    var dots = svg.querySelectorAll("circle,ellipse");
    for (var i = 0; i < dots.length; i += 1) {
      if (insideSkipped(dots[i], svg)) continue;
      var b = rootBox(svg, dots[i]);
      if (b && b.width <= 16 && b.height <= 16 && boxDistance(point.x, point.y, b) <= 4) return true;
    }
    return false;
  }

  function clearStrokeEnds(svg, texts) {
    var ends = null;
    texts.forEach(function (text) {
      if ((text.textContent || "").replace(/\s+/g, "").length < 3) return;
      var box = rootBox(svg, text);
      if (!box || box.width <= 0) return;
      if (!ends) ends = connectorEnds(svg);
      ends.forEach(function (end) {
        if (boxDistance(end.other.x, end.other.y, box) < 16) return;
        var shared = ends.some(function (o) { return o.el !== end.el && Math.abs(o.p.x - end.p.x) < 3 && Math.abs(o.p.y - end.p.y) < 3; });
        if (shared) return;
        var exit = strokeExit(end.p, end.other, box, CLEAR_GAP, CLEAR_TOUCH);
        if (!exit) return;
        var leader = text.__hostLeader && text.__hostLeader.el === end.el;
        if (end.straight && (leader || end.pointer || hasDotAt(svg, end.other))) {
          moveLeaderEnd(svg, { el: end.el, end: end.end }, exit.x - end.p.x, exit.y - end.p.y);
          end.p = exit;
          return;
        }
        var scale = shrinkToClear(box, anchorOf(text), end.p, CLEAR_GAP, 0.86);
        if (scale === null) return;
        scaleText(text, scale);
        box = rootBox(svg, text) || box;
      });
    });
  }

  /*
   * NODES — the round shapes a tree, graph or cycle is drawn with. Dots (a leader's end, a data
   * point) are too small to hold or block anything, and a disc wider than 40% of the board is a
   * backdrop, not a node.
   */
  function boardNodes(svg, authored) {
    var out = [];
    var maxWidth = authored.width * 0.4;
    Array.prototype.slice.call(svg.querySelectorAll("circle,ellipse")).forEach(function (el) {
      if (insideSkipped(el, svg)) return;
      var b = rootBox(svg, el);
      if (!b || b.width < 18 || b.height < 18 || b.width > maxWidth) return;
      out.push({ el: el, kind: "ellipse", box: b, cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2, ry: b.height / 2 });
    });
    // A pill or a cell is a node too: small next to the board, never a panel or a backdrop.
    Array.prototype.slice.call(svg.querySelectorAll("rect")).forEach(function (el) {
      if (insideSkipped(el, svg)) return;
      var b = rootBox(svg, el);
      if (!b || b.width < 18 || b.height < 18) return;
      if (b.width > authored.width * 0.3 || b.height > authored.height * 0.25) return;
      out.push({ el: el, kind: "rect", box: b, cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2, ry: b.height / 2 });
    });
    return out;
  }

  /* The smallest node whose ellipse holds the text's centre — the node that text names. */
  function nodeHolding(nodes, box) {
    var cx = box.x + box.width / 2, cy = box.y + box.height / 2, best = null;
    nodes.forEach(function (n) {
      if (n.kind === "rect") return;
      // Well inside: a caption whose centre only grazes the rim ("after" over a node's top) is not
      // the node's name, and shrinking it into the node hid it.
      var dx = (cx - n.cx) / n.rx, dy = (cy - n.cy) / n.ry;
      if (dx * dx + dy * dy > 0.3) return;
      if (!best || n.rx * n.ry < best.rx * best.ry) best = n;
    });
    return best;
  }

  /*
   * WORDS INSIDE A NODE STAY INSIDE IT. Measured against the circle's real chord at the text's
   * height (not its bounding square): two lines first when it is a tight fit of several words, then
   * shrink — as far as half size, because a node's name spilling over its outline is worse than
   * small type — and the words are kept centred on the node.
   */
  function fitTextsToNodes(svg, texts, nodes) {
    texts.forEach(function (text) {
      // Every fit starts from the words' own size, so words shrunk while their node was still
      // growing grow back once it is full size.
      var original = text.getAttribute("data-host-node-size");
      if (original) text.style.fontSize = original + "px";
      var box = rootBox(svg, text);
      if (!box || box.width <= 0) return;
      var node = nodeHolding(nodes, box);
      if (!node) {
        var cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        for (var r = 0; r < nodes.length; r += 1) {
          if (nodes[r].kind === "rect" && insideNode({ x: cx, y: cy }, nodes[r], 0)) { text.__hostInNode = nodes[r]; break; }
        }
        return;
      }
      text.__hostInNode = node;
      var pad = Math.max(2, fontSizeOf(text) * 0.15);
      var room = ellipseChordWidth(node, box) - 2 * pad;
      if (box.width <= room + 0.5) return;
      // A node this far too small for its words is still growing into place: fit it when it is there.
      if (room < box.width * 0.3) return;
      if (!original) text.setAttribute("data-host-node-size", String(fontSizeOf(text)));
      if (room / box.width < 0.8 && wrapText(text)) {
        var wrapped = rootBox(svg, text);
        if (wrapped) shiftText(svg, text, 0, node.cy - (wrapped.y + wrapped.height / 2));
        box = rootBox(svg, text) || box;
        room = ellipseChordWidth(node, box) - 2 * pad;
        if (box.width <= room + 0.5) return;
      }
      // Shrinking narrows the text, which widens the chord it needs; a few rounds settle it.
      for (var round = 0; round < 4; round += 1) {
        var scale = Math.max(0.5, room / box.width);
        if (scale >= 0.995) break;
        scaleText(text, scale);
        var now = rootBox(svg, text);
        if (!now) break;
        var dx = node.cx - (now.x + now.width / 2), dy = node.cy - (now.y + now.height / 2);
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) shiftText(svg, text, dx, dy);
        box = rootBox(svg, text) || now;
        room = ellipseChordWidth(node, box) - 2 * pad;
        if (box.width <= room + 0.5 || fontSizeOf(text) <= 7) break;
      }
    });
  }

  /*
   * WORDS OUTSIDE A NODE KEEP OFF IT. A caption ("before") written over the top of a node, or a word
   * left behind one ("af…" hidden under the next circle), moves clear on the side it is already on —
   * up if it sits above the node's centre, down if below — or the other way if that would leave the
   * board. Its leader moves with it.
   */
  function clearTextsFromNodes(svg, texts, nodes, authored) {
    var top = authored.y + 4, bottom = authored.y + authored.height - 4;
    texts.forEach(function (text) {
      if (text.__hostInNode) return;
      for (var pass = 0; pass < 3; pass += 1) {
        var box = rootBox(svg, text);
        if (!box || box.width <= 0) return;
        var hit = null;
        for (var i = 0; i < nodes.length && !hit; i += 1) if (nodeHit(box, nodes[i])) hit = nodes[i];
        if (!hit) return;
        var gap = 4;
        var up = hit.box.y - gap - (box.y + box.height);
        var down = hit.box.y + hit.box.height + gap - box.y;
        var preferUp = box.y + box.height / 2 <= hit.cy;
        // The panel the words sit in bounds them too: "before" pushed above its node ran into the
        // panel's top border. Between that edge and the node, the words shrink to the room there is.
        var panel = containerOf(svg, box, authored);
        var ceiling = Math.max(top, panel ? panel.y + 4 : top);
        var floor = Math.min(bottom, panel ? panel.y + panel.height - 4 : bottom);
        var dy = preferUp ? up : down;
        if (box.y + dy < ceiling || box.y + box.height + dy > floor) {
          var room = preferUp ? hit.box.y - gap - ceiling : floor - (hit.box.y + hit.box.height + gap);
          if (room >= box.height * 0.55) {
            scaleText(text, room / box.height);
            box = rootBox(svg, text) || box;
            dy = preferUp ? hit.box.y - gap - (box.y + box.height) : hit.box.y + hit.box.height + gap - box.y;
          } else {
            dy = preferUp ? down : up;
          }
        }
        shiftText(svg, text, 0, dy);
      }
    });
  }

  /* The smallest drawn rect (a panel, a box) that holds a text's centre, or null. */
  function containerOf(svg, box, authored) {
    var cx = box.x + box.width / 2, cy = box.y + box.height / 2, best = null;
    var frameArea = authored.width * authored.height;
    Array.prototype.slice.call(svg.querySelectorAll("rect")).forEach(function (rect) {
      if (insideSkipped(rect, svg)) return;
      var r = rootBox(svg, rect);
      if (!r || r.width * r.height >= frameArea * 0.6) return;
      if (cx < r.x || cx > r.x + r.width || cy < r.y || cy > r.y + r.height) return;
      if (!best || r.width * r.height < best.width * best.height) best = r;
    });
    return best;
  }

  function insideNode(point, n, grow) {
    if (n.kind === "rect") return Math.abs(point.x - n.cx) < n.rx + grow && Math.abs(point.y - n.cy) < n.ry + grow;
    var dx = (point.x - n.cx) / (n.rx + grow), dy = (point.y - n.cy) / (n.ry + grow);
    return dx * dx + dy * dy < 1;
  }

  function nodeHit(box, n) {
    if (n.kind !== "rect") return boxHitsEllipse(box, n, 1);
    return box.x + 1 < n.box.x + n.box.width && box.x + box.width - 1 > n.box.x && box.y + 1 < n.box.y + n.box.height && box.y + box.height - 1 > n.box.y;
  }

  /*
   * A CURVE INTO A NODE. The straight-stroke trim cannot rewrite a Bezier, and a dashed curve drawn
   * from one node's centre to another's crossed both nodes' words. The curve is resampled between
   * the points where it leaves its start node and meets its end node — the same shape, as a fine
   * polyline — so it runs rim to rim.
   */
  function trimCurveAtNodes(svg, el, nodes, gap) {
    if (el.getAttribute("data-host-node-trim-curve") === "1") return;
    var length;
    try { length = el.getTotalLength(); } catch (e) { return; }
    if (!(length >= 20)) return;
    var steps = 80, local = [], root = [];
    for (var i = 0; i <= steps; i += 1) {
      var q = el.getPointAtLength((length * i) / steps);
      local.push(q);
      root.push(rootPoint(svg, el, q.x, q.y));
    }
    var first = 0, last = steps;
    nodes.forEach(function (n) {
      if (insideNode(root[0], n, 0) && !insideNode(root[steps], n, 0)) {
        while (first < steps && insideNode(root[first], n, gap)) first += 1;
      }
      // The end counts as "in" the node once it is within the gap — a head that reaches past a
      // curve's end into the node is the same collision as a curve that enters it.
      if (insideNode(root[steps], n, gap) && !insideNode(root[0], n, 0)) {
        while (last > 0 && insideNode(root[last], n, gap)) last -= 1;
      }
    });
    if ((first === 0 && last === steps) || last - first < 4) return;
    var d = "M" + local[first].x + " " + local[first].y;
    for (var k = first + 1; k <= last; k += 1) d += " L" + local[k].x + " " + local[k].y;
    el.setAttribute("d", d);
    el.setAttribute("data-host-node-trim-curve", "1");
    el.removeAttribute("data-host-length");
  }

  /*
   * How far an arrow's head reaches PAST the end of its line, in root units. A marker anchored at the
   * middle of its triangle (refX at half its width) puts half the head beyond the end, so an arrow
   * trimmed to stop 4 short of a node still cut into it. 0 when there is no end marker.
   */
  function markerOverhang(svg, el) {
    var ref = (el.getAttribute("marker-end") || "").match(/url\(#([^)]+)\)/) || ((getComputedStyle(el).markerEnd || "").match(/url\("?#([^)"]+)"?\)/));
    if (!ref) return 0;
    var marker = svg.querySelector("marker[id='" + ref[1] + "']");
    if (!marker) return 0;
    var stroke = parseFloat(getComputedStyle(el).strokeWidth) || 1;
    var units = marker.getAttribute("markerUnits") === "userSpaceOnUse" ? 1 : stroke;
    var width = parseFloat(marker.getAttribute("markerWidth")) || 3;
    var refX = parseFloat(marker.getAttribute("refX")) || 0;
    var vb = (marker.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    var over = vb.length === 4 && vb[2] > 0 ? ((vb[0] + vb[2] - refX) * width) / vb[2] : width - refX;
    return Math.max(0, over * units);
  }

  /*
   * AN ARROWHEAD NO LONGER THAN ITS ARROW. A marker is sized in stroke widths, so a 4-wide arrow
   * between two close nodes carried a 40-unit head on a 24-unit line, reaching back into the node it
   * leaves. That arrow gets its own copy of the marker, scaled to at most 60% of the line.
   */
  function fitMarkerToStroke(svg, el) {
    if (el.getAttribute("data-host-marker-fit") === "1") return;
    var ref = (el.getAttribute("marker-end") || "").match(/url\(#([^)]+)\)/) || ((getComputedStyle(el).markerEnd || "").match(/url\("?#([^)"]+)"?\)/));
    if (!ref) return;
    var marker = svg.querySelector("marker[id='" + ref[1] + "']");
    if (!marker) return;
    var ends = endpointsOf(el);
    var length;
    try { length = ends ? Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]) : el.getTotalLength(); } catch (e) { return; }
    var stroke = parseFloat(getComputedStyle(el).strokeWidth) || 1;
    var units = marker.getAttribute("markerUnits") === "userSpaceOnUse" ? 1 : stroke;
    var head = (parseFloat(marker.getAttribute("markerWidth")) || 3) * units;
    if (!(length > 0) || head <= length * 0.6) return;
    var f = Math.max(0.25, (length * 0.6) / head);
    var copy = marker.cloneNode(true);
    copy.setAttribute("id", ref[1] + "-host-" + Math.round(f * 100));
    ["markerWidth", "markerHeight"].forEach(function (a) { copy.setAttribute(a, String((parseFloat(marker.getAttribute(a)) || 3) * f)); });
    if (!marker.getAttribute("viewBox")) {
      // Without a viewBox the head is drawn in marker units and markerWidth only clips it: scale the
      // drawing itself, and the point it is anchored by.
      var g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("transform", "scale(" + f + ")");
      while (copy.firstChild) g.appendChild(copy.firstChild);
      copy.appendChild(g);
      ["refX", "refY"].forEach(function (a) { copy.setAttribute(a, String((parseFloat(marker.getAttribute(a)) || 0) * f)); });
    }
    marker.parentNode.appendChild(copy);
    el.setAttribute("marker-end", "url(#" + copy.getAttribute("id") + ")");
    el.style.markerEnd = "url(#" + copy.getAttribute("id") + ")";
    el.setAttribute("data-host-marker-fit", "1");
  }

  /*
   * A STROKE THAT RUNS INTO A NODE STOPS AT ITS RIM. An edge drawn centre to centre crossed the node's
   * words; an arrow's head cut into the circle it points at. A straight stroke whose end lies inside
   * a node (and whose other end does not) is trimmed back to the rim — an arrow a few units short of
   * it, so the whole head sits outside.
   */
  function trimConnectorsAtNodes(svg, nodes) {
    if (!nodes.length) return;
    var ends = connectorEnds(svg);
    ends.forEach(function (end) {
      if (end.straight || end.end !== 0 || end.el.localName !== "path") return;
      trimCurveAtNodes(svg, end.el, nodes, end.pointer ? 4 + markerOverhang(svg, end.el) : 0);
    });
    ends.forEach(function (end) {
      if (!end.straight || end.el.getAttribute("data-host-node-trim-" + end.end) === "1") return;
      var gap = end.pointer ? 4 + (end.end === 1 ? markerOverhang(svg, end.el) : 0) : 0;
      for (var i = 0; i < nodes.length; i += 1) {
        var n = nodes[i];
        if (n.el === end.el) continue;
        var inP = insideNode(end.p, n, gap);
        var inOther = insideNode(end.other, n, 0);
        if (!inP || inOther) continue;
        var entry = n.kind === "rect" ? segmentBoxEntry(end.other, end.p, n.box, gap) : segmentEllipseEntry(end.other, end.p, n, gap);
        if (!entry) continue;
        moveLeaderEnd(svg, { el: end.el, end: end.end }, entry.x - end.p.x, entry.y - end.p.y);
        end.el.setAttribute("data-host-node-trim-" + end.end, "1");
        end.p = entry;
        break;
      }
    });
    ends.forEach(function (end) { if (end.end === 1 && end.pointer) fitMarkerToStroke(svg, end.el); });
  }

  /* Runs once per new text node; the set can grow when the component renders text conditionally. */
  function layoutBoardText(svg) {
    var authored = authoredFrame(svg);
    var safe = {
      x0: authored.x + authored.width * 0.05,
      x1: authored.x + authored.width * 0.95,
      y0: authored.y + authored.height * 0.05,
      y1: authored.y + authored.height * 0.955
    };
    var fresh = Array.prototype.slice.call(svg.querySelectorAll("text")).filter(function (t) {
      return t.getAttribute("data-host-fit") !== "1" && !insideSkipped(t, svg) && (t.textContent || "").trim();
    });
    if (!fresh.length) return false;
    assignLeaders(svg, fresh);
    fresh.forEach(function (text) { fitTextInside(svg, text, safe); text.setAttribute("data-host-fit", "1"); });
    var nodes = boardNodes(svg, authored);
    fitTextsToNodes(svg, fresh, nodes);
    clearTextsFromNodes(svg, fresh, nodes, authored);
    trimConnectorsAtNodes(svg, nodes);
    separateTexts(svg, fresh, authored);
    fitTextsToContainers(svg, fresh, authored);
    clearRows(svg, fresh);
    clearStrokeEnds(svg, fresh);
    clearTextsFromStrokes(svg, fresh);
    return true;
  }

  /*
   * WORDS KEEP OFF LINES. A caption written across a curve ("careful gradients matter" struck through
   * by the board's own arc) or a note running into a panel's border (reported 2026-09-29). The
   * passes above keep words off NODES — circles and boxes as solid things — but a stroke is only a
   * line, so nothing looked at it. Each word box is sampled against every stroke that could touch it
   * (isPointInStroke, in the stroke's own coordinates); a crossed text moves the smallest distance up
   * or down that clears every stroke and every other word, or shrinks a little from its anchor, and
   * is otherwise left where it was — never moved far from what it describes.
   */
  function clearTextsFromStrokes(svg, texts) {
    var screen = svg.getScreenCTM && svg.getScreenCTM();
    if (!screen || !window.DOMPoint) return;
    var strokes = Array.prototype.slice.call(svg.querySelectorAll("path, line, polyline, polygon, rect, circle, ellipse")).filter(function (el) {
      if (insideSkipped(el, svg) || (el.closest && el.closest("[data-board-labels],[data-board-pen],[data-board-annotation]"))) return false;
      if (typeof el.isPointInStroke !== "function") return false;
      try {
        var cs = getComputedStyle(el);
        if (!cs.stroke || cs.stroke === "none" || parseFloat(cs.strokeWidth) <= 0 || parseFloat(cs.opacity) === 0) return false;
      } catch (e) { return false; }
      return true;
    }).map(function (el) {
      var box = rootBox(svg, el);
      var local = null;
      try { local = el.getScreenCTM().inverse().multiply(screen); } catch (e) {}
      return box && local ? { el: el, box: box, local: local } : null;
    }).filter(Boolean);
    if (!strokes.length) return;
    var others = texts.slice();
    function crossings(box) {
      var n = 0;
      var near = strokes.filter(function (s) {
        return s.box.x < box.x + box.width + 6 && box.x < s.box.x + s.box.width + 6 && s.box.y < box.y + box.height + 6 && box.y < s.box.y + s.box.height + 6;
      });
      if (!near.length) return 0;
      // A margin round the words: a stroke grazing the last letter is as bad as one through it.
      var M = 3;
      var ys = [box.y - M, box.y + box.height * 0.3, box.y + box.height * 0.55, box.y + box.height * 0.8, box.y + box.height + M];
      for (var r = 0; r < ys.length; r += 1) {
        var y = ys[r];
        for (var x = box.x - M; x <= box.x + box.width + M; x += 2.5) {
          for (var k = 0; k < near.length; k += 1) {
            try {
              var pt = new DOMPoint(x, y).matrixTransform(near[k].local);
              if (near[k].el.isPointInStroke(pt)) { n += 1; break; }
            } catch (e) {}
          }
        }
      }
      return n;
    }
    function hitsWords(box, self) {
      return others.some(function (t) {
        if (t === self) return false;
        var o = rootBox(svg, t);
        return o && o.width > 0 && box.x < o.x + o.width + 2 && o.x < box.x + box.width + 2 && box.y < o.y + o.height + 2 && o.y < box.y + box.height + 2;
      });
    }
    texts.forEach(function (text) {
      if (text.closest && text.closest("[data-board-labels],[data-board-pen],[data-board-annotation]")) return;
      var box = rootBox(svg, text);
      if (!box || box.width <= 0) return;
      var hits = crossings(box);
      if (hits === 0) return;
      // First a little smaller, from its anchor: a note stays beside its bullet, a caption on its line.
      var size = fontSizeOf(text);
      for (var scale = 0.92; scale >= 0.83; scale -= 0.08) {
        text.style.fontSize = (size * scale) + "px";
        var smaller = rootBox(svg, text);
        if (smaller && crossings(smaller) === 0) { text.setAttribute("data-host-stroke", "shrunk " + scale.toFixed(2)); return; }
      }
      text.style.fontSize = size + "px";
      // Then the smallest move up or down that clears every stroke and every other word. Words held
      // inside a node or panel do not move out of it.
      if (!text.__hostInNode) {
        // Nearest first: straight up or down, then sideways, then diagonally — a caption on a
        // slanted arrow clears it sideways, where no vertical move ever would.
        var moves = [];
        [4, 8, 12, 16, 22, 28, 36].forEach(function (d) {
          moves.push([0, d], [0, -d], [d, 0], [-d, 0], [d, d], [-d, d], [d, -d], [-d, -d]);
        });
        moves.sort(function (a, b) { return Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]); });
        var frame = authoredFrame(svg);
        for (var i = 0; i < moves.length; i += 1) {
          var moved = { x: box.x + moves[i][0], y: box.y + moves[i][1], width: box.width, height: box.height };
          if (moved.x < frame.x + 8 || moved.x + moved.width > frame.x + frame.width - 8) continue;
          if (crossings(moved) === 0 && !hitsWords(moved, text)) {
            shiftText(svg, text, moves[i][0], moves[i][1]);
            text.setAttribute("data-host-stroke", "moved " + moves[i].join(","));
            return;
          }
        }
      }
      text.setAttribute("data-host-stroke", "unresolved " + hits + (text.__hostInNode ? " in-node" : ""));
    });
  }

  /* ---------- the drawing's extent, and fitting it to the pane ---------- */

  function explicitlyHidden(node, svg) {
    for (var n = node; n && n !== svg; n = n.parentNode) {
      if (!n.getAttribute) continue;
      if (n.getAttribute("opacity") === "0" || n.getAttribute("display") === "none" || n.getAttribute("visibility") === "hidden") return true;
      if (n.style && (n.style.opacity === "0" || n.style.display === "none")) {
        // The teaching timeline's own inline opacity is not the author hiding something.
        if (!(n.hasAttribute && n.hasAttribute("data-teach-order"))) return true;
      }
    }
    return false;
  }

  function colourLightness(value) {
    var m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/.exec(value || "");
    if (!m) return null;
    if (m[4] !== undefined && Number(m[4]) === 0) return null;
    return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
  }

  /*
   * The ink box of everything drawn, in authored units, ignoring the paper: rects that cover half
   * the frame are background or frame, not content. Frame rects are also marked so they can be
   * hidden once the board is fitted — a border drawn around the old 1000x560 box would otherwise
   * float in the middle of a fitted pane.
   */
  function measureInk(svg) {
    var authored = authoredFrame(svg);
    var area = authored.width * authored.height;
    var ink = null;
    var paper = null;
    var nodes = svg.querySelectorAll(GRAPHIC_SELECTOR);
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (insideSkipped(el, svg) || explicitlyHidden(el, svg)) continue;
      var box = rootBox(svg, el);
      if (!box || (box.width <= 0 && box.height <= 0)) continue;
      var style = getComputedStyle(el);
      if (el.localName === "rect" && box.width * box.height >= area * 0.5) {
        var fillLight = colourLightness(style.fill);
        var strokeLight = colourLightness(style.stroke);
        if (fillLight !== null && box.width * box.height >= area * 0.85 && (!paper || box.width * box.height > paper.area)) paper = { colour: style.fill, area: box.width * box.height };
        if ((fillLight === null || fillLight > 0.9) && (strokeLight === null || strokeLight > 0.72)) el.setAttribute("data-host-frame", "1");
        continue;
      }
      if (el.localName !== "text" && style.fill === "none" && (style.stroke === "none" || !style.stroke)) continue;
      var sw = el.localName === "text" ? 0 : (parseFloat(style.strokeWidth) || 0) / 2;
      var seen = visiblePart({ x: box.x - sw, y: box.y - sw, width: box.width + sw * 2, height: box.height + sw * 2 }, authored);
      if (seen) ink = boxUnion(ink, seen);
    }
    return { ink: ink, paper: paper ? paper.colour : null };
  }

  /*
   * Fits the viewBox to the measured ink and the pane's aspect. The PDF split view gives the board
   * a near-square column (~772x690); a fixed 1000x560 frame letterboxed into it left ~40% of the
   * pane empty and the labels small. Re-run on every resize, from the ink measured once at mount.
   */
  var boardInk = null;
  var boardPaper = null;
  var lastViewportKey = "";
  function fitBoardToPane(svg) {
    if (!svg || !boardInk) return;
    var rootEl = document.getElementById("root");
    var container = { width: rootEl ? rootEl.clientWidth : window.innerWidth, height: rootEl ? rootEl.clientHeight : window.innerHeight };
    var fitted = fitViewBox(boardInk, container, authoredFrame(svg));
    if (!fitted) return;
    var value = [fitted.x, fitted.y, fitted.width, fitted.height].map(function (n) { return Math.round(n * 100) / 100; }).join(" ");
    if (svg.getAttribute("viewBox") !== value) svg.setAttribute("viewBox", value);
    if (svg.getAttribute("preserveAspectRatio") !== "xMidYMid meet") svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("data-host-fitted", "1");
    if (boardPaper) {
      document.body.style.background = boardPaper;
      if (rootEl) rootEl.style.background = boardPaper;
    }
    var key = value + "|" + container.width + "x" + container.height;
    if (key !== lastViewportKey) {
      lastViewportKey = key;
      postToParent({ type: "viewport", viewBox: { x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height }, authored: authoredFrame(svg), width: container.width, height: container.height });
    }
  }

  /* ---------- the teaching timeline ---------- */

  function closestStep(node, svg) {
    for (var n = node; n && n !== svg; n = n.parentNode) {
      if (n.hasAttribute && n.hasAttribute("data-teach-order")) return n;
    }
    return null;
  }

  function arrowTip(svg, step) {
    var strokes = step.matches("path,line,polyline") ? [step] : Array.prototype.slice.call(step.querySelectorAll("path,line,polyline"));
    var best = null, bestLength = 0;
    strokes.forEach(function (el) {
      if (insideSkipped(el, svg)) return;
      var length = 0;
      try { length = el.getTotalLength(); } catch (e) { length = 0; }
      if (length > bestLength) { bestLength = length; best = el; }
    });
    if (!best || bestLength < 8) return null;
    var style = getComputedStyle(best);
    var hasEnd = best.hasAttribute("marker-end") || (style.markerEnd && style.markerEnd !== "none");
    var hasStart = best.hasAttribute("marker-start") || (style.markerStart && style.markerStart !== "none");
    try {
      var p = best.getPointAtLength(!hasEnd && hasStart ? 0 : bestLength);
      return rootPoint(svg, best, p.x, p.y);
    } catch (e) { return null; }
  }

  /*
   * Everything the timeline needs that does not change frame to frame: nesting, what each arrow
   * points at, the shapes and texts each step owns, the unscheduled leaders that belong to a label,
   * and the resolved schedule. Rebuilt only when React swaps the set of timed nodes.
   */
  var teachingPlan = null;
  function planFor(svg, steps) {
    if (teachingPlan && teachingPlan.svg === svg && teachingPlan.steps.length === steps.length &&
        teachingPlan.steps.every(function (s, i) { return s === steps[i]; })) return teachingPlan;
    var index = new Map();
    steps.forEach(function (s, i) { index.set(s, i); });
    var parent = steps.map(function (step) {
      for (var p = step.parentNode; p && p !== svg; p = p.parentNode) { if (index.has(p)) return index.get(p); }
      return -1;
    });
    var boxes = steps.map(function (s) { return rootBox(svg, s); });
    var kinds = steps.map(function (s) { return s.getAttribute("data-teach-kind") || "diagram"; });
    var head = steps.map(function (step, i) {
      if (kinds[i] !== "arrow") return -1;
      var tip = arrowTip(svg, step);
      if (!tip) return -1;
      var best = -1, bestScore = Infinity;
      steps.forEach(function (other, j) {
        if (j === i || !boxes[j] || kinds[j] === "arrow") return;
        if (step.contains(other) || other.contains(step)) return;
        var d = boxDistance(tip.x, tip.y, boxes[j]);
        if (d > 28) return;
        var score = d + 0.03 * Math.sqrt(Math.max(1, boxes[j].width * boxes[j].height));
        if (score < bestScore) { bestScore = score; best = j; }
      });
      return best;
    });
    var sentenceTimed = steps.every(function (s) {
      var raw = s.getAttribute("data-teach-sentence");
      return raw !== null && raw !== "" && isFinite(Number(raw));
    });
    var entries = steps.map(function (step, i) {
      return { order: numberAttr(step, "data-teach-order", i), sentence: sentenceTimed ? numberAttr(step, "data-teach-sentence", 0) : 0, kind: kinds[i], parent: parent[i], head: head[i] };
    });
    var eff = resolveTeachingSchedule(entries);
    var ownShapes = steps.map(function () { return []; });
    var ownTexts = steps.map(function () { return []; });
    steps.forEach(function (step, i) {
      var nodes = step.matches("path,line,polyline,polygon,circle,ellipse,rect,text") ? [step] : [];
      nodes = nodes.concat(Array.prototype.slice.call(step.querySelectorAll("path,line,polyline,polygon,circle,ellipse,rect,text")));
      nodes.forEach(function (node) {
        if (insideSkipped(node, svg) || closestStep(node, svg) !== step) return;
        if (node.localName === "text") ownTexts[i].push(node); else ownShapes[i].push(node);
      });
    });
    // A leader line (and its dot) the author left untimed would sit on the board from the first
    // frame, pointing at a label that does not exist yet. It now draws with its label.
    //
    // The same goes for a leader held by a label GROUP that also holds the timed labels: one group
    // with every leader on its side of the drawing, each label timed to its own sentence
    // (measured: a palisade-cell board drew the "surface membrane" leader in sentence 1 and wrote
    // its words in sentence 3, a line pointing at nothing for two sentences). A leader already in
    // its own label's step keeps the ordinary leader-then-words reveal.
    var attachments = steps.map(function () { return []; });
    function detach(node, owner) {
      if (owner < 0) return;
      var at = ownShapes[owner].indexOf(node);
      if (at >= 0) ownShapes[owner].splice(at, 1);
    }
    steps.forEach(function (step, i) {
      if (kinds[i] !== "label" && kinds[i] !== "write") return;
      ownTexts[i].forEach(function (text) {
        var box = rootBox(svg, text);
        if (!box) return;
        var leader = text.__hostLeader !== undefined ? text.__hostLeader : findLeader(svg, text, box);
        if (!leader) return;
        var holder = closestStep(leader.el, svg);
        var holderIndex = holder ? steps.indexOf(holder) : -1;
        // Only a label group that CONTAINS timed labels hands a leader over. The contract's own
        // pattern — a leader group, then its words as the next step — already reveals in order.
        if (holder && (holderIndex === i || holderIndex < 0 || kinds[holderIndex] !== "label" || parent.indexOf(holderIndex) < 0)) return;
        detach(leader.el, holderIndex);
        attachments[i].push(leader.el);
        var ends = endpointsOf(leader.el);
        if (!ends) return;
        var far = rootPoint(svg, leader.el, ends[1 - leader.end][0], ends[1 - leader.end][1]);
        Array.prototype.slice.call(svg.querySelectorAll("circle,ellipse")).forEach(function (dot) {
          if (insideSkipped(dot, svg)) return;
          var dotHolder = closestStep(dot, svg);
          if (dotHolder && dotHolder !== holder) return;
          var b = rootBox(svg, dot);
          if (b && b.width <= 16 && b.height <= 16 && boxDistance(far.x, far.y, b) <= 4) {
            detach(dot, holderIndex);
            attachments[i].push(dot);
          }
        });
      });
    });
    var rank = steps.map(function (_, i) { return i; }).sort(function (a, b) {
      return eff[a].sentence - eff[b].sentence || eff[a].key - eff[b].key || a - b;
    });
    // An arrowhead drawn as its own small filled shape (a polygon at the tip) settled its fill from
    // the first moment of the step, so a faint head sat at the target before the shaft had left the
    // tail. Heads now land when the shaft arrives, as marker heads already do.
    var heads = steps.map(function (step, i) {
      if (kinds[i] !== "arrow") return [];
      var found = [];
      ownShapes[i] = ownShapes[i].filter(function (shape) {
        if (shape.localName !== "polygon" && shape.localName !== "path") return true;
        try {
          var cs = getComputedStyle(shape);
          if (!cs.fill || cs.fill === "none") return true;
          var b = shape.getBBox();
          if (b.width > 36 || b.height > 36) return true;
        } catch (e) { return true; }
        found.push(shape);
        return false;
      });
      return found;
    });
    teachingPlan = {
      svg: svg, steps: steps, kinds: kinds, eff: eff, rank: rank, sentenceTimed: sentenceTimed, heads: heads,
      container: parent.map(function () { return false; }), ownShapes: ownShapes, ownTexts: ownTexts, attachments: attachments,
      weights: steps.map(function (s) { return Math.max(0.35, numberAttr(s, "data-teach-weight", 1)); })
    };
    parent.forEach(function (p) { if (p >= 0) teachingPlan.container[p] = true; });
    return teachingPlan;
  }

  /*
   * Trace a shape's outline, then settle its fill. The AUTHOR'S styling is the ceiling, never
   * replaced: the old reveal wrote opacity 1 and fill-opacity 1 onto every shape, so a 0.15-opacity
   * shading layer rendered as a solid dark band, an opacity={draw} fade was flattened, and a dashed
   * line was redrawn solid. Each shape's own opacity is left alone (its step's opacity is what hides
   * it before its turn); fill settles up to the authored fill-opacity; dashed strokes keep their
   * pattern. ownVisibility is for untimed leaders attached to a label, which have no step to hide
   * them.
   */
  function strokeReveal(shapes, local, ownVisibility) {
    shapes.forEach(function (shape) {
      var base = shape.__hostBase;
      if (!base) {
        var cs = getComputedStyle(shape);
        base = shape.__hostBase = {
          fillOpacity: isFinite(parseFloat(cs.fillOpacity)) ? parseFloat(cs.fillOpacity) : 1,
          filled: cs.fill && cs.fill !== "none",
          dashed: cs.strokeDasharray && cs.strokeDasharray !== "none",
          stroked: cs.stroke && cs.stroke !== "none" && parseFloat(cs.strokeWidth) > 0,
          marked: (cs.markerEnd && cs.markerEnd !== "none") || shape.hasAttribute("marker-end"),
          pathLength: shape.getAttribute("pathLength")
        };
      }
      if (ownVisibility) shape.style.opacity = local <= 0 ? "0" : "";
      if (base.stroked && !base.dashed) {
        if (local >= 1) {
          // Finished: hand the outline back exactly as authored. A dash of length 1 on a unit
          // pathLength still left a hairline notch at the start of closed shapes on some joins.
          if (base.pathLength === null) shape.removeAttribute("pathLength"); else shape.setAttribute("pathLength", base.pathLength);
          shape.style.strokeDasharray = "";
          shape.style.strokeDashoffset = "";
        } else {
          shape.setAttribute("pathLength", "1");
          shape.style.strokeDasharray = "1";
          shape.style.strokeDashoffset = String(1 - local);
        }
      }
      // An arrowhead is drawn at the path's END whatever the dash shows, so it used to sit at the
      // target before its shaft had left the tail. It now arrives with the shaft.
      if (base.marked) shape.style.markerEnd = local < 0.96 ? "none" : "";
      if (base.filled) {
        var settle = base.stroked ? Math.max(0, (local - 0.46) / 0.54) : clamp01(local * 1.6);
        shape.style.fillOpacity = String(base.fillOpacity * settle);
      }
    });
  }

  function clipFor(svg, id) {
    var defs = svg.querySelector("defs[data-host-defs]");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      defs.setAttribute("data-host-defs", "1");
      svg.insertBefore(defs, svg.firstChild);
    }
    var clip = defs.querySelector("#" + id);
    if (!clip) {
      clip = document.createElementNS(SVG_NS, "clipPath");
      clip.id = id;
      defs.appendChild(clip);
    }
    return clip;
  }

  function setClipRects(clip, rects) {
    while (clip.childNodes.length > rects.length) clip.removeChild(clip.lastChild);
    while (clip.childNodes.length < rects.length) clip.appendChild(document.createElementNS(SVG_NS, "rect"));
    rects.forEach(function (r, i) {
      var el = clip.childNodes[i];
      el.setAttribute("x", String(r.x)); el.setAttribute("y", String(r.y));
      el.setAttribute("width", String(Math.max(0, r.width))); el.setAttribute("height", String(Math.max(0, r.height)));
    });
  }

  /*
   * HANDWRITING, ON REAL WORDS. The ink edge sweeps through the measured extent of the current word;
   * completed lines of a wrapped label stay fully shown; a settled hand finishes its word (or line)
   * and never takes it back when the clock resumes.
   */
  function writeText(svg, text, local, clipId, settle) {
    if (local >= 1) { text.removeAttribute("clip-path"); return null; }
    var clip;
    if (local <= 0) {
      // Not started: fully masked. (Its step may already be visible — the leader draws first.)
      text.__hostMinWord = 0;
      clip = clipFor(svg, clipId);
      setClipRects(clip, [{ x: 0, y: 0, width: 0, height: 0 }]);
      text.setAttribute("clip-path", "url(#" + clipId + ")");
      return null;
    }
    var measured = measuredWords(text);
    if (!measured) {
      // Unmeasurable markup: the old proportional sweep over the whole box.
      var bb = null;
      try { bb = text.getBBox(); } catch (e) { bb = null; }
      if (!bb) return null;
      var fallback = writingPosition(String(text.textContent || "").trim().split(/\s+/).filter(Boolean), local);
      var written = fallback.count ? (fallback.index + fallback.fraction) / fallback.count : local;
      if (written >= 0.97) { text.removeAttribute("clip-path"); return null; }
      var over = Math.max(14, bb.height * 0.55);
      clip = clipFor(svg, clipId);
      setClipRects(clip, [{ x: bb.x - over * 0.35, y: bb.y - over, width: bb.width * written + over, height: bb.height + over * 2 }]);
      text.setAttribute("clip-path", "url(#" + clipId + ")");
      return { x: bb.x + bb.width * written, y: bb.y + bb.height * 0.72 };
    }
    var position = writingPosition(measured.words, local);
    var minWord = text.__hostMinWord || 0;
    if (minWord > 0 && (position.index < minWord - 1 || (position.index === minWord - 1 && position.fraction < 1))) {
      position = { index: minWord - 1, fraction: 1, count: position.count };
    }
    var edge = writingEdge(measured.boxes, position, settle);
    if (!edge) return null;
    if (settle === "word" && position.fraction > 0) text.__hostMinWord = Math.max(minWord, position.index + 1);
    if (settle === "line") {
      var last = position.index;
      while (last + 1 < measured.boxes.length && measured.boxes[last + 1].line === measured.boxes[position.index].line) last += 1;
      text.__hostMinWord = Math.max(minWord, last + 1);
    }
    var finished = position.index === measured.boxes.length - 1 && (position.fraction >= 0.97 || edge.done);
    if (finished) { text.removeAttribute("clip-path"); return null; }
    // Cached with the word boxes: a getComputedStyle per text per frame forced a style recalc after
    // every write the timeline had just made.
    var size = measured.size;
    var padX = size * 0.35, padY = size * 0.24;
    var lead = settle ? size * 0.12 : size * 0.1;
    var rects = [];
    var lines = measured.lines.slice().sort(function (a, b) { return a.y0 - b.y0; });
    measured.lines.forEach(function (line, l) {
      // A line's reveal stops halfway to its neighbours: padded rects overlapped the next line's
      // ascenders, so the top of an unwritten "l" peeked out under a finished first line.
      var k = lines.indexOf(line);
      var top = k > 0 ? Math.max(line.y0 - padY, (lines[k - 1].y1 + line.y0) / 2) : line.y0 - padY;
      var bottom = k < lines.length - 1 ? Math.min(line.y1 + padY, (line.y1 + lines[k + 1].y0) / 2) : line.y1 + padY;
      if (l < edge.line) rects.push({ x: line.x0 - padX, y: top, width: line.x1 - line.x0 + padX * 2, height: bottom - top });
      else if (l === edge.line) rects.push({ x: line.x0 - padX, y: top, width: Math.max(0, edge.x + lead - (line.x0 - padX)), height: bottom - top });
    });
    clip = clipFor(svg, clipId);
    setClipRects(clip, rects);
    text.setAttribute("clip-path", "url(#" + clipId + ")");
    var current = measured.lines[edge.line];
    return current ? { x: edge.x, y: current.y0 + (current.y1 - current.y0) * 0.72 } : null;
  }

  function writeTexts(svg, texts, local, stepIndex, settle) {
    var tip = null;
    var n = texts.length;
    texts.forEach(function (text, k) {
      var part = n > 1 ? clamp01(local * n - k) : local;
      var at = writeText(svg, text, part, "teacher-clip-" + stepIndex + "-" + k, settle);
      if (at && part > 0 && part < 1) tip = { node: text, point: at };
    });
    return tip;
  }

  /*
   * NODES THAT GROW. A node whose radius is driven by the animation ("Perceptron" in a circle that
   * swells into place) measured as nothing when its words were first laid out, so the words spilled
   * over it once it was full size. The node rules are re-applied as the drawing settles — every
   * 400 ms at most. Each rule acts only on a real overlap, so repeating it changes nothing that is
   * already clear.
   */
  function refitNodes(svg) {
    var now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (svg.__hostNodeRefitAt && now - svg.__hostNodeRefitAt < 400) return;
    svg.__hostNodeRefitAt = now;
    var authored = authoredFrame(svg);
    var texts = Array.prototype.slice.call(svg.querySelectorAll("text")).filter(function (t) {
      return t.getAttribute("data-host-fit") === "1" && !insideSkipped(t, svg) && (t.textContent || "").trim();
    });
    if (!texts.length) return;
    var nodes = boardNodes(svg, authored);
    if (!nodes.length) return;
    texts.forEach(function (t) { t.__hostInNode = null; });
    fitTextsToNodes(svg, texts, nodes);
    clearTextsFromNodes(svg, texts, nodes, authored);
    trimConnectorsAtNodes(svg, nodes);
  }

  function ensureBoardLayout(svg) {
    try {
      authoredFrame(svg);
      layoutBoardText(svg);
      refitNodes(svg);
      if (boardInk && svg.getAttribute("data-host-fitted") !== "1") fitBoardToPane(svg);
      else if (boardInk && svg.getAttribute("viewBox") !== svg.getAttribute("data-host-last-viewbox")) {
        // React only writes viewBox when the prop changes, but a re-created <svg> or a component
        // that animates its own viewBox resets it; put the fitted frame back.
        fitBoardToPane(svg);
      }
      svg.setAttribute("data-host-last-viewbox", svg.getAttribute("viewBox") || "");
    } catch (e) {}
  }

  function applyTeachingTimeline(progress, sentenceIndex, sentenceProgress, sentenceTotal, settle) {
    var svg = document.querySelector("#root svg");
    if (!svg) return;
    ensureBoardLayout(svg);
    var steps = Array.prototype.slice.call(svg.querySelectorAll("[data-teach-order]"));
    if (!steps.length) {
      postToParent({ type: "marker", x: 50, y: 28, rotate: 18, visible: false });
      return;
    }
    var plan = planFor(svg, steps);
    var total = Math.max(1, sentenceTotal);
    var sentenceTimed = plan.sentenceTimed && isFinite(sentenceIndex) && isFinite(sentenceProgress);
    var ranges = new Array(steps.length);
    if (sentenceTimed) {
      /*
       * BROKEN SENTENCE TAGS ARE SPREAD, NOT OBEYED. A board whose parts are tagged past the end of
       * the script (clamped to the last sentence) drew them all in one burst as the voice finished;
       * one tagging most parts to sentence 0 drew everything before the teacher had said it. When
       * the tags cover too few of the spoken sentences, or many point past the end, the parts are
       * spread across the narration in their drawing order instead — one sentence at a time.
       */
      var tagged = {};
      var beyond = 0;
      plan.rank.forEach(function (i) {
        var raw = plan.eff[i].sentence;
        if (raw >= total) beyond += 1;
        tagged[Math.max(0, Math.min(total - 1, raw))] = true;
      });
      var usedCount = Object.keys(tagged).length;
      var n = plan.rank.length;
      var degenerate = total >= 3 && n >= 3 && (beyond > n / 3 || usedCount <= Math.max(1, Math.floor(total / 3)));
      var spreadSentence = {};
      if (degenerate) {
        plan.rank.forEach(function (i, r) { spreadSentence[i] = Math.min(total - 1, Math.floor((r * total) / n)); });
      }
      var grouped = new Map();
      plan.rank.forEach(function (i) {
        var s = degenerate ? spreadSentence[i] : Math.max(0, Math.min(total - 1, plan.eff[i].sentence));
        var list = grouped.get(s) || [];
        list.push(i);
        grouped.set(s, list);
      });
      grouped.forEach(function (list, s) {
        var weight = list.reduce(function (sum, i) { return sum + plan.weights[i]; }, 0);
        var cursor = 0;
        list.forEach(function (i) {
          ranges[i] = { sentence: s, start: cursor / weight, end: (cursor + plan.weights[i]) / weight };
          cursor += plan.weights[i];
        });
      });
    } else {
      var succession = successionRanges(plan.rank.map(function (i) { return plan.weights[i]; }));
      plan.rank.forEach(function (i, r) { ranges[i] = { sentence: 0, start: succession[r].start, end: succession[r].end }; });
    }

    var active = null;
    steps.forEach(function (step, index) {
      var kind = plan.kinds[index];
      var textual = kind === "write" || kind === "label";
      // Drawn contours ease (Manim's default on Create); handwriting keeps an even pace.
      var ease = textual ? clamp01 : smooth;
      var range = ranges[index] || { sentence: 0, start: 0, end: 1 };
      var local;
      if (sentenceTimed) {
        local = sentenceIndex > range.sentence ? 1 : sentenceIndex < range.sentence ? 0 : phase(sentenceProgress, range.start, range.end, ease);
      } else {
        local = phase(progress, range.start, range.end, ease);
      }
      // High-water mark: once shown (including by a settle), a step is not un-drawn by a clock that
      // resumes slightly behind; only a real rewind (local back to 0) resets it.
      if (local <= 0) step.__hostHigh = 0;
      else local = Math.max(local, step.__hostHigh || 0);
      if (settle === "line" && local > 0 && local < 1 && !textual) local = 1;
      step.__hostHigh = local;

      step.style.opacity = local <= 0 ? "0" : "1";
      step.style.transition = "none";
      step.removeAttribute("clip-path");
      var shapes = plan.ownShapes[index];
      var texts = plan.ownTexts[index];
      var tip = null;
      if (textual) {
        // A label drawn as leader + dot + words: the leader reaches the part first, then the words.
        var shapeLocal = texts.length ? clamp01(local / 0.35) : local;
        var textLocal = shapes.length || plan.attachments[index].length ? clamp01((local - 0.25) / 0.75) : local;
        strokeReveal(shapes, shapeLocal);
        tip = writeTexts(svg, texts, textLocal, index, settle);
      } else if (kind === "diagram" || kind === "arrow" || kind === "annotate") {
        // The ink trails the step a hair (the nib leads), but must still CLOSE at the end: the old
        // "local - 0.025" left every outline 2.5% short forever — a notch at each path's start.
        strokeReveal(shapes, clamp01((local - 0.025) / 0.975));
        if (plan.heads[index].length) strokeReveal(plan.heads[index], clamp01((local - 0.9) / 0.1));
        tip = writeTexts(svg, texts, clamp01((local - 0.5) / 0.5), index, settle);
      } else {
        step.style.opacity = String(local);
      }
      plan.attachments[index].forEach(function (node) { strokeReveal([node], clamp01(local / 0.35), true); });
      if (local > 0 && local < 1 && !plan.container[index]) active = { step: step, kind: kind, local: local, tip: tip };
    });

    if (!active) {
      postToParent({ type: "marker", x: 50, y: 25, rotate: 18, visible: false });
      return;
    }
    var point = null;
    if (active.tip) {
      point = rootPoint(svg, active.tip.node, active.tip.point.x, active.tip.point.y);
    } else {
      var box = rootBox(svg, active.step);
      if (box) point = { x: box.x + box.width * active.local, y: box.y + box.height * (0.25 + active.local * 0.5) };
    }
    if (!point) return;
    var screenX = point.x, screenY = point.y;
    try {
      var sp = svg.createSVGPoint();
      sp.x = point.x; sp.y = point.y;
      var matrix = svg.getScreenCTM();
      if (matrix) { var q = sp.matrixTransform(matrix); screenX = q.x; screenY = q.y; }
    } catch (e) {}
    var vw = Math.max(1, document.documentElement.clientWidth);
    var vh = Math.max(1, document.documentElement.clientHeight);
    postToParent({
      type: "marker",
      x: Math.max(2, Math.min(98, screenX / vw * 100)),
      y: Math.max(3, Math.min(96, screenY / vh * 100)),
      rotate: active.kind === "arrow" ? 34 : active.kind === "write" || active.kind === "label" ? 14 : 24,
      visible: true
    });
  }

  /*
   * Mount-time layout, before the first visible frame: render the finished board, fit its text,
   * measure its ink (at the end and at the midpoint, so motion that travels is inside the frame),
   * and fit the viewBox. The caller renders the real starting progress straight after, in the same
   * task, so the finished board is never painted.
   */
  function prepareBoardLayout(renderAt) {
    var measured = null;
    [1, 0.5].forEach(function (p) {
      renderAt(p);
      var svg = document.querySelector("#root > svg");
      if (!svg) return;
      try {
        authoredFrame(svg);
        layoutBoardText(svg);
        var m = measureInk(svg);
        measured = measured ? { ink: boxUnion(measured.ink, m.ink), paper: measured.paper || m.paper } : m;
      } catch (e) {}
    });
    var svg = document.querySelector("#root > svg");
    if (svg && measured && measured.ink) {
      boardInk = measured.ink;
      boardPaper = measured.paper;
      if (!boardPaper) {
        try {
          var bg = getComputedStyle(svg).backgroundColor;
          if (colourLightness(bg) !== null) boardPaper = bg;
        } catch (e) {}
      }
      try { fitBoardToPane(svg); } catch (e) {}
    }
  }
`;
