// Can the printed labels of a saved maths lecture's pictures be found? (free, local Tesseract)
//   node --conditions=react-server --import tsx scripts/qa/.probe/mathslabels.mts <session>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { CosmosClient } from "@azure/cosmos";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
process.env.CANVAS_STORE = "blob";
const { loadSharedCanvasImage } = await import("../../../lib/canvas/store");
const { tesseractWords } = await import("../../../lib/canvas/labelLeaders");
const { mathsLabelBoxes } = await import("../../../lib/canvas/mathsLabels");
const id = process.argv[2];
const out = `${os.homedir()}/aria-qa-images/maths-labels`;
mkdirSync(out, { recursive: true });
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const rows = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources as any[];
for (const r of rows.sort((a, b) => a.sequence - b.sequence)) {
  const spec = r.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  const pic = spec && (spec.stage.kind === "illustration" ? spec.stage : spec.stage.picture);
  if (!pic?.onBoard || !pic.src) continue;
  const name = pic.src.split("/").pop();
  const image = (await loadSharedCanvasImage(name)) ?? (await import("node:fs/promises").then((fs) => fs.readFile(`.canvas-cache/shared-images/${name}.jpg`)).catch(() => null));
  if (!image) { console.log(`b${r.sequence + 1}: picture missing`); continue; }
  const img = await loadImage(image);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  for (let i = 0; i < data.data.length; i += 4) for (let c = 0; c < 3; c++) data.data[i + c] = 255 - data.data[i + c];
  const inv = createCanvas(img.width, img.height); inv.getContext("2d").putImageData(data, 0, 0);
  const words = (await tesseractWords(await inv.encode("png"))) ?? [];
  const names = pic.parts.map((p: any) => p.name);
  const t1 = Date.now(); const boxes = await mathsLabelBoxes(image, names); const took = Date.now() - t1;
  console.log(`\nb${r.sequence + 1} ${spec.heading}\n  printed (OCR): ${words.map((w: any) => w.text).join(" ")}\n  labels: ${pic.labelsInPicture?.join(", ")}\n  (${took} ms) found: ${names.map((n: string) => `${n}${boxes.has(n) ? "✓" : "✗"}`).join("  ")}`);
  ctx.strokeStyle = "#ffd400"; ctx.lineWidth = 4;
  for (const [n, b] of boxes) { ctx.strokeRect(b.x * img.width - 4, b.y * img.height - 4, b.w * img.width + 8, b.h * img.height + 8); ctx.fillStyle = "#ffd400"; ctx.font = "22px sans-serif"; ctx.fillText(n, b.x * img.width, b.y * img.height - 8); }
  writeFileSync(`${out}/${id.slice(0, 8)}-b${r.sequence + 1}.png`, await canvas.encode("png"));
}
process.exit(0);
