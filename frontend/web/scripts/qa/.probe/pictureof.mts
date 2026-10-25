// A saved board's picture and words (read-only): node --conditions=react-server --import tsx scripts/qa/.probe/pictureof.mts <session> <board> <out.jpg>
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { loadCanvasImage } = await import("../../../lib/canvas/store");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [id, n, out] = process.argv.slice(2);
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.userId FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id AND c.sequence = @n", parameters: [{ name: "@id", value: id }, { name: "@n", value: Number(n) - 1 }] }).fetchAll()).resources[0] as any;
const spec = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
const src = spec.stage.src as string | undefined;
if (src && out) { const name = src.split("/").pop()!; const bytes = await loadCanvasImage(s.userId, name); if (bytes) writeFileSync(out, bytes); }
console.log(JSON.stringify({ heading: spec.heading, notes: spec.notes.map((x: any) => x.text), lines: spec.stage.kind === "sketch" ? spec.stage.items.map((i: any) => i.text) : undefined, src }));
process.exit(0);
