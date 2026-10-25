// Repoint one printed label to the stored part point and save before/after (free).
import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const { tesseractWords, labelBox, leaderEnd, repointLeader } = await import("../../../lib/canvas/labelLeaders");
const [file, label, fx, fy, out] = process.argv.slice(2);
const image = readFileSync(file);
const img = await loadImage(image); const W = img.width, H = img.height;
const c = createCanvas(W, H); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
const words = (await tesseractWords(image))!;
const box = labelBox(words, label)!;
const end = leaderEnd(g.getImageData(0, 0, W, H).data, W, H, box, words)!;
console.log("old end", Math.round(end.x), Math.round(end.y), "path", end.path.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" "));
repointLeader(g as never, W, H, end, { x: Number(fx) * W, y: Number(fy) * H });
writeFileSync(out, await c.encode("jpeg", 90));
