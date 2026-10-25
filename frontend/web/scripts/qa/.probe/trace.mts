import { applyLessonVisualPolicy } from "/Users/hassanahmed/ai-tutor/frontend/web/lib/canvas/visualPolicy";
import { figureFor } from "/Users/hassanahmed/ai-tutor/frontend/web/lib/figures/registry";
const b: any = { id: "b1", title: "Artery Structure", script: "An artery has a thick muscular wall and elastic tissue around a small lumen. It carries blood away from the heart at high pressure.", stage: "illustration", brief: "artery cross-section", objects: [], inside: null, carry: [], interaction: null, overview: false, requiredVisual: { stages: ["illustration"], mustShow: [] } };
console.log("opening pick:", figureFor("Artery Structure artery cross-section An artery has a thick muscular wall and elastic tissue around a small lumen.")?.name);
const r = applyLessonVisualPolicy([b], { mode: "course", topic: "Blood vessels", aiPictures: true });
console.log(r.beats[0].stage, r.beats[0].figure);
console.log(r.audit.changes.join("\n"));
