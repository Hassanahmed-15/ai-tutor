import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: process.argv[2] }] }).fetchAll()).resources[0] as any;
const p0 = s.plan[0];
console.log(Object.keys(p0).join(", "));
console.log("canvas keys:", p0.canvas ? Object.keys(p0.canvas).join(", ") : "none");
process.exit(0);
