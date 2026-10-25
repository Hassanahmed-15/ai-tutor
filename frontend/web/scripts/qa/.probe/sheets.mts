// Contact sheets of the label-audit overlays, 2×2 at half size, named for the boards on them (free).
import { readdirSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const [dir, out] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith(".jpg") && !f.startsWith("sheet")).sort();
for (let i = 0; i < files.length; i += 4) {
  const c = createCanvas(1536, 1060);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 1536, 1060);
  g.font = "bold 18px sans-serif";
  for (let k = 0; k < 4 && i + k < files.length; k++) {
    const img = await loadImage(`${dir}/${files[i + k]}`);
    const x = (k % 2) * 768, y = Math.floor(k / 2) * 530;
    g.drawImage(img, x, y + 18, 768, 512);
    g.fillStyle = "#000"; g.fillText(files[i + k], x + 6, y + 15);
    g.strokeStyle = "#999"; g.strokeRect(x, y + 18, 768, 512);
  }
  writeFileSync(`${out}/sheet-${String(i / 4 + 1).padStart(2, "0")}.jpg`, await c.encode("jpeg", 80));
}
console.log(Math.ceil(files.length / 4), "sheets");
