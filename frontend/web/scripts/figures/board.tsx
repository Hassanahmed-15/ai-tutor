/**
 * Re-renders one board of a saved lecture snapshot (paper and chalk) and screenshots it, for free:
 *   npx tsx --tsconfig tsconfig.json scripts/figures/board.tsx <snapshot.json> <board number> <outDir>
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasPanel } from "@/components/canvas/CanvasPanel";
import { layoutPanel } from "@/lib/canvas/layout";
import { validateCanvasSpec } from "@/lib/canvas/validate";
import { canvasSentences } from "@/lib/canvas/plan";
import { chalkCss } from "@/lib/canvas/theme";

async function main() {
  const [snapPath, n, out] = process.argv.slice(2);
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const beat = snap.beats[Number(n) - 1];
  const spec = validateCanvasSpec(beat.draw.ops[0].spec, canvasSentences(beat.script).length);
  if (!spec) throw new Error("board did not validate");
  const layout = layoutPanel(spec);
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = await import("/Users/hassanahmed/ai-tutor/node_modules/playwright/index.mjs" as string);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  for (const theme of ["paper", "chalk"] as const) {
    const svg = renderToStaticMarkup(React.createElement(CanvasPanel, { layout, spec, shownThrough: Infinity, sentenceProgress: 1, live: false, vars: {}, carryFrom: {}, reducedMotion: true, theme } as never));
    const body = theme === "chalk" ? `<style>${chalkCss()}</style><rect width="1000" height="560" rx="22" fill="#22302a"/><g class="cv-chalk">${svg}</g>` : svg;
    const file = path.join(out, `${path.basename(snapPath, ".json")}-b${n}-${theme}.html`);
    fs.writeFileSync(file, `<html><head><meta charset="utf-8"></head><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" width="1000" height="560" font-family="Nunito, Outfit, sans-serif">${body}</svg></body></html>`);
    await page.goto(`file://${file}`); await page.screenshot({ path: file.replace(/\.html$/, ".png") });
    console.log(file.replace(/\.html$/, ".png"));
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
