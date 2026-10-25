// How a written board (Aria's notes, no picture) looks for a non-maths course board (free, local render).
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { boardPhoto } = await import("../../../lib/canvas/boardLook");
const { fallbackSpec } = await import("../../../lib/canvas/fallback");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [id, n, out] = process.argv.slice(2);
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.userId, c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
const beat = { ...s.plan[Number(n) - 1].canvas, course: true };
const spec = fallbackSpec(beat);
console.log(JSON.stringify(spec.stage).slice(0, 600));
const png = await boardPhoto(spec, { userId: s.userId, topic: s.topic, withoutCues: true });
if (png) writeFileSync(out, png);
process.exit(0);
