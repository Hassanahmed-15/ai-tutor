import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
for (const id of process.argv.slice(2)) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.userId, c.topic, c.playhead, c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  console.log(id, s.userId, s.topic, "playhead", s.playhead);
  s.plan.forEach((p: any, i: number) => console.log(`  ${i}. ${p.canvas?.stage ?? "?"} | ${p.canvas?.title ?? p.title}`));
}
