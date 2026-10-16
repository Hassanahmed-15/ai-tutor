import { figureComponent } from "./registry";
import type { FigureParams } from "./types";

/**
 * WORDS A FIGURE WRITES THAT THE BOARD NEVER SAYS. A content figure (a balance, a cause map, a
 * timeline) given no data draws its own example: a psychology board on sampling showed "Was the
 * Treaty of Versailles fair?" (audit 2026-10-17). Any figure whose written words are mostly foreign
 * to the board's title, brief, narration and part names is drawing someone else's lesson.
 *
 * Returns the foreign words (empty when the figure is about this board). Pure.
 */
const STOP = new Set("about above after again against also among because been before being below between both could does down during each every from have having here into itself just like more most much must only other over same should some such than that their them then there these they this those through under until very were what when where which while with would your".split(" "));

const stem = (w: string) => w.toLowerCase().replace(/(ies|es|s|ed|ing)$/, "").slice(0, 5);
const contentWords = (text: string) => (text.match(/\p{L}[\p{L}'’-]{3,}/gu) ?? []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w));

export function foreignFigureWords(component: string, params: FigureParams, boardText: string, partNames: string[] = []): string[] {
  const c = figureComponent(component);
  if (!c) return [];
  let written: string[];
  try {
    written = c.build(params).shapes.flatMap((s) => (s.t === "text" ? contentWords(s.text) : []));
  } catch {
    return [];
  }
  if (written.length < 3 && !c.build(params).shapes.some((sh) => sh.t === "text" && /\d/.test(sh.text))) return [];
  // What the board writer put in the params is this board's content; only the component's own
  // defaults — its example lesson — can be foreign.
  const given = Object.values(params).map(String).join(" ");
  const known = new Set([...contentWords(boardText), ...contentWords(given), ...contentWords(partNames.join(" ")), ...contentWords(c.parts.map((p) => p.name).join(" "))].map(stem));
  const foreign = [...new Set(written.filter((w) => !known.has(stem(w))))];
  // Numbers count too: a solids figure with no data drew its default 4 × 8 × 5 cuboid while Aria
  // spoke about cylinders of 80 cm³ and 270 cm³ (similarity audit 2026-10-17).
  const drawnNumbers = [...new Set(c.build(params).shapes.flatMap((sh) => (sh.t === "text" ? sh.text.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? [] : [])))];
  const saidNumbers = new Set(`${boardText} ${given}`.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []);
  // Only when Aria gives numbers of her own can the figure's contradict them; evenly spaced numbers
  // are a scale's ticks (a burette's 0, 10, 20…), part of the apparatus, not data.
  const ticks = new Set(scaleTicks(drawnNumbers.map(Number)).map(String));
  const foreignNumbers = drawnNumbers.filter((n) => !saidNumbers.has(n) && Number(n) > 1 && !ticks.has(String(Number(n))));
  if (saidNumbers.size >= 2 && foreignNumbers.length >= 2 && foreignNumbers.length > drawnNumbers.length / 2) return [...foreign, ...foreignNumbers.map((n) => `the number ${n}`)];
  // Axis words and units a standard figure always writes are a few; an example lesson is most of them.
  return foreign.length >= 3 && foreign.length > new Set(written).size * 0.4 ? foreign : [];
}

/** Numbers that sit on an evenly spaced run of three or more (a scale's tick labels). */
function scaleTicks(values: number[]): number[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const out = new Set<number>();
  for (let i = 0; i + 2 < sorted.length; i++) {
    const step = sorted[i + 1] - sorted[i];
    if (step > 0 && Math.abs(sorted[i + 2] - sorted[i + 1] - step) < 1e-9) [sorted[i], sorted[i + 1], sorted[i + 2]].forEach((v) => out.add(v));
  }
  return [...out];
}
