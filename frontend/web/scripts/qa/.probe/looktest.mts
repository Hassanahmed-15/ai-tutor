// One real board-look call on saved boards (paid: ~1 cent a board): what it says, and what fix 1 would take off.
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { boardPhoto, lookAtBoard } = await import("../../../lib/canvas/boardLook");
const { removeNamedLines } = await import("../../../lib/canvas/boardLookCheck");
const { client } = await import("../../../lib/canvas/generate");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
let total = 0;
for (const arg of process.argv.slice(2)) {
  const [id, n] = arg.split(":");
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.userId, c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  const saved = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id AND c.sequence = @n", parameters: [{ name: "@id", value: id }, { name: "@n", value: Number(n) - 1 }] }).fetchAll()).resources[0] as any;
  const spec = saved.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
  const beat = s.plan[Number(n) - 1].canvas;
  const photo = await boardPhoto(spec, { userId: s.userId, topic: s.topic, withoutCues: true });
  if (!photo) { console.log(`${arg}: no photo`); continue; }
  writeFileSync(`/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/2735a389-20f1-4b4d-94c6-1e1ea98cc81e/scratchpad/look-${id.slice(0, 8)}-${n}.png`, photo);
  const v = await lookAtBoard(client(), photo, { topic: s.topic, title: beat.title, script: beat.script, stageKind: spec.stage.kind });
  total += v?.costUsd ?? 0;
  console.log(`\n${s.topic} board ${n} (${spec.stage.kind}${spec.stage.coursePicture ? ", gpt-image-2 picture" : ""}): ok=${v?.ok} $${v?.costUsd.toFixed(4)}`);
  for (const p of v?.problems ?? []) console.log(`  - ${p.serious ? "SERIOUS" : "minor"} ${p.kind} [${p.where ?? "?"}] ${p.detail}${p.lines?.length ? `\n      lines: ${JSON.stringify(p.lines)}` : ""}`);
  if (v) console.log(`  fix 1 would take off: ${JSON.stringify(removeNamedLines(spec, v.problems).removed)}`);
}
console.log(`\nlook calls $${total.toFixed(4)}`);
process.exit(0);
