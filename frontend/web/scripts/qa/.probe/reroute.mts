// Saved course plans through today's course routing (read-only, free): which boards become gpt-image-2 pictures.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { applyLessonVisualPolicy } from "../../../lib/canvas/visualPolicy";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
for (const id of process.argv.slice(2)) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  const beats = s.plan.map((p: any) => structuredClone(p.canvas)).filter(Boolean);
  const before = beats.map((b: any) => `${b.stage}${b.figure ? `(${b.figure})` : ""}`);
  const out = applyLessonVisualPolicy(beats, { mode: "course", topic: s.topic });
  console.log(`\n${s.topic} [${beats[0]?.subject}]`);
  out.beats.forEach((b, i) => console.log(`  b${i + 1} ${before[i].padEnd(26)} → ${b.stage}${b.pictureBeside ? " + picture beside" : ""}${b.figure ? `(${b.figure})` : ""}  "${b.title}"`));
}
process.exit(0);
