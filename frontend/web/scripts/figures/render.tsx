/** Renders a sample figure board to HTML for eyeballing: npx tsx --tsconfig tsconfig.json scripts/figures/render.tsx <outDir> */import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasPanel } from "@/components/canvas/CanvasPanel";
import { layoutPanel } from "@/lib/canvas/layout";
import { validateCanvasSpec } from "@/lib/canvas/validate";
import { chalkCss } from "@/lib/canvas/theme";

const out = process.argv[2];
const spec = validateCanvasSpec({
  heading: "Setting up a titration",
  notes: ["Pipette: fixed volume", "Burette: variable volume", "Swirl while adding acid"],
  cues: [{ s: 2, action: "point", target: "tap" }],
  stage: { kind: "figure", component: "titration", params: { titrant: "hydrochloric acid", analyte: "NaOH + phenolphthalein", flaskColour: "pink", drop: true },
    parts: [
      { id: "burette", name: "Burette", s: 0 }, { id: "titrant", name: "Hydrochloric acid", s: 0 }, { id: "scale", s: 1 },
      { id: "tap", s: 2 }, { id: "conical-flask", s: 3 }, { id: "analyte", name: "NaOH + phenolphthalein", s: 3 }, { id: "white-tile", s: 4 }, { id: "clamp", s: 1 },
    ] },
}, 6)!;
const layout = layoutPanel(spec);
for (const [theme, shown, focus] of [["paper", Infinity, undefined], ["chalk", 3, "conical-flask"]] as const) {
  const svg = renderToStaticMarkup(React.createElement(CanvasPanel, { layout, spec, shownThrough: shown, sentenceProgress: 1, live: false, vars: {}, focusId: focus, carryFrom: {}, reducedMotion: true, theme } as never));
  fs.writeFileSync(`${out}/titration-${theme}.html`, `<html><body style="margin:0;background:#fff"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" width="1000" height="560" font-family="Nunito, Outfit, sans-serif">${theme === "chalk" ? `<style>${chalkCss()}</style><rect width="1000" height="560" rx="22" fill="#22302a"/><g class="cv-chalk">${svg}</g>` : svg}</svg></body></html>`);
}
console.log("ok", layout.marks.filter((m) => m.type === "figure-label").length, "labels");
