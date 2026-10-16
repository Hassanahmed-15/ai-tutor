/**
 * Replays a saved lecture's plan through the visual policy and the no-model backup boards, so a
 * routing change can be seen on a real lesson for free:
 *   npx tsx --tsconfig tsconfig.json scripts/figures/replay.tsx <snapshot.json> <outDir>
 */
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasPanel } from "@/components/canvas/CanvasPanel";
import { layoutPanel } from "@/lib/canvas/layout";
import { applyLessonVisualPolicy } from "@/lib/canvas/visualPolicy";
import { fallbackSpec } from "@/lib/canvas/fallback";
import type { CanvasPlanBeat, CanvasStage } from "@/lib/canvas/types";

const [snapPath, out] = process.argv.slice(2);
const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
const plan: CanvasPlanBeat[] = snap.beats.map((b: { title: string; script: string; draw: { ops: Array<{ spec: { stage: { kind: CanvasStage } } }> } }, i: number) => ({
  id: `b${i + 1}`, title: b.title, script: b.script, stage: b.draw.ops[0].spec.stage.kind, brief: b.title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false,
}));
const { beats, audit } = applyLessonVisualPolicy(plan, { mode: "course" });
console.log(audit.changes.join("\n") || "no changes");
beats.forEach((beat, i) => {
  if (beat.stage !== "figure") return;
  const spec = fallbackSpec(beat);
  const svg = renderToStaticMarkup(React.createElement(CanvasPanel, { layout: layoutPanel(spec), spec, shownThrough: Infinity, sentenceProgress: 1, live: false, vars: {}, carryFrom: {}, reducedMotion: true, theme: "paper" } as never));
  fs.writeFileSync(`${out}/replay-b${i + 1}.html`, `<html><head><meta charset="utf-8"></head><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" width="1000" height="560" font-family="Nunito, sans-serif">${svg}</svg></body></html>`);
  console.log(`board ${i + 1} → ${out}/replay-b${i + 1}.html`);
});
