import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { plainTex, equationTerms } from "../../../lib/canvas/equationRepair";
// Each job: a title and rows of plain maths, typeset with the board's own term-to-TeX conversion.
const jobs: Array<{ out: string; title: string; rows: string[] }> = JSON.parse(process.argv[2]);
const K = "/Users/hassanahmed/ai-tutor/node_modules/katex/dist";
const COLORS = ["#7dd3fc", "#fca5a5", "#86efac", "#fcd34d", "#c4b5fd", "#f9a8d4"];
const b = await chromium.launch();
for (const job of jobs) {
  const rows = job.rows.map((r) => equationTerms(r).map(plainTex));
  const html = `<!doctype html><html><head><link rel="stylesheet" href="file://${K}/katex.min.css"><script src="file://${K}/katex.min.js"></script>
<style>body{margin:0;background:#0b0d10;font-family:system-ui}#c{width:1100px;padding:40px 60px 56px;box-sizing:border-box;background:#000;border:2px solid #2a2d33;border-radius:28px}
h1{color:#f4f1ea;font:700 40px/1.2 system-ui;margin:0 0 6px}hr{width:340px;margin:0 0 36px;border:0;border-top:3px solid #b45309}
.row{display:flex;justify-content:center;gap:14px;margin:14px 0;font-size:36px}</style></head><body><div id="c"><h1>${job.title}</h1><hr>
${rows.map((terms, r) => `<div class="row">${terms.map((t, i) => `<span data-tex="${encodeURIComponent(t)}" style="color:${/^(=|\\approx|,\\quad)$/.test(t) ? "#94a3b8" : COLORS[(r + i) % COLORS.length]}"></span>`).join("")}</div>`).join("")}
</div><script>document.querySelectorAll('[data-tex]').forEach(e=>katex.render(decodeURIComponent(e.dataset.tex),e,{throwOnError:false}))</script></body></html>`;
  const file = job.out.replace(/\.png$/, ".html");
  writeFileSync(file, html);
  const p = await b.newPage({ viewport: { width: 1100, height: 600 } });
  await p.goto(`file://${file}`);
  await p.waitForTimeout(400);
  await (await p.$("#c"))!.screenshot({ path: job.out });
  await p.close();
  console.log("saved", job.out);
}
await b.close();
