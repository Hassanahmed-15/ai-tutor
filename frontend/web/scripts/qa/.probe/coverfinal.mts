// Do saved course lessons, as finally spoken, still teach every syllabus key point and term? (free)
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const store = await import("../../../lib/progressiveLectureStore");
const { courseCoverageGaps, requiredTermsOf, keyPointTaught } = await import("../../../lib/canvas/courseCoverage");
const { curriculumDocumentOf } = await import("../../../lib/canvas/lessonRequest");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const sessions = (await db.container("progressive-lecture-sessions").items.query(`SELECT TOP ${Number(process.argv[2] ?? 40)} * FROM c WHERE c.sourceType = "suprnotes" ORDER BY c._ts DESC`).fetchAll()).resources as any[];
let lessons = 0, points = 0, taught = 0, termsAll = 0, termsMissing = 0;
for (const s of sessions) {
  const input = await store.progressiveInput(s).catch(() => null);
  const doc = input && curriculumDocumentOf(input);
  if (!doc || !Array.isArray(s.plan)) continue;
  lessons++;
  const beats = s.plan.map((b: any) => ({ id: b.id, title: b.title, script: b.canvas?.script ?? b.script ?? "", refresher: b.refresher }));
  const lessonBeats = beats.filter((b: any) => !b.refresher);
  const missed: string[] = [];
  doc.contentBlocks.forEach((block: any, i: number) => {
    for (const p of block.keyIdeas ?? []) { points++; if (lessonBeats[i] && keyPointTaught(p, lessonBeats[i].script)) taught++; else missed.push(`b${i + 1}: ${p.slice(0, 70)}`); }
  });
  const terms = requiredTermsOf(doc.contentBlocks[0].teachingHints);
  const gaps = courseCoverageGaps(beats, doc.contentBlocks, terms);
  termsAll += terms.length; termsMissing += gaps.terms.length;
  console.log(`${s.id.slice(0, 8)} "${s.topic.slice(0, 50)}" ${new Date(s._ts * 1000).toISOString().slice(0, 10)}: key points missed ${missed.length}, terms missed ${gaps.terms.length}/${terms.length}${missed.length ? `\n   ${missed.slice(0, 3).join("\n   ")}` : ""}${gaps.terms.length ? `\n   terms: ${gaps.terms.join(", ")}` : ""}`);
}
console.log(`\n${lessons} course lessons: ${taught}/${points} key points taught (${Math.round((taught / Math.max(1, points)) * 100)}%), ${termsAll - termsMissing}/${termsAll} required terms used`);
process.exit(0);
