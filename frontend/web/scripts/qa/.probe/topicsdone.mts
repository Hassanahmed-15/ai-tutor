// Saved lecture topics (free): to avoid re-running a tested topic.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const rows = (await db.container("progressive-lecture-sessions").items.query(`SELECT c.topic FROM c`).fetchAll()).resources as any[];
const want = process.argv.slice(2).map((w) => w.toLowerCase());
for (const w of want) console.log(`${w}: ${rows.filter((r) => (r.topic ?? "").toLowerCase().includes(w)).map((r) => r.topic).slice(0, 6).join(" | ") || "never"}`);
process.exit(0);
