// A saved board's picture stage (free): src, parts, labels, owner.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [id, n] = process.argv.slice(2);
const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id AND c.sequence = @n", parameters: [{ name: "@id", value: id }, { name: "@n", value: Number(n) - 1 }] }).fetchAll()).resources[0] as any;
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.userId FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
const st = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec.stage;
console.log("user", s.userId?.slice(0, 8), "beat keys", Object.keys(b).join(","));
console.log(JSON.stringify({ ...st, description: st.description?.slice(0, 80) }, null, 1).slice(0, 1500));
process.exit(0);
