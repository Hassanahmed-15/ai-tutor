// A saved board's title, brief and script (read-only): node --import tsx scripts/qa/.probe/beattext.mts <session> <board number>
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: process.argv[2] }] }).fetchAll()).resources[0] as any;
const b = s.plan[Number(process.argv[3]) - 1]?.canvas;
console.log(JSON.stringify({ title: b?.title, brief: b?.brief, script: b?.script, boardNotes: b?.boardNotes, stage: b?.stage, visualType: b?.visualType }, null, 1));
process.exit(0);
