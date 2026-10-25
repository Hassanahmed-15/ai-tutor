import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
let t = 0;
for (const id of process.argv.slice(2)) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.costUsd FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  t += s.costUsd ?? 0;
  console.log(`$${(s.costUsd ?? 0).toFixed(3)} ${s.topic.slice(0, 50)}`);
}
console.log(`total $${t.toFixed(3)}`);
process.exit(0);
