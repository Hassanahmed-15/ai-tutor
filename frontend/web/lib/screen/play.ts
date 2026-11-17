import "server-only";

import { lintPlay, PLAY_SYSTEM } from "./playSpec.js";
import { askJson, parseJson, type Msg } from "./sketch";

/**
 * "TRY IT" after a mark (owner 2026-11-17): drag to change values; Aria asks, the student answers.
 * One fast call (Qwen on Cerebras, luna when it fails; same as the pencil board) turns her
 * explanation and the board she drew into a small interactive challenge (public/screen/play.js).
 * lintPlay computes every expression over the slider range; one repair round when it fails; a
 * challenge that still fails is dropped (the board simply has no Try it), never shown half-broken.
 * Benched on 18 saved real marks: 13 challenges, 5 rightly none (definitions), all reachable.
 */
export async function makePlay(opts: { concept: string; said: string; scene: unknown; crop: string | null; signal: AbortSignal }) {
  const { concept, said, scene, crop, signal } = opts;
  const brief = [
    `What the student marked: ${concept || "(see the picture)"}`,
    `What Aria said about it: ${said}`,
    scene ? `The board she drew (for the names and numbers she used): ${JSON.stringify(scene).slice(0, 2500)}` : "",
    crop ? "The picture is what they marked. Write the Try-it challenge." : "Write the Try-it challenge.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const messages: Msg[] = [
    { role: "system", content: PLAY_SYSTEM },
    { role: "user", content: crop ? [{ type: "text", text: brief }, { type: "image_url", image_url: { url: crop, detail: "high" } }] : brief },
  ];
  const started = Date.now();
  let calls = 1;
  let { text, model } = await askJson(messages, signal);
  let play: unknown = null;
  let issues: string[] = [];
  try {
    play = parseJson(text);
    issues = lintPlay(play);
  } catch (err) {
    issues = [err instanceof Error ? err.message : String(err)];
  }
  if (issues.length) {
    calls++;
    ({ text, model } = await askJson([...messages, { role: "assistant", content: String(text).slice(0, 12000) }, { role: "user", content: `Fix these problems and return the whole corrected JSON object:\n- ${issues.slice(0, 12).join("\n- ")}` }], signal));
    try {
      const fixed = parseJson(text);
      const left = lintPlay(fixed);
      if (left.length <= issues.length || !play) {
        play = fixed;
        issues = left;
      }
    } catch {
      // Keep the first one; it is dropped below if it still fails.
    }
  }
  const none = Boolean(play && typeof play === "object" && (play as { none?: boolean }).none);
  return { play: issues.length || none ? null : play, none, issues: issues.slice(0, 6), ms: Date.now() - started, calls, model };
}

/** mock:true: a fixed challenge for the mock Pythagoras board, so the overlay is tested for free. */
export function mockPlay() {
  return {
    kind: "figure",
    params: [
      { id: "a", label: "side a", min: 1, max: 8, step: 1, value: 2 },
      { id: "b", label: "side b", min: 1, max: 8, step: 1, value: 2 },
    ],
    values: [{ id: "c", label: "longest side c", expr: "sqrt(a^2 + b^2)", dp: 2 }],
    shapes: [
      { k: "path", pts: [[15, 85], ["15 + 9*b", 85], [15, "85 - 9*a"]], closed: true, color: "chalk" },
      { k: "path", pts: [[15, 85], [15, "85 - 9*a"]], color: "cyan", w: 4 },
      { k: "path", pts: [[15, 85], ["15 + 9*b", 85]], color: "pink", w: 4 },
      { k: "path", pts: [[15, "85 - 9*a"], ["15 + 9*b", 85]], color: "yellow", w: 4 },
      { k: "text", at: [10, "85 - 4.5*a"], text: "a = {a:0}", color: "cyan", align: "end" },
      { k: "text", at: ["15 + 4.5*b", 94], text: "b = {b:0}", color: "pink" },
      { k: "text", at: ["19 + 4.5*b", "81 - 4.5*a"], text: "c = {c:2}", color: "yellow", align: "start" },
    ],
    formula: "c = √({a:0}² + {b:0}²) = {c:2}",
    challenge: {
      ask: "Drag the two short sides until the longest side is exactly five.",
      goal: "abs(c - 5) < 0.01",
      hint: "Try small whole numbers: which two squares add up to twenty-five?",
      praise: "Yes! {a:0} squared plus {b:0} squared is twenty-five, so the longest side is five.",
    },
  };
}
