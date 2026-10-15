// Debug one library asset: its art with every anchor drawn (green = traced along a leader, amber = guessed).
//   npx tsx scripts/figures/overlay-library.mts <id> <out.png>
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
const LIB = path.resolve(import.meta.dirname, "../../data/figures/library");
const [id, out] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(path.join(LIB, "index.json"), "utf8")).find((x: { id: string }) => x.id === id);
let svg = fs.readFileSync(path.join(LIB, `${id}.svg`), "utf8");
const vb = /viewBox="([^"]+)"/.exec(svg)![1].split(" ").map(Number);
const r = Math.max(a.w, a.h) / 150;
const marks = a.parts.map((p: { anchor: { x: number; y: number }; confidence: string; name: string }) => `<circle cx="${vb[0] + p.anchor.x}" cy="${vb[1] + p.anchor.y}" r="${r}" fill="${p.confidence === "high" ? "#16a34a" : "#f59e0b"}" stroke="#fff"/><text x="${vb[0] + p.anchor.x + r * 1.5}" y="${vb[1] + p.anchor.y + r}" font-size="${r * 2.6}" font-family="Arial" font-weight="bold" fill="#000" stroke="#fff" stroke-width="${r * 0.5}" paint-order="stroke">${p.name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("");
svg = svg.replace(/<\/svg>\s*$/, `${marks}</svg>`);
const fonts = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"].filter((f) => fs.existsSync(f));
fs.writeFileSync(out, new Resvg(svg, { fitTo: { mode: "width", value: 1400 }, background: "white", font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: "Arial" } }).render().asPng());
