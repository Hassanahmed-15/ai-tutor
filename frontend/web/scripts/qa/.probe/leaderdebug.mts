// Why a label's leader is not found (free): the OCR words near it, the box, and the best runs.
import { readFileSync } from "node:fs";
const { tesseractWords, labelBox, leaderEnd } = await import("../../../lib/canvas/labelLeaders");
const { createCanvas, loadImage } = await import("@napi-rs/canvas");
const [file, label] = process.argv.slice(2);
const image = readFileSync(file);
const words = (await tesseractWords(image))!;
console.log(words.map((w) => `${w.text}@${w.x},${w.y},${w.w}x${w.h}(${Math.round(w.conf)}) ${w.line}`).join("\n"));
const box = labelBox(words, label);
console.log("box", box);
if (box) {
  const img = await loadImage(image); const c = createCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  console.log("end", leaderEnd(g.getImageData(0, 0, img.width, img.height).data, img.width, img.height, box, words));
}
process.exit(0);
