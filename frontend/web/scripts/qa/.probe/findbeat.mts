import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
for (const t of process.argv.slice(2)) {
  const r = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT TOP 1 c.sessionId, c.sequence, c.userId FROM c WHERE c.beat.title = @t ORDER BY c._ts DESC", parameters: [{ name: "@t", value: t }] }).fetchAll()).resources[0] as any;
  console.log(t, "|", r?.sessionId, r?.sequence, r?.userId);
}
