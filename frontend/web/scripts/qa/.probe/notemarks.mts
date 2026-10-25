// A saved board's note marks after today's layout (free): id, sentence, until, position, text, and its part link.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { layoutPanel } = await import("../../../lib/canvas/layout");
const { partMentionCues } = await import("../../../lib/canvas/pictureTalk");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [id, n] = process.argv.slice(2);
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id AND c.sequence = @n", parameters: [{ name: "@id", value: id }, { name: "@n", value: Number(n) - 1 }] }).fetchAll()).resources[0] as any;
const spec = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
spec.cues = partMentionCues(spec, s.plan[Number(n) - 1].canvas.script);
console.log("spec notes:", JSON.stringify(spec.notes.map((x: any) => ({ id: x.id, s: x.s, until: x.until, text: x.text }))));
const marks = layoutPanel(spec).marks as any[];
for (const m of marks.filter((x) => x.type === "note" || x.type === "partLink")) console.log(m.type, m.id, `s${m.s}`, m.until ?? "", m.type === "note" ? `(${Math.round(m.x)},${Math.round(m.y)}) "${m.lines.join(" / ")}"` : `(${Math.round(m.from.x)},${Math.round(m.from.y)})->(${Math.round(m.to.x)},${Math.round(m.to.y)})`);
process.exit(0);
