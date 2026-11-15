// The page inside the Aria desktop app's screen overlay (desktop-app/main.js; first built in screen-lab).
// It covers the whole screen and is see-through; clicks fall through to the apps underneath except
// while marking or over the board. On Ctrl+Alt+A the desktop app sends a picture of the screen; the
// student's drag on top of it is the mark, cut from that picture (mark.js) and explained on the tiny
// blackboard (board.js). It is served by the Aria website, so it uses the app's own Aria sign-in.
import { Board } from "./board.js";
import { MIN_MARK_PX, bounds, drawStroke, pathLength, shotFrom, showVideo } from "./mark.js";

const params = new URLSearchParams(location.search);
const MOCK = params.has("mock");
document.body.classList.toggle("debug", params.has("debug") || MOCK);
const aria = window.aria ?? { on() {}, prepared() {}, setInteractive() {}, markEnded() {} };
const $ = (sel) => document.querySelector(sel);

const HINT = "Circle or underline anything · Esc to cancel";
const inkCanvas = $("#ink");
const ink = inkCanvas.getContext("2d");
let frame = null; // the screen as it was when the hotkey was pressed
let scale = 1; // screen pixels per page pixel
let marking = false;
let drawing = false;
let mark = null;
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
  },
  onBigger: openBig,
});

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
  if (!mark) return;
  ink.save();
  ink.globalAlpha = markAlpha;
  drawStroke(ink, mark.points, 5);
  ink.restore();
}

function clearMark() {
  clearTimeout(fadeTimer);
  mark = null;
  markAlpha = 1;
  drawMark();
}

function fadeMarkSoon() {
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    const start = performance.now();
    const step = (now) => {
      if (!mark || drawing) return;
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
  document.body.classList.toggle("marking", on);
  $("#hint").textContent = HINT;
  $("#hint").hidden = !on;
}

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
  clearMark();
  setMarking(false);
  // Two frames, so the cleared screen has really been drawn before the picture is taken.
  requestAnimationFrame(() => requestAnimationFrame(() => aria.prepared()));
});

aria.on("mark:start", async ({ image, scale: s }) => {
  frame = await loadImage(image);
  scale = s;
  interactive = true;
  setMarking(true);
});

aria.on("mark:cancel", cancel);

// A message from the Mac side (e.g. a missing permission), shown in the hint pill for a few seconds.
aria.on("notice", (text) => {
  const hint = $("#hint");
  hint.textContent = text;
  hint.hidden = false;
  clearTimeout(hint.timer);
  hint.timer = setTimeout(() => {
    hint.hidden = !marking;
    hint.textContent = HINT;
  }, 7000);
});

function cancel() {
  drawing = false;
  setMarking(false);
  clearMark();
  interactive = false;
  aria.markEnded();
}

/** The drag is done: cut the pictures from the frozen screen and open the board beside the mark. */
function finishMark() {
  setMarking(false);
  interactive = false;
  aria.markEnded();
  const box = bounds(mark.points);
  const shot = shotFrom(frame, ([x, y]) => [x * scale, y * scale], box, mark.points);
  if (!shot) return clearMark();
  board.explain(shot, { box, W: innerWidth, H: innerHeight });
  fadeMarkSoon();
  return true;
}

window.addEventListener("pointerdown", (e) => {
  if (!marking || e.button !== 0) return;
  e.preventDefault();
  clearMark();
  drawing = true;
  mark = { points: [[e.clientX, e.clientY]] };
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
  // A click in mark mode means "never mind".
  if (pathLength(mark.points) < MIN_MARK_PX) return cancel();
  finishMark();
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (marking) cancel();
  else if (!big.hidden) closeBig();
  else board.close();
});

window.addEventListener("resize", sizeInk);
sizeInk();

// Hooks for the desktop app's self-test (desktop-app/test/selftest.js), which runs the overlay off screen.
if (params.has("selftest")) {
  window.__testMark = (points) => {
    mark = { points };
    drawMark();
    return Boolean(finishMark());
  };
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
