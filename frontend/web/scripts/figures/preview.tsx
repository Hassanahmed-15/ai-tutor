/**
 * PREVIEW ANY FIGURE COMPONENT (free, no model): renders a board with every part labelled, on paper
 * and on chalk, and screenshots both.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/figures/preview.tsx <outDir> <module path> <export name> ['{"param":"value"}'] [--notes]
 *
 * e.g. scripts/figures/preview.tsx /tmp/fig lib/figures/components/titration.ts titration '{"flaskColour":"colourless"}'
 * Writes <outDir>/<name>-paper.png and <name>-chalk.png (and .html). Check: labels outside the art,
 * leaders ending on the right parts, nothing overlapping, the science right.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasPanel } from "@/components/canvas/CanvasPanel";
import { layoutPanel } from "@/lib/canvas/layout";
import { validateCanvasSpec } from "@/lib/canvas/validate";
import { chalkCss } from "@/lib/canvas/theme";
import { registerFigureComponent } from "@/lib/figures/registry";
import type { FigureComponent } from "@/lib/figures/types";

async function main() {
  const [out, modulePath, exportName, paramsJson = "{}", ...flags] = process.argv.slice(2);
  const mod = (await import(path.resolve(modulePath))) as Record<string, FigureComponent>;
  const component = mod[exportName];
  if (!component) throw new Error(`no export ${exportName} in ${modulePath}`);
  registerFigureComponent(component);
  const params = JSON.parse(paramsJson);
  const drawing = component.build(params);
  const spec = validateCanvasSpec({
    heading: component.title.split(":")[0].slice(0, 50),
    notes: flags.includes("--notes") ? ["A first key note", "A second key note"] : [],
    cues: [],
    stage: { kind: "figure", component: component.name, params, parts: drawing.parts.slice(0, 8).map((p, i) => ({ id: p.id, name: p.name, s: i })) },
  }, 9);
  if (!spec) throw new Error("the board did not validate");
  const layout = layoutPanel(spec);
  fs.mkdirSync(out, { recursive: true });
  const files: string[] = [];
  for (const theme of ["paper", "chalk"] as const) {
    const svg = renderToStaticMarkup(React.createElement(CanvasPanel, { layout, spec, shownThrough: Infinity, sentenceProgress: 1, live: false, vars: {}, carryFrom: {}, reducedMotion: true, theme } as never));
    const body = theme === "chalk" ? `<style>${chalkCss()}</style><rect width="1000" height="560" rx="22" fill="#22302a"/><g class="cv-chalk">${svg}</g>` : svg;
    const file = path.join(out, `${component.name}-${theme}.html`);
    fs.writeFileSync(file, `<html><body style="margin:0;background:#fff"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" width="1000" height="560" font-family="Nunito, Outfit, sans-serif">${body}</svg></body></html>`);
    files.push(file);
  }
  const { chromium } = await import("/Users/hassanahmed/ai-tutor/node_modules/playwright/index.mjs" as string);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  for (const f of files) { await page.goto(`file://${f}`); await page.screenshot({ path: f.replace(/\.html$/, ".png") }); }
  await browser.close();
  console.log(files.map((f) => f.replace(/\.html$/, ".png")).join("\n"));
}

main().catch((err) => { console.error(err); process.exit(1); });
