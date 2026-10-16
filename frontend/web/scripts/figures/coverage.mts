/**
 * VISUAL COVERAGE OF EVERY COURSE LESSON (free, no model):
 *   NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json scripts/figures/coverage.mts
 * Builds each lesson's boards from its official outcomes (one per outcome, stage as the planner would
 * route it), runs the real visual policy (components, library, drawn diagrams, AI pictures, the
 * every-lesson guarantee) and reports how many lessons end with at least one real visual, by subject.
 */
import fs from "node:fs";
import { applyLessonVisualPolicy, nativeStageFor } from "../../lib/canvas/visualPolicy";
import { findLibraryFigure } from "../../lib/figures/library";
import { buildMenu, menuCourseIds } from "../../lib/curriculum/curation";
import type { CanvasPlanBeat } from "../../lib/canvas/types";

const DATA = "data/curricula";
const catalog = JSON.parse(fs.readFileSync(`${DATA}/catalog.json`, "utf8"));
const ids = menuCourseIds(buildMenu(catalog.entries));
const VISUAL = new Set(["figure", "illustration", "graph", "molecule", "atom-map", "equation", "code"]);
const fam = (s: string) => /biolog|chemistr|physic|science|environment|agricult|marine/i.test(s) ? "Sciences" : /math|statist|calculus/i.test(s) ? "Maths" : /econom|business|accounting|commerce/i.test(s) ? "Economics & business" : /histor|sociolog|religio|islam|politic|government|global|geograph|psycholog|law|civics|social/i.test(s) ? "Humanities & social" : /english|literature|language|french|spanish|urdu|arabic|chinese|german|latin/i.test(s) ? "Languages & literature" : "Other";
const stats: Record<string, { lessons: number; covered: number }> = {};
const used: Record<string, number> = {};
let lessons = 0, covered = 0;
for (const id of ids) {
  const t = JSON.parse(fs.readFileSync(`${DATA}/trees/${id}.json`, "utf8"));
  const f = fam(t.subject);
  for (const g of t.grades) for (const u of g.units) for (const tp of u.topics) for (const s of tp.subtopics) {
    const outs = (s.outcomes as Array<{ text: string }>).slice(0, 6);
    if (!outs.length) continue;
    const beats: CanvasPlanBeat[] = outs.map((o, i) => {
      const b: CanvasPlanBeat = { id: `b${i + 1}`, title: s.title, brief: o.text, script: `${o.text}. Predict: what would change? It changes.`, stage: "scene", objects: [], inside: null, carry: [], interaction: "quiz", overview: false };
      b.stage = nativeStageFor(b);
      return b;
    });
    const out = applyLessonVisualPolicy(beats, { mode: "course", aiPictures: true, findAsset: (text: string) => findLibraryFigure(text) as never });
    const ok = out.beats.some((b) => VISUAL.has(b.stage));
    for (const b of out.beats) if (b.stage === "figure") used[b.figure ?? "?"] = (used[b.figure ?? "?"] ?? 0) + 1; else if (b.stage === "illustration") used["AI picture"] = (used["AI picture"] ?? 0) + 1;
    lessons++; if (ok) covered++;
    const st = (stats[f] ??= { lessons: 0, covered: 0 }); st.lessons++; if (ok) st.covered++;
  }
}
console.log(`ALL: ${covered}/${lessons} lessons (${(100 * covered / lessons).toFixed(1)}%) end with at least one real visual`);
for (const [k, v] of Object.entries(stats).sort((a, b) => b[1].lessons - a[1].lessons)) console.log(`${k.padEnd(24)} ${(100 * v.covered / v.lessons).toFixed(1)}%  (${v.covered}/${v.lessons})`);
console.log("visual boards by source:", Object.entries(used).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${k}:${n}`).join(" "));
