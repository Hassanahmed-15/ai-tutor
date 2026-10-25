// A saved board photographed by the real board renderer (free): node --conditions=react-server --import tsx scripts/qa/.probe/lookphoto.mts <session> <board> <out.png>
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { boardPhoto } = await import("../../../lib/canvas/boardLook");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [id, n, out] = process.argv.slice(2);
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.userId, c.topic FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id AND c.sequence = @n", parameters: [{ name: "@id", value: id }, { name: "@n", value: Number(n) - 1 }] }).fetchAll()).resources[0] as any;
const spec = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
const png = await boardPhoto(spec, { userId: s.userId, topic: s.topic, withoutCues: true });
if (png) writeFileSync(out, png);
console.log(png ? `photographed ${spec.stage.kind} (subject ${spec.subject})` : "no photo");
process.exit(0);
