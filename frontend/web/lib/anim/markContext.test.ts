import test from "node:test";
import assert from "node:assert/strict";
import { composeIllustratedBoard, pointOnBoard, zoomView } from "./illustratedLayout";
import { picturePartsInMark } from "../board/markContext";

const ID = "0123456789abcdef0123456789abcdef";
const parts = [{ name: "grana", x: 0.35, y: 0.5 }, { name: "stroma", x: 0.75, y: 0.62 }, { name: "outer membrane", x: 0.5, y: 0.08 }];
const code = composeIllustratedBoard({
  title: "Chloroplast", sentences: ["a.", "b."], parts, notes: [{ text: "site of photosynthesis", sentence: 0 }], labels: [], paper: "#fffaec", illustrationId: ID,
  memory: { v: 1, id: ID, subject: "chloroplast", paper: "#fffaec", conceptId: "c", title: "Chloroplast", parts, notes: [], labels: [], focus: null },
});

const circleAround = (bx: number, by: number, r = 40) =>
  Array.from({ length: 24 }, (_, i) => ({ x: (bx + r * Math.cos((i / 24) * Math.PI * 2)) / 1000, y: (by + r * Math.sin((i / 24) * Math.PI * 2)) / 560 }));

test("a circle round a part of a picture names that part", () => {
  const g = pointOnBoard(parts[0], zoomView(null));
  assert.deepEqual(picturePartsInMark(code, circleAround(g.px, g.py)), ["grana"]);
});

test("a mark just beside a part names the nearest part; far from every part, nothing", () => {
  const s = pointOnBoard(parts[1], zoomView(null));
  assert.deepEqual(picturePartsInMark(code, circleAround(s.px + 45, s.py, 12)), ["stroma"]);
  assert.deepEqual(picturePartsInMark(code, circleAround(100, 500, 10)), []);
  assert.deepEqual(picturePartsInMark("export default function Animation() {}", circleAround(500, 300)), [], "not a picture board");
});
