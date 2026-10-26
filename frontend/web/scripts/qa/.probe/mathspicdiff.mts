// The visual policy over saved lecture plans with maths pictures on and off (free): every board that differs.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { applyLessonVisualPolicy } = await import("../../../lib/canvas/visualPolicy");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const sessions = (await db.container("progressive-lecture-sessions").items.query(`SELECT TOP ${Number(process.argv[2] ?? 300)} c.id, c.topic, c.sourceType, c.plan FROM c ORDER BY c._ts DESC`).fetchAll()).resources as any[];
let lectures = 0, boards = 0, changed = 0, wrong = 0;
const marks = new Map<string, number>();
const kinds = new Map<string, number>();
for (const s of sessions) {
  if (!Array.isArray(s.plan) || !s.plan.length || !s.plan.every((b: any) => (b.canvas ?? b).stage)) continue;
  const course = s.sourceType === "suprnotes" && s.plan.some((b: any) => b.course || b.subject);
  const mode = course ? "course" : s.sourceType === "pdf" || s.sourceType === "document" ? "reference" : "prompt";
  kinds.set(`${s.sourceType}/${mode}`, (kinds.get(`${s.sourceType}/${mode}`) ?? 0) + 1);
  lectures++;
  const plan = () => JSON.parse(JSON.stringify(s.plan.map((b: any) => ({ objects: [], carry: [], inside: null, ...(b.canvas ?? b), mathsPicture: undefined }))));
  const off = applyLessonVisualPolicy(plan(), { mode: mode as any, topic: s.topic }).beats;
  const on = applyLessonVisualPolicy(plan(), { mode: mode as any, topic: s.topic, mathsPictures: true }).beats;
  on.forEach((b: any, i: number) => {
    boards++;
    const a = off[i];
    if (b.mathsPictureFallback) { marks.set(`${s.topic.slice(0, 50)} (${mode})`, (marks.get(`${s.topic.slice(0, 50)} (${mode})`) ?? 0) + 1); }
    const same = JSON.stringify({ ...a }) === JSON.stringify({ ...b, mathsPictureFallback: undefined });
    if (same) return;
    changed++;
    const ok = b.mathsPicture === true && (b.stage === "illustration" || b.stage === "equation") && mode !== "course";
    if (!ok) wrong++;
    console.log(`${ok ? "  " : "!!"} ${s.id.slice(0, 8)} ${mode} "${s.topic.slice(0, 40)}" ${b.id}: ${a.stage}${a.figure ? `:${a.figure}` : ""} → ${b.stage}${b.mathsPicture ? "+maths-picture" : ""} "${b.title.slice(0, 40)}"`);
  });
}
console.log(`\nmarked for a second-time picture (lecture: boards):\n${[...marks].map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
console.log(`\n${lectures} lectures (${[...kinds].map(([k, v]) => `${k} ${v}`).join(", ")}), ${boards} boards: ${changed} differ, ${wrong} differ in any other way`);
process.exit(0);
