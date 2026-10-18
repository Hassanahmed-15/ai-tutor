/**
 * Renders the diagram lab's boards with the real board component (KaTeX styles, pictures served by
 * the local dev server on :3000) and writes a gallery: <dir>/index.html and one PNG per board.
 *
 *   NODE_OPTIONS="--require <stub that ignores .css>" npx tsx --tsconfig tsconfig.json scripts/bench/diagram-lab-render.mts <dir>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const dir = process.argv[2];
const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const req = createRequire(`${WEB}/package.json`);
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
const { chromium } = req("playwright");
const { CanvasPanel } = await import("../../components/canvas/CanvasPanel.tsx");
const { layoutPanel } = await import("../../lib/canvas/layout.ts");
const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
const cards: string[] = [];
for (const f of fs.readdirSync(dir).filter((x) => /-snapshot\.json$/.test(x)).sort()) {
  const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const id = f.replace("-snapshot.json", "");
  cards.push(`<h2>${id}: ${snap.topic} <small>($${Number(snap.usd ?? 0).toFixed(3)})</small></h2><div class=g>`);
  for (const [i, b] of (snap.beats ?? []).entries()) {
    const spec = b.draw.ops[0].spec;
    const layout = layoutPanel(spec);
    const svg = renderToStaticMarkup(React.createElement(CanvasPanel, { layout, spec, shownThrough: Infinity, sentenceProgress: 1, live: false, vars: Object.fromEntries(((spec as { interaction?: { controls?: Array<{ var: string; value: number }> } }).interaction?.controls ?? []).map((c) => [c.var, c.value])), carryFrom: {}, reducedMotion: true, theme: "paper" }));
    await page.setContent(`<html><head><base href="http://localhost:3000/"><link rel=stylesheet href="${KATEX}"><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Outfit:wght@600;700;800&display=swap" rel=stylesheet></head><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" width="1000" height="560" font-family="Nunito, Outfit, sans-serif"><rect width="1000" height="560" fill="#fbfaf6"/>${svg}</svg></body></html>`);
    await page.waitForLoadState("networkidle").catch(() => {});
    // The maths font must be loaded before the shot: a shot taken earlier showed terms overprinted.
    await page.evaluate(async () => { await (document as Document & { fonts: FontFaceSet }).fonts.ready; });
    await page.waitForTimeout(1500);
    // Static markup skips the board's layout effects: the maths fit-to-slot (CanvasPanel TexTerm) is
    // applied here the same way, so the shot shows what the player shows.
    await page.evaluate(() => {
      for (const fo of Array.from(document.querySelectorAll("foreignObject"))) {
        const inner = fo.querySelector("div > span") as HTMLElement | null;
        if (!inner || !inner.querySelector(".katex")) continue;
        const w = Number(fo.getAttribute("width")) || 0;
        inner.style.display = "inline-block";
        const actual = inner.offsetWidth;
        if (!actual || !w) continue;
        const scale = actual > w ? Math.max(0.45, w / actual) : 1;
        const shown = actual * scale;
        const left = Math.min(0, (w - shown) / 2 - 4);
        fo.setAttribute("x", String(left));
        fo.setAttribute("width", String(Math.max(4, w, shown + 8)));
        inner.style.transformOrigin = "0 50%";
        inner.style.transform = `translateX(${(w - shown) / 2 - left}px) scale(${scale})`;
      }
    });
    await page.waitForTimeout(200);
    const png = `${id}-b${i + 1}.png`;
    await page.screenshot({ path: path.join(dir, png) });
    const kind = spec.stage.kind + (spec.stage.component ? ` · ${spec.stage.component}` : "");
    cards.push(`<figure><a href="${png}" target=_blank><img src="${png}"></a><figcaption><b>${b.title}</b> — ${kind}${spec.visualFallback ? " · <i>fell back</i>" : ""}</figcaption></figure>`);
  }
  cards.push("</div>");
}
await browser.close();
fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><meta charset=utf-8><title>Diagram lab</title><style>body{font:15px system-ui;margin:20px;background:#f4f4f2}h2{margin-top:30px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:14px}figure{margin:0;background:#fff;padding:6px;border-radius:8px;box-shadow:0 1px 3px #0002}img{width:100%}figcaption{font-size:13px;padding-top:4px}</style><h1>Diagram lab — diagrams and labels only</h1>${cards.join("\n")}`);
console.log("gallery:", path.join(dir, "index.html"));
