import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT * FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: process.argv[2] }] }).fetchAll()).resources[0] as any;
console.log(Object.keys(s).join(", "));
for (const k of Object.keys(s)) if (/input|blob|doc|suprnotes|source/i.test(k)) console.log(k, JSON.stringify(s[k]).slice(0, 200));
process.exit(0);
