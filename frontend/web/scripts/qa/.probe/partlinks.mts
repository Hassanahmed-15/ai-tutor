import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
process.chdir("/Users/hassanahmed/ai-tutor/frontend/web");
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { layoutPanel } = await import("../../../lib/canvas/layout");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [id, n] = process.argv.slice(2);
const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id AND c.sequence = @n", parameters: [{ name: "@id", value: id }, { name: "@n", value: Number(n) - 1 }] }).fetchAll()).resources[0] as any;
const spec = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
console.log("parts:", spec.stage.parts.map((p: any) => `${p.id}="${p.name}"`).join(", "));
const m = layoutPanel(spec).marks;
for (const l of m.filter((x: any) => x.type === "partLink") as any[]) { const note = m.find((x: any) => `link-${x.id}` === l.id) as any; console.log(`  ${l.id}: "${note?.lines.join(" ")}" -> (${Math.round(l.to.x)},${Math.round(l.to.y)})`); }
process.exit(0);
