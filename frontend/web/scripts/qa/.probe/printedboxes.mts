// Where each saved course picture's printed labels were found (free): found/total and an overlay to check.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { CosmosClient } from "@azure/cosmos";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { printedLabelBoxes } = await import("../../../lib/canvas/labelLeaders");
const out = `${os.homedir()}/aria-qa-images/printed-labels`; mkdirSync(out, { recursive: true });
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const beats = (await db.container("progressive-lecture-beats").items.query("SELECT TOP 500 c.sessionId, c.sequence, c.beat FROM c ORDER BY c._ts DESC").fetchAll()).resources as any[];
let pics = 0, total = 0, found = 0; const seen = new Set<string>();
for (const b of beats) {
  const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  const pic = spec?.stage?.kind === "illustration" ? spec.stage : spec?.stage?.picture;
  if (!pic?.coursePicture || !pic.src || seen.has(pic.src)) continue; seen.add(pic.src);
  const res = await fetch(`http://localhost:3000${pic.src}`).catch(() => null); if (!res?.ok) continue;
  const image = Buffer.from(await res.arrayBuffer()); pics++;
  const labels: string[] = pic.labelsInPicture ?? pic.parts.map((p: any) => p.name);
  const boxes = await printedLabelBoxes(image, labels);
  total += labels.length; found += boxes.size;
  const img = await loadImage(image); const c = createCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  g.lineWidth = 4; g.strokeStyle = "#16a34a"; g.fillStyle = "#e11d48"; g.font = "bold 20px sans-serif";
  for (const [label, bx] of boxes) { g.strokeRect(bx.x * img.width - 4, bx.y * img.height - 4, bx.w * img.width + 8, bx.h * img.height + 8); g.fillText(label, bx.x * img.width, bx.y * img.height - 10); }
  writeFileSync(`${out}/${b.sessionId.slice(0, 8)}-b${b.sequence + 1}.jpg`, await c.encode("jpeg", 70));
  console.log(`${b.sessionId.slice(0, 8)} b${b.sequence + 1}: ${boxes.size}/${labels.length} found${labels.length > boxes.size ? ` — not found: ${labels.filter((l) => !boxes.has(l)).join(" | ")}` : ""}`);
}
console.log(`\n${pics} pictures: ${found}/${total} printed labels found exactly`);
process.exit(0);
