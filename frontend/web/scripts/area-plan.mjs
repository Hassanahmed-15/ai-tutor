/**
 * The plan a lecture "from this area" would be built from — computed offline, no generation cost.
 *
 * Feeds a saved parse response (from scripts/test-area-lecture.mjs) to the real planner,
 * `buildProgressivePlan`, compiled by `npx tsc -p tsconfig.test.json` into .test-build.
 *
 *   node scripts/area-plan.mjs <area-parse.json> [strict|reference]
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildProgressivePlan } = require("../.test-build/lib/progressivePlan.js");

const [file, fidelity = "strict"] = process.argv.slice(2);
const parse = JSON.parse(fs.readFileSync(file, "utf8"));
const doc = parse.sourceDocument;
const selectedPages = [...new Set((doc.contentBlocks ?? []).filter((b) => /\(selected area\)/i.test(b.heading ?? "")).map((b) => b.pageNumber))];
const plan = buildProgressivePlan({
  topic: doc.lesson?.title ?? "Selected region",
  suprnotes: doc,
  sourceScope: { fidelity, breadth: { kind: "whole" }, documentLabels: [] },
  selection: { pages: selectedPages, transcript: String(parse.ocrTranscript ?? "").slice(0, 8000), description: "Selected region" },
  transcript: parse.ocrTranscript ?? "",
  // The app's default profile (components/pages/LearnPage.tsx DEFAULT_LEARNER_PROFILE).
  learnerProfile: { expertise: "intermediate", depth: "balanced", goal: "curiosity", codeExamples: false, preferredExamples: "mixed", rationale: "", confirmedAt: "" },
});
const text = (ids) => (doc.contentBlocks ?? []).filter((b) => ids.includes(b.id)).map((b) => `${b.heading ?? ""} ${b.text ?? ""}`).join(" ").replace(/\s+/g, " ").slice(0, 90);
console.log(`${fidelity.toUpperCase()} plan for the area on page ${selectedPages.join(",")}: ${plan.length} part(s)`);
for (const beat of plan) console.log(`  - "${beat.title}"  [${(beat.sourceBlockIds ?? []).join(",")}]  ${text(beat.sourceBlockIds ?? [])}`);
