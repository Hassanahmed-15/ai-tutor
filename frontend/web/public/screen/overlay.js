// The page inside the Aria desktop app's screen overlay (desktop-app/main.js; first built in screen-lab).
// It covers the whole screen and is see-through; clicks fall through to the apps underneath except
// while marking or over the board. On Ctrl+Alt+A the desktop app sends a picture of the screen; the
// student's drag on top of it is the mark, cut from that picture (mark.js) and explained on the tiny
// blackboard (board.js). It is served by the Aria website, so it uses the app's own Aria sign-in.
import { Board } from "./board.js";
import { MIN_MARK_PX, boxPoints, dragRect, drawDragBox, drawMarkOn, marksBounds, pathLength, regionAt, shotFrom, showVideo, snipBox } from "./mark.js";
import { createListener } from "./listen.js";

const params = new URLSearchParams(location.search);
const MOCK = params.has("mock");
document.body.classList.toggle("debug", params.has("debug") || MOCK);
const aria = window.aria ?? { on() {}, prepared() {}, setInteractive() {}, markEnded() {} };
const $ = (sel) => document.querySelector(sel);

// THE TOOLS (owner, 2026-11-17): pencil, box or highlighter, picked in the capsule or with 1 2 3,
// remembered. Marks add up until Explain (or Enter); a click with any tool marks the word under it.
const TOOLS = ["pencil", "box", "highlight"];
const TOOL_HINT = {
  pencil: "Circle or underline anything",
  box: "Drag a box round anything",
  highlight: "Drag over the words to highlight",
};
let tool = "pencil";
try {
  const saved = localStorage.getItem("aria-screen-tool");
  if (TOOLS.includes(saved)) tool = saved;
} catch {
  // Private storage: the pencil.
}
const hintText = () =>
  marks.length ? `${marks.length === 1 ? "Add more marks" : `${marks.length} marks · add more`}, or Explain` : `${TOOL_HINT[tool]} · or click a word`;
const inkCanvas = $("#ink");
const ink = inkCanvas.getContext("2d");
let frame = null; // the screen as it was when the hotkey was pressed
let scale = 1; // screen pixels per page pixel
let marking = false;
let drawing = false;
let mark = null; // the mark being drawn: { tool, points }
let marks = []; // the marks made so far, explained together
let interactive = false;

const MARK_FADE_MS = 4000; // the mark fades like Clicky's; the board stays until it is closed
let markAlpha = 1;
let fadeTimer = null;

const board = new Board($("#board"), {
  mock: MOCK,
  // The live pencil board by default; ?draw=manim brings back the one-slide Manim video.
  drawMode: () => (params.get("draw") === "manim" ? "manim" : "pencil"),
  onClose: () => {
    clearMark();
    closeBig();
    setInteractive(false);
    listener.stop();
    spotlight(null);
  },
  // The spotlight follows her: on while she thinks and explains, lifted soon after she is done.
  onState: (state) => {
    clearTimeout(spotTimer);
    if (state === "idle") spotTimer = setTimeout(() => spotlight(null), 2500);
    else if (spotArea) spotlight(spotArea);
  },
  onBigger: openBig,
  onMic: () => {
    // The mic light turns listening off and on; the choice is remembered.
    const on = !listener.on;
    try {
      localStorage.setItem("aria-screen-mic", on ? "on" : "off");
    } catch {
      // Private storage: the choice lasts until the board closes.
    }
    if (on) listener.start();
    else listener.stop();
  },
});

// "Aria, …" while the board is open: asked and drawn again (listen.js). Off in mock tests unless ?listen.
const listener = createListener({
  speaking: () => board.voice.speaking,
  onState: (state) => board.setMic(state),
  onQuestion: (text) => {
    if (!board.ask(text)) return;
    board.p.ask.q.value = "";
  },
  onStop: ({ quiet } = {}) => {
    // "Aria, stop", or just "Aria" (she stops talking and waits for the question).
    board.hush();
    if (quiet) board.setMic("waiting");
  },
});

function micWanted() {
  if (MOCK && !params.has("listen")) return false;
  try {
    return localStorage.getItem("aria-screen-mic") !== "off";
  } catch {
    return true;
  }
}

const big = $("#big");
const bigVideo = $("#big video");

function openBig(url, vtt) {
  if (!url) return;
  showVideo(bigVideo, url, vtt);
  big.hidden = false;
  setInteractive(true);
}

function closeBig() {
  if (big.hidden) return;
  big.hidden = true;
  bigVideo.pause();
  setInteractive(false);
}

big.addEventListener("click", (e) => e.target === big && closeBig());

function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  aria.setInteractive(on);
}

function sizeInk() {
  const dpr = window.devicePixelRatio || 1;
  inkCanvas.width = Math.round(innerWidth * dpr);
  inkCanvas.height = Math.round(innerHeight * dpr);
  ink.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMark();
}

function drawMark() {
  ink.clearRect(0, 0, innerWidth, innerHeight);
  ink.save();
  ink.globalAlpha = markAlpha;
  for (const m of marks) drawMarkOn(ink, m, { penW: 5, fade: markAlpha });
  if (mark?.tool === "box") drawDragBox(ink, dragRect(mark.points));
  else if (mark) drawMarkOn(ink, mark, { penW: 5, fade: markAlpha });
  ink.restore();
}

function clearMark() {
  clearTimeout(fadeTimer);
  mark = null;
  marks = [];
  markAlpha = 1;
  showHint();
  drawMark();
}

function fadeMarkSoon() {
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    const start = performance.now();
    const step = (now) => {
      if (!marks.length || drawing) return;
      markAlpha = Math.max(0, 1 - (now - start) / 700);
      drawMark();
      if (markAlpha > 0) requestAnimationFrame(step);
      else clearMark();
    };
    requestAnimationFrame(step);
  }, MARK_FADE_MS);
}

function setMarking(on) {
  marking = on;
  // The frozen screen shows only while marking (see overlay.css #freeze).
  if (!on) $("#freeze").hidden = true;
  document.body.classList.toggle("marking", on);
  showHint();
  $("#hint").hidden = !on;
}

/** The capsule: the tool lit, what to do, and Undo and Explain once there is a mark. */
function showHint() {
  const hint = $("#hint");
  clearTimeout(hint.timer);
  hint.querySelector(".hint-t").textContent = hintText();
  for (const b of hint.querySelectorAll(".tool")) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  hint.querySelector(".hint-undo").hidden = !marks.length;
  hint.querySelector(".hint-go").hidden = !marks.length;
  document.body.classList.toggle("tool-highlight", tool === "highlight");
}

/** A short message in the capsule, then back to what to do. */
function say(text, ms) {
  const hint = $("#hint");
  hint.querySelector(".hint-t").textContent = text;
  clearTimeout(hint.timer);
  hint.timer = setTimeout(() => {
    hint.hidden = !marking;
    showHint();
  }, ms);
}

function pickTool(next) {
  if (!TOOLS.includes(next)) return;
  tool = next;
  try {
    localStorage.setItem("aria-screen-tool", next);
  } catch {
    // Private storage: the choice lasts until the overlay reloads.
  }
  showHint();
}

function undoMark() {
  marks.pop();
  drawMark();
  showHint();
}

$("#hint").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || !marking) return;
  if (b.dataset.tool) pickTool(b.dataset.tool);
  else if (b.dataset.hint === "undo") undoMark();
  else if (b.dataset.hint === "explain") finishMark();
  else if (b.dataset.hint === "cancel") cancel();
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

aria.on("mark:prepare", () => {
  board.close();
  spotArea = null;
  spotlight(null);
  clearMark();
  setMarking(false);
  // Two frames, so the cleared screen has really been drawn before the picture is taken.
  requestAnimationFrame(() => requestAnimationFrame(() => aria.prepared()));
});

aria.on("mark:start", async ({ image, scale: s }) => {
  frame = await loadImage(image);
  scale = s;
  interactive = true;
  const freeze = $("#freeze");
  freeze.src = image;
  freeze.hidden = false;
  setMarking(true);
});

aria.on("mark:cancel", cancel);

// A message from the Mac side (e.g. a missing permission), shown in the hint pill for a few seconds.
aria.on("notice", (text) => {
  $("#hint").hidden = false;
  say(text, 7000);
});

function cancel() {
  drawing = false;
  setMarking(false);
  clearMark();
  interactive = false;
  aria.markEnded();
}

/** The drag is done: cut the pictures from the frozen screen and open the board beside the mark. */
/**
 * THE SPOTLIGHT: the whole screen dims except a soft ellipse round what was marked (owner's pick,
 * 2026-11-17). `area` in page pixels, or null to lift it.
 */
const spot = $("#spot");
let spotArea = null;
let spotTimer = null;
function spotlight(area) {
  if (!area) {
    spot.classList.remove("on");
    return;
  }
  const cx = (area.left + area.right) / 2;
  const cy = (area.top + area.bottom) / 2;
  const rx = (area.right - area.left) / 2 + 46;
  const ry = (area.bottom - area.top) / 2 + 36;
  spot.style.background = `radial-gradient(ellipse ${Math.round(rx)}px ${Math.round(ry)}px at ${Math.round(cx)}px ${Math.round(cy)}px, rgba(6,5,12,0) 64%, rgba(6,5,12,0.66) 100%)`;
  spot.classList.add("on");
}

/** Explain: every mark made, in one close-up, explained together. */
function finishMark() {
  if (!marking || !marks.length) return false;
  setMarking(false);
  interactive = false;
  aria.markEnded();
  const box = marksBounds(marks);
  const shot = shotFrom(frame, ([x, y]) => [x * scale, y * scale], box, marks);
  if (!shot) return clearMark();
  spotArea = box;
  spotlight(box);
  board.explain(shot, { box, W: innerWidth, H: innerHeight });
  if (micWanted()) listener.start();
  else board.setMic("off");
  fadeMarkSoon();
  return true;
}

window.addEventListener("pointerdown", (e) => {
  if (!marking || e.button !== 0 || e.target.closest?.("#hint")) return;
  e.preventDefault();
  drawing = true;
  mark = { tool, points: [[e.clientX, e.clientY]] };
  drawMark();
});

window.addEventListener("pointermove", (e) => {
  if (drawing) {
    for (const ev of e.getCoalescedEvents?.() ?? [e]) mark.points.push([ev.clientX, ev.clientY]);
    drawMark();
  } else if (!marking) {
    // Clicks fall through everywhere but the board (and the big slide while it is open).
    setInteractive(!big.hidden || (!board.el.hidden && board.el.contains(e.target)));
  }
});

window.addEventListener("pointerup", () => {
  if (!drawing) return;
  drawing = false;
  endMark();
});

/**
 * The pointer went up: a click, a box, a snip or a drawn mark, added to the marks. Returns false when
 * a click found nothing there. Explain (or Enter) sends them.
 */
function endMark() {
  const m = mark;
  mark = null;
  const [x, y] = m.points[0];
  const rect = m.tool === "box" ? dragRect(m.points) : null;
  if (m.tool === "box" ? !rect : pathLength(m.points) < MIN_MARK_PX) {
    // A click marks what is under it: the word, line, formula or picture there, boxed or highlighted.
    const found = regionAt(frame, scale, x, y, innerWidth, innerHeight);
    if (!found) {
      // Empty space: stay in mark mode and say what to do.
      drawMark();
      say("Nothing there: click on a word, formula or picture · Esc to cancel", 2500);
      return false;
    }
    if (m.tool === "highlight") marks.push({ tool: "highlight", rect: { left: found.left - 3, right: found.right + 3, top: found.top - 3, bottom: found.bottom + 3 } });
    else marks.push({ tool: m.tool, points: boxPoints(found) });
  } else if (rect) {
    marks.push({ tool: "box", points: boxPoints(rect, 0, 6) });
  } else if (m.tool === "pencil") {
    // A quick corner-to-corner pencil drag is a snip of that box.
    const snip = snipBox(m.points);
    marks.push({ tool: "pencil", points: snip ? boxPoints(snip, 2) : m.points });
  } else {
    marks.push(m);
  }
  drawMark();
  showHint();
  return true;
}

window.addEventListener("keydown", (e) => {
  if (marking && !drawing && !e.ctrlKey && !e.altKey && !e.metaKey && ["1", "2", "3"].includes(e.key)) return pickTool(TOOLS[Number(e.key) - 1]);
  if (marking && e.key === "Enter") return finishMark();
  if (marking && !drawing && (e.key === "Backspace" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z"))) {
    e.preventDefault();
    return undoMark();
  }
  if (e.key !== "Escape") return;
  if (marking) cancel();
  else if (!big.hidden) closeBig();
  else board.close();
});

window.addEventListener("resize", sizeInk);
sizeInk();

// Hooks for the desktop app's self-test (desktop-app/test/selftest.js), which runs the overlay off screen.
if (params.has("selftest")) {
  // One pencil mark, explained at once (the old one-mark flow); __testMarks: several { tool, points }, then Explain.
  window.__testMark = (points) => {
    marks = [];
    mark = { tool: "pencil", points };
    return Boolean(endMark() && finishMark());
  };
  window.__testMarks = (list) => {
    marks = [];
    for (const m of list) {
      mark = { tool: m.tool, points: m.points };
      if (!endMark()) return false;
    }
    return Boolean(finishMark());
  };
  // A spoken follow-up, as if speech-to-text had just returned this text.
  window.__testHeard = (text) => listener.heard(text);
  // Solves the Try-it challenge the way a student would: slider positions, then let go.
  window.__testSolvePlay = () => {
    const play = board.current?.playView;
    if (!play) return false;
    play.judge(); // a wrong first answer
    const ps = play.params;
    const stops = (q) => Array.from({ length: Math.round((q.max - q.min) / (q.step ?? 1)) + 1 }, (_, i) => q.min + i * (q.step ?? 1));
    for (const a of stops(ps[0])) for (const b of ps[1] ? stops(ps[1]) : [null]) {
      play.set(ps[0].id, a);
      if (ps[1]) play.set(ps[1].id, b);
      if (play.met()) {
        play.judge();
        return play.solved;
      }
    }
    return false;
  };
  window.__testMarkBox = () => marksBounds(marks);
  // Plays a clip through the board's own voice player; how long it took shows whether it really played.
  window.__testVoice = async (url) => {
    const blob = await (await fetch(url)).blob();
    const t = performance.now();
    await board.voice.play(blob);
    return Math.round(performance.now() - t);
  };
  window.__testBig = (url) => {
    openBig(url);
    return !big.hidden;
  };
  // How much of the mark is still on the screen (0 once it has faded).
  window.__testInk = () => {
    const data = ink.getImageData(0, 0, inkCanvas.width, inkCanvas.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
    return lit;
  };
  window.__testState = () => ({
    title: board.p.title.textContent,
    text: board.p.text.textContent,
    meta: board.p.meta.textContent,
    video: board.p.slideVideo.getAttribute("src"),
    // Try it: shown, solved, the task and what she said back.
    play: { shown: !board.p.play.hidden, ready: Boolean(board.current?.play), solved: Boolean(board.current?.playView?.solved), ask: board.p.playAsk.textContent, say: board.p.playSay.textContent },
    // The pencil board: how many of its strokes and words are on the board, and its layout check.
    sketch: board.sketchView
      ? {
          drawn: [...document.querySelectorAll(".sk-text")].filter((e) => e.style.visibility === "visible").length + [...document.querySelectorAll(".sk-svg path")].filter((p) => p.style.strokeDashoffset && parseFloat(p.style.strokeDashoffset) < 1).length,
          report: board.sketchView.report ?? null,
          width: board.el.getBoundingClientRect().width,
        }
      : null,
    boardBox: board.el.hidden ? null : board.el.getBoundingClientRect().toJSON(),
  });
}
