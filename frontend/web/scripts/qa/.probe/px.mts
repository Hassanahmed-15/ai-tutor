import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const [file, x0, y0, x1, y1] = process.argv.slice(2);
const img = await loadImage(readFileSync(file)); const c = createCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
const d = g.getImageData(0, 0, img.width, img.height).data;
for (let t = 0; t <= 1; t += 0.05) {
  const x = Math.round(+x0 + (+x1 - +x0) * t), y = Math.round(+y0 + (+y1 - +y0) * t);
  let best = 999, bx = 0;
  for (let k = -6; k <= 6; k++) { const o = (y * img.width + x + k) * 4; const l = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]; if (l < best) { best = l; bx = k; } }
  const o = (y * img.width + x + bx) * 4;
  console.log(`(${x + bx},${y}) lum ${Math.round(best)} rgb ${d[o]},${d[o + 1]},${d[o + 2]}`);
}
