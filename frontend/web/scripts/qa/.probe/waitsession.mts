import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const id = process.argv[2];
for (let i = 0; i < 120; i++) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.status FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  if (["complete", "completed", "failed", "error"].includes(s?.status)) { console.log(`chemistry ${s.status}`); process.exit(0); }
  await new Promise((r) => setTimeout(r, 15000));
}
console.log("chemistry still not finished after 30 min");
