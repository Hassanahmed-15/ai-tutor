// A saved session's top-level fields (free).
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT * FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: process.argv[2] }] }).fetchAll()).resources[0] as any;
console.log(Object.keys(s).join(", "));
const inp = s.input ?? s.request ?? {};
console.log("input keys:", Object.keys(inp).join(", "), "| sourceType:", inp.sourceType, "| blocks:", inp.suprnotes?.contentBlocks?.length);
process.exit(0);
