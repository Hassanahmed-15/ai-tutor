// The course visual choice replayed on saved lessons' boards (paid: one small call a lesson) + today's routing.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { chooseVisuals } = await import("../../../lib/canvas/visualChoice");
const { applyLessonVisualPolicy } = await import("../../../lib/canvas/visualPolicy");
const { client, jsonCall, PLAN_MODEL } = await import("../../../lib/canvas/generate");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
let total = 0;
for (const id of process.argv.slice(2)) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  // The saved brief carries the earlier choice ("… Diagram: a flow of …"): taken off, as a fresh plan has none.
  const beats = s.plan.map((p: any) => ({ ...p.canvas, visualType: undefined, written: undefined, brief: String(p.canvas?.brief ?? "").replace(/\s*(Picture|Diagram|Graph):[\s\S]*$/, "").trim() }));
  const chosen = await chooseVisuals((system, user, max) => jsonCall(client(), PLAN_MODEL, system, user, max), s.topic, beats, { course: true });
  total += chosen.costUsd;
  const routed = applyLessonVisualPolicy(chosen.beats, { mode: "course", topic: s.topic });
  console.log(`\n${s.topic}\n  why: ${chosen.log}`);
  routed.beats.forEach((b, i) => console.log(`  b${i + 1} ${String(chosen.beats[i].visualType).padEnd(10)} → ${b.written ? "written notes" : b.stage === "illustration" ? "PICTURE" : b.stage}   "${b.title}"`));
}
console.log(`\nvisual choice calls $${total.toFixed(4)}`);
process.exit(0);
