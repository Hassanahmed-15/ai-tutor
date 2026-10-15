/**
 * PREVIEW LIBRARY DIAGRAMS ON THE BOARD (free, no model): each asset through the real validate →
 * layout → CanvasPanel path, its parts labelled by the board's label engine, screenshotted.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/figures/preview-library.tsx <outDir> <id> [<id>…] [--all-parts] [--chalk]
 *
 * The asset is an <image>, so the preview points it at the file on disk (file://) rather than the API.
 * Check: every leader ends ON the part its words name.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasPanel } from "@/components/canvas/CanvasPanel";
import { layoutPanel } from "@/lib/canvas/layout";
import { validateCanvasSpec } from "@/lib/canvas/validate";
import { chalkCss } from "@/lib/canvas/theme";
import { setFigureAssetBase } from "@/lib/figures/assetHref";
import { stageAsset, type LibraryAsset } from "@/lib/figures/libraryIndex";

const LIB = path.resolve(process.cwd(), "data/figures/library");

/** Up to n parts spread over the figure (every other one by position, so labels go to both sides). */
function spread<T extends { anchor: { x: number; y: number } }>(parts: T[], n: number): T[] {
  if (parts.length <= n) return parts;
  const sorted = [...parts].sort((a, b) => a.anchor.y - b.anchor.y);
  return Array.from({ length: n }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]);
}

async function main() {
  const args = process.argv.slice(2);
  const out = args[0];
  const ids = args.slice(1).filter((a) => !a.startsWith("--"));
  const allParts = args.includes("--all-parts");
  const themes = args.includes("--chalk") ? (["paper", "chalk"] as const) : (["paper"] as const);
  const index = JSON.parse(fs.readFileSync(path.join(LIB, "index.json"), "utf8")) as LibraryAsset[];
  setFigureAssetBase(`file://${LIB}/`, ".svg");
  fs.mkdirSync(out, { recursive: true });
  const files: string[] = [];
  for (const id of ids) {
    const asset = index.find((a) => a.id === id);
    if (!asset) { console.warn(`no asset ${id}`); continue; }
    const sa = stageAsset({ ...asset, reviewed: allParts || asset.reviewed });
    const parts = allParts ? sa.parts.slice(0, 8) : spread(sa.parts, 6);
    const spec = validateCanvasSpec({ heading: asset.title.slice(0, 50), notes: [], cues: [], stage: { kind: "figure", component: "library", asset: sa, parts: parts.map((p, i) => ({ id: p.id, name: p.name, s: i })) } }, 9);
    if (!spec) { console.warn(`${id}: did not validate`); continue; }
    const layout = layoutPanel(spec);
    for (const theme of themes) {
      const svg = renderToStaticMarkup(React.createElement(CanvasPanel, { layout, spec, shownThrough: Infinity, sentenceProgress: 1, live: false, vars: {}, carryFrom: {}, reducedMotion: true, theme } as never));
      const body = theme === "chalk" ? `<style>${chalkCss()}</style><rect width="1000" height="560" rx="22" fill="#22302a"/><g class="cv-chalk">${svg}</g>` : svg;
      const file = path.join(out, `${id}-${theme}.html`);
      fs.writeFileSync(file, `<html><body style="margin:0;background:#fff"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1000 560" width="1000" height="560" font-family="Nunito, Outfit, sans-serif">${body}</svg></body></html>`);
      files.push(file);
    }
  }
  const { chromium } = await import("/Users/hassanahmed/ai-tutor/node_modules/playwright/index.mjs" as string);
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  for (const f of files) {
    await page.goto(`file://${f}`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: f.replace(/\.html$/, ".png") });
  }
  await browser.close();
  console.log(files.map((f) => f.replace(/\.html$/, ".png")).join("\n"));
}

main().catch((err) => { console.error(err); process.exit(1); });
