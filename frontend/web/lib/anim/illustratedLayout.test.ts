/**
 * Picture boards: the writing that is right by construction (notes in reading order, at most three
 * callouts on the picture that never collide, every one on its own sentence, a zoom that never shows
 * a blank edge), the lecture's picture memory, and the board that must survive the same checks as a
 * generated one — a saved lecture is re-sanitised on load, and a failing board would lose its code.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { boardPictureMemoryOf, composeIllustratedBoard, illustrationBox, illustrationIdOf, placeCallouts, placeNotes, pointOnBoard, sentenceForPart, zoomView } from "./illustratedLayout";
import { chooseFocus, picturesFromBoardCodes } from "../lecturePictures";
import { getReactAnimationCodeDiagnostics, sanitizeReactAnimationOp } from "../drawSanitize";
import { isMotionBoard, motionBoardSentenceCount } from "./sandboxMotion";

const HEART = [
  "Blood returns from the body into the right atrium.",
  "It drops into the right ventricle.",
  "The right ventricle pumps it to the lungs.",
  "Oxygenated blood returns to the left atrium.",
  "It fills the left ventricle.",
  "The left ventricle pumps it out through the aorta to the whole body.",
];
// Where gpt-5.6-terra located them on a generated heart (fractions of the picture).
const HEART_PARTS = [
  { name: "right atrium", x: 0.39, y: 0.49 },
  { name: "right ventricle", x: 0.45, y: 0.69 },
  { name: "left atrium", x: 0.6, y: 0.42 },
  { name: "left ventricle", x: 0.58, y: 0.67 },
  { name: "aorta", x: 0.5, y: 0.23 },
];

test("a part's label appears on the sentence that names it — the whole name, not one shared word", () => {
  assert.equal(sentenceForPart("left atrium", HEART, undefined, 0), 3, "not sentence 0, which only says 'right atrium'");
  assert.equal(sentenceForPart("right atrium", HEART, undefined, 0), 0);
  assert.equal(sentenceForPart("aorta", HEART, undefined, 0), 5);
  const chloroplast = ["A chloroplast is wrapped in a smooth outer membrane.", "Just inside it lies a second, inner membrane.", "The fluid is the stroma."];
  assert.equal(sentenceForPart("inner membrane", chloroplast, undefined, 0), 1, "not the sentence with the OUTER membrane");
  // A part the narration never names keeps the planner's sentence, clamped to the script.
  assert.equal(sentenceForPart("septum", HEART, 9, 0), 5);
});

const HEART_NOTES = [
  { text: "Two pumps side by side", sentence: 0 },
  { text: "Right side → lungs", sentence: 2 },
  { text: "Left side → whole body", sentence: 5 },
];
const ID = "0123456789abcdef0123456789abcdef";
const heartBoard = (extra: Partial<Parameters<typeof composeIllustratedBoard>[0]> = {}) =>
  composeIllustratedBoard({ title: "Blood Flow Through the Heart", sentences: HEART, parts: HEART_PARTS, notes: HEART_NOTES, labels: [], paper: "#fffaec", illustrationId: ID, ...extra });

type R = { x: number; y: number; w: number; h: number };
const clear = (a: R, b: R) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

test("notes are written in reading order, one line each, beside the picture and never on it", () => {
  const notes = placeNotes([{ text: "Light → chemical energy.", sentence: 3 }, { text: "Happens in the chloroplast", sentence: 1 }, { text: "Oxygen is released" }], ["a", "b", "c", "d", "e"]);
  assert.deepEqual(notes.map((n) => n.sentence), [3, 3, 3], "no note appears before the one above it");
  assert.equal(notes[0].text, "Light → chemical energy", "no full stop");
  const box = illustrationBox();
  for (const n of notes) assert.ok(56 + 24 + n.text.length * 0.5 * n.size <= box.x, `"${n.text}" ends before the picture`);
  for (let i = 1; i < notes.length; i++) assert.ok(notes[i].y - notes[i - 1].y >= 60);
});

test("callouts sit on the picture or the paper round it, clear of each other, every dot and the notes", () => {
  const labels = HEART_PARTS.slice(0, 3).map((p, i) => ({ name: p.name, sentence: i, ...pointOnBoard(p, zoomView(null)) }));
  const placed = placeCallouts(labels);
  assert.equal(placed.length, 3, "three labels, three clean spots");
  for (const c of placed) {
    assert.ok(c.rect.x >= 372 && c.rect.y >= 96 && c.rect.x + c.rect.w <= 1000 && c.rect.y + c.rect.h <= 560, `${c.name} is right of the notes and below the title`);
    for (const other of placed) if (other !== c) assert.ok(clear(c.rect, other.rect), `${c.name} clear of ${other.name}`);
    for (const l of labels) if (l.name !== c.name) assert.ok(clear(c.rect, { x: l.px - 10, y: l.py - 10, w: 20, h: 20 }), `${c.name} does not cover ${l.name}'s dot`);
  }
});

test("callouts go on bare paper, not over the drawing, when the picture's ink is known", async () => {
  const { inkUnder, INK_COLS, INK_ROWS } = await import("./illustratedLayout");
  // Ink everywhere in the picture except its top quarter.
  const ink = Array.from({ length: INK_ROWS }, (_, r) => (r < INK_ROWS / 4 ? "0" : "9").repeat(INK_COLS)).join("");
  const view = zoomView(null);
  const part = { name: "left ventricle", sentence: 0, ...pointOnBoard({ x: 0.5, y: 0.6 }, view) };
  const [c] = placeCallouts([part], (rect) => inkUnder(ink, view, rect));
  assert.ok(c, "placed");
  assert.ok(inkUnder(ink, view, c.rect) < 0.1, `on paper (ink ${inkUnder(ink, view, c.rect).toFixed(2)})`);
});

test("a board labels only what it is asked to — none by default — and writes its notes", () => {
  const plain = heartBoard();
  for (const part of HEART_PARTS) assert.doesNotMatch(plain, new RegExp(`>${part.name}</text>`), `no label for ${part.name}`);
  for (const note of HEART_NOTES) assert.match(plain, new RegExp(`>${note.text}</text>`));
  // No pulsing orange ring on the picture (removed 2026-09-29 as clutter).
  assert.doesNotMatch(plain, /stroke="#f59e0b"/);
  const labelled = heartBoard({ labels: ["left atrium", "aorta", "right atrium", "left ventricle"] });
  assert.equal((labelled.match(/textAnchor="middle">/g) ?? []).length, 3, "never more than three labels");
});

test("a zoom keeps the picture covering its frame, and moves the focus toward the middle", () => {
  const box = illustrationBox();
  const view = zoomView({ x: 0.95, y: 0.05 });
  assert.ok(view.scale > 1);
  // Corners of the zoomed picture stay outside the frame: no blank edge.
  const tl = pointOnBoard({ x: 0, y: 0 }, view);
  const br = pointOnBoard({ x: 1, y: 1 }, view);
  assert.ok(tl.px <= box.x + 1e-6 && tl.py <= box.y + 1e-6 && br.px >= box.x + box.w - 1e-6 && br.py >= box.y + box.h - 1e-6);
  const focus = pointOnBoard({ x: 0.58, y: 0.67 }, zoomView({ x: 0.58, y: 0.67 }));
  assert.ok(Math.abs(focus.px - (box.x + box.w / 2)) < 2 && Math.abs(focus.py - (box.y + box.h / 2)) < 2, "the focus lands in the middle");
});

test("the picture board is a Motion board that passes the code checker, and carries its picture and memory", () => {
  const memory = { v: 1, id: ID, subject: "a heart cutaway", paper: "#fffaec", conceptId: "heart", title: "Heart", parts: HEART_PARTS, notes: HEART_NOTES.map((n) => n.text), labels: [], focus: null };
  for (const code of [heartBoard({ memory }), heartBoard({ labels: ["aorta"] }), heartBoard({ focus: "left ventricle", labels: ["left ventricle"] })]) {
    assert.ok(isMotionBoard(code));
    assert.equal(illustrationIdOf(code), ID);
    const diagnostics = getReactAnimationCodeDiagnostics(code);
    assert.equal(diagnostics.issue, null, `must pass the code checker: ${diagnostics.issue}`);
    const reloaded = sanitizeReactAnimationOp({ kind: "reactAnimation", teachingPoint: "heart", code, at: 0, endAt: 1 } as never);
    assert.ok(reloaded.code, "a saved lecture keeps the board when it is re-sanitised on load");
    assert.doesNotMatch(code, /data:image/, "the picture is fetched by id, never inlined into the code");
  }
  assert.deepEqual(boardPictureMemoryOf(heartBoard({ memory })), memory, "the memory reads back from the code");
  assert.equal(motionBoardSentenceCount(heartBoard()), 6, "reveals reach the last note's sentence");
});

test("the picture board renders on the server with no picture available — notes, labels and zoom", async () => {
  const { renderStaticFrame } = await import("../reactAnimationVisionCritic");
  const frame = await renderStaticFrame(heartBoard({ labels: ["aorta"], focus: "aorta" }));
  assert.equal(frame.failure, undefined, frame.failure?.message);
  for (const note of HEART_NOTES) assert.match(frame.svg ?? "", new RegExp(`>${note.text}</text>`));
  assert.match(frame.svg ?? "", />aorta<\/text>/);
  assert.match(frame.svg ?? "", /scale\(1\.6 1\.6\)/, "the zoom is a transform the rasteriser honours");
});

test("a lecture remembers its pictures from its saved boards, and a later pass zooms somewhere new", () => {
  const first = { v: 1, id: ID, subject: "a heart cutaway", paper: "#fffaec", conceptId: "heart", title: "Heart", parts: HEART_PARTS, notes: ["Two pumps side by side"], labels: ["aorta"], focus: null };
  const second = { ...first, notes: ["Valves stop backflow"], labels: [], focus: "left ventricle" };
  const pictures = picturesFromBoardCodes([heartBoard({ memory: first }), heartBoard({ memory: second }), "export default function Animation() {}", null]);
  assert.equal(pictures.length, 1, "two boards on one picture are one picture");
  assert.deepEqual(pictures[0].written.sort(), ["Two pumps side by side", "Valves stop backflow", "aorta"].sort());
  assert.deepEqual(pictures[0].focused, ["left ventricle"]);
  // The planner asks for a part already zoomed onto: the narration's next unzoomed part is used.
  assert.equal(chooseFocus(pictures[0], "left ventricle", ["The right atrium fills first."]), "right atrium");
  assert.equal(chooseFocus(pictures[0], "aorta", ["x"]), "aorta");
});

test("a generated PNG's C2PA metadata is dropped so the picture can be decoded, its pixels kept", async () => {
  const { pngPixelsOnly } = await import("../illustratedBoard");
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const png = Buffer.concat([signature, chunk("IHDR", Buffer.alloc(13)), chunk("caBX", Buffer.alloc(4000, 7)), chunk("IDAT", Buffer.alloc(20, 1)), chunk("IEND", Buffer.alloc(0))]);
  const clean = pngPixelsOnly(png);
  assert.ok(!clean.includes(Buffer.from("caBX")), "the content-credentials chunk is gone");
  for (const type of ["IHDR", "IDAT", "IEND"]) assert.ok(clean.includes(Buffer.from(type)), `${type} is kept`);
  assert.equal(clean.length, png.length - (12 + 4000));
  assert.equal(pngPixelsOnly(Buffer.from("not a png")).toString(), "not a png", "anything else passes through");
});

test("a picture description never asks for labels — they would be drawn into the picture as text", async () => {
  const { pictureSubject } = await import("../illustratedBoard");
  // The planner's own words for the photosynthesis beats that lost their pictures (2026-09-29).
  assert.equal(pictureSubject("A labelled cutaway of a chloroplast showing stacked thylakoid membranes"), "A cutaway of a chloroplast showing stacked thylakoid membranes");
  assert.equal(pictureSubject("A labeled cutaway of a plant cell with labels for each organelle, green chloroplasts"), "A cutaway of a plant cell, green chloroplasts");
  assert.doesNotMatch(pictureSubject("a fully labelled diagram of the heart"), /label/i);
});

test("a long label shrinks to fit its column on one line instead of wrapping into the next row", async () => {
  const { labelFontSize } = await import("./illustratedLayout");
  assert.equal(labelFontSize("oxygen", 180), 21, "a short label keeps the full size");
  const size = labelFontSize("thylakoid membranes", 168);
  assert.ok(size < 21 && size >= 15, `shrinks, not below 15 (got ${size})`);
  assert.ok("thylakoid membranes".length * 0.5 * size <= 168, "and then fits its room");
});

test("a located point on bare paper moves onto the nearest ink; a point on ink stays", async () => {
  const { snapToInk } = await import("../illustratedBoard");
  const w = 200, h = 100;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 250; px[i + 1] = 248; px[i + 2] = 240; px[i + 3] = 255; }
  // A dark disc of radius 20 at (120, 50).
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - 120) ** 2 + (y - 50) ** 2 <= 400) { const i = (y * w + x) * 4; px[i] = 30; px[i + 1] = 90; px[i + 2] = 40; }
  assert.deepEqual(snapToInk(px, w, h, 125, 52), { x: 125, y: 52 }, "on ink: unchanged");
  const moved = snapToInk(px, w, h, 90, 50);
  assert.ok((moved.x - 120) ** 2 + (moved.y - 50) ** 2 <= 400, `lands inside the disc (got ${moved.x.toFixed(0)},${moved.y.toFixed(0)})`);
  assert.deepEqual(snapToInk(px, w, h, 10, 10), { x: 10, y: 10 }, "no ink near: unchanged");
});
