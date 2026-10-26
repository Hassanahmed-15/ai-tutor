// A maths picture board photographed with a stand-in white-on-black figure (free): how it sits on the board.
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { boardPhoto } = await import("../../../lib/canvas/boardLook");
const W = 1536, H = 1024, c = createCanvas(W, H), g = c.getContext("2d");
g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = 5;
const cx = 768, cy = 512, r = 330;
const pts = Array.from({ length: 6 }, (_, i) => ({ x: cx + r * Math.cos((Math.PI / 3) * i), y: cy + r * Math.sin((Math.PI / 3) * i) }));
g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
g.setLineDash([18, 14]); g.lineWidth = 3;
for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[i + 3].x, pts[i + 3].y); g.stroke(); }
for (let i = 0; i < 3; i++) { const a = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }, b = { x: (pts[i + 3].x + pts[(i + 4) % 6].x) / 2, y: (pts[i + 3].y + pts[(i + 4) % 6].y) / 2 }; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
g.setLineDash([]); g.font = "bold 44px sans-serif";
"ABCDEF".split("").forEach((L, i) => g.fillText(L, cx + (r + 40) * Math.cos((Math.PI / 3) * i) - 14, cy + (r + 40) * Math.sin((Math.PI / 3) * i) + 14));
g.fillText("line of symmetry", 1080, 140);
const src = `data:image/png;base64,${(await c.encode("png")).toString("base64")}`;
const spec = { v: 1, heading: "Lines of symmetry of a regular hexagon", notes: [{ id: "n1", text: "A regular hexagon has 6 lines of symmetry", s: 0 }, { id: "n2", text: "3 join opposite corners", s: 1 }, { id: "n3", text: "3 join midpoints of opposite sides", s: 2 }],
  stage: { kind: "illustration", subject: "regular hexagon with its six lines of symmetry", parts: [], labels: [], src, paper: "#000000", labelsInPicture: ["line of symmetry"], onBoard: true }, cues: [] };
const png = await boardPhoto(spec as never, { userId: "qa", topic: "Symmetry of polygons" });
if (png) writeFileSync(process.argv[2], png);
console.log(png ? "photographed" : "no photo");
process.exit(0);
