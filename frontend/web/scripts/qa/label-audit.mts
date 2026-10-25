// LABEL AUDIT (free): every saved course picture — where the pointer goes for each labelled part (the
// stored point, red) against where the picture's own label line ends (green), and an overlay to look at.
//   node --import tsx scripts/qa/label-audit.mts [--out dir] [--limit n] [--session id]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { CosmosClient } from "@azure/cosmos";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { leaderPoints } = await import("../../lib/canvas/labelLeaders");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const out = arg("--out") ?? `${os.homedir()}/aria-qa-images/label-audit`;
mkdirSync(out, { recursive: true });
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const only = arg("--session");
const beats = (await db.container("progressive-lecture-beats").items.query(only
  ? { query: "SELECT c.sessionId, c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: only }] }
  : `SELECT TOP ${Number(arg("--limit") ?? 1500)} c.sessionId, c.sequence, c.beat, c._ts FROM c ORDER BY c._ts DESC`).fetchAll()).resources as any[];
const seen = new Set<string>();
const rows: string[] = [];
let boards = 0, parts = 0, traced = 0, far = 0;
for (const b of beats) {
  const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  const pic = spec?.stage?.kind === "illustration" ? spec.stage : spec?.stage?.picture;
  if (!spec?.subject || !pic?.coursePicture || !pic.src || seen.has(`${b.sessionId}:${b.sequence}`)) continue;
  seen.add(`${b.sessionId}:${b.sequence}`);
  const res = await fetch(`http://localhost:3000${pic.src}`).catch(() => null);
  if (!res?.ok) { console.log(`${b.sessionId.slice(0, 8)} b${b.sequence + 1}: picture not served`); continue; }
  const image = Buffer.from(await res.arrayBuffer());
  boards++;
  const ends = await leaderPoints(image, pic.parts.map((p: any) => p.name));
  const img = await loadImage(image);
  const W = img.width, H = img.height;
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  g.font = "bold 22px sans-serif";
  const line: string[] = [];
  for (const p of pic.parts) {
    parts++;
    const sx = p.x * W, sy = p.y * H;
    const e = ends.get(p.name);
    g.strokeStyle = "#e11d48"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(sx - 12, sy - 12); g.lineTo(sx + 12, sy + 12); g.moveTo(sx + 12, sy - 12); g.lineTo(sx - 12, sy + 12); g.stroke();
    g.fillStyle = "#e11d48"; g.fillText(p.name, sx + 14, sy - 10);
    if (e) {
      traced++;
      const d = Math.hypot(e.x - sx, e.y - sy);
      if (d > 60) far++;
      g.strokeStyle = "#16a34a"; g.lineWidth = 3;
      g.strokeRect(e.box.x - 3, e.box.y - 3, e.box.w + 6, e.box.h + 6);
      g.beginPath(); e.path.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke();
      g.beginPath(); g.arc(e.x, e.y, 13, 0, Math.PI * 2); g.stroke();
      line.push(`${p.name}: ${Math.round(d)}px`);
    } else line.push(`${p.name}: no leader`);
  }
  const name = `${b.sessionId.slice(0, 8)}-b${b.sequence + 1}`;
  writeFileSync(`${out}/${name}.jpg`, await c.encode("jpeg", 70));
  rows.push(`${name} "${spec.heading}": ${line.join(" | ")}`);
  console.log(rows.at(-1));
}
console.log(`\n${boards} pictures, ${parts} labelled parts: ${traced} label lines followed, ${far} pointers more than 60 px from where their label points`);
process.exit(0);
