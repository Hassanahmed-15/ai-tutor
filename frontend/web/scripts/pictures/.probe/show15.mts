// Boards 1–5 of the stopped run: each refined picture beside the candidates its run downloaded, the most
// similar candidate marked as the likely pick (the run was stopped before it recorded its picks).
import { readdirSync, statSync, writeFileSync } from "node:fs";
import sharp from "sharp";
const DIR = "/Users/hassanahmed/aria-qa-images/2026-10-24-google-lab";
const titles = ["Artery Structure", "Vein Structure Overview", "Capillary Structure and Function", "Components of Blood", "Structure of the Mammalian Heart"];
const vec = async (f: string) => {
  const px = await sharp(f).flatten({ background: "#fff" }).grayscale().resize(32, 32, { fit: "contain", background: "#fff" }).raw().toBuffer();
  const m = px.reduce((a, b) => a + b, 0) / px.length;
  return Array.from(px, (v) => v - m);
};
const corr = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0) / Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0) || 1);
const since = statSync(`${DIR}/img/1-refined.png`).mtimeMs + 60_000;
let html = `<!doctype html><meta charset="utf-8"><title>Boards 1–5</title><style>body{font:15px system-ui;margin:0;padding:20px;background:#f4f5f7;color:#16181b}@media (prefers-color-scheme:dark){body{background:#111316;color:#e8eaed}}section{margin:0 0 28px}h2{margin:0 0 8px}.row{display:grid;grid-template-columns:1.3fr 1.3fr;gap:12px}.row img{width:100%;max-height:460px;object-fit:contain;background:#fff;border-radius:8px}.c{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.c img{height:90px;background:#fff;border-radius:4px}.c .pick{outline:3px solid #2f9e44}small{opacity:.7}</style><h1>Boards 1–5 — Google original vs gpt-image-1-mini refine</h1>`;
for (const [i, title] of titles.entries()) {
  const n = i + 1;
  const refined = `${DIR}/img/${n}-refined.png`;
  const cands = readdirSync(`${DIR}/img`).filter((f) => f.startsWith(`${n}L-c`) || f.startsWith(`${n}U-c`)).filter((f) => n === 1 || statSync(`${DIR}/img/${f}`).mtimeMs > since);
  const rv = await vec(refined);
  const scored = await Promise.all(cands.map(async (f) => ({ f, s: corr(rv, await vec(`${DIR}/img/${f}`)) })));
  scored.sort((a, b) => b.s - a.s);
  const pick = n === 1 ? "1L-c0.png" : scored[0]?.f;
  html += `<section><h2>${n}. ${title}</h2><div class="row"><figure><img src="img/${pick}"><figcaption>Google original ${n === 1 ? "(the checker's pick)" : "(most similar to the refine — likely the pick)"}</figcaption></figure><figure><img src="img/${n}-refined.png"><figcaption>Refined by gpt-image-1-mini</figcaption></figure></div><div class="c">${scored.map(({ f }) => `<img class="${f === pick ? "pick" : ""}" src="img/${f}">`).join("")}</div><small>All candidates this run downloaded for the board.</small></section>`;
}
writeFileSync(`${DIR}/boards-1-5.html`, html);
console.log(`${DIR}/boards-1-5.html`);
