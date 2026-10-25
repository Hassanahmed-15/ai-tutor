// A saved course picture board with today's pointing applied, photographed mid-sentence (free):
//   node --conditions=react-server --import tsx scripts/qa/.probe/talkframe.mts <session> <board> <outPrefix>
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { boardPhoto } = await import("../../../lib/canvas/boardLook");
const { partMentionCues } = await import("../../../lib/canvas/pictureTalk");
const { layoutPanel } = await import("../../../lib/canvas/layout");
const { canvasSentences } = await import("../../../lib/canvas/plan");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [id, n, prefix] = process.argv.slice(2);
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.userId, c.topic, c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id AND c.sequence = @n", parameters: [{ name: "@id", value: id }, { name: "@n", value: Number(n) - 1 }] }).fetchAll()).resources[0] as any;
const spec = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
const script = s.plan[Number(n) - 1].canvas.script as string;
spec.cues = partMentionCues(spec, script);
const sentences = canvasSentences(script);
const talk = spec.cues.filter((c: any) => c.action === "circle" || c.action === "point");
console.log(`pointer moves: ${talk.length} over ${sentences.length} sentences`);
for (const c of talk.slice(0, 12)) console.log(`  s${c.s} at ${c.at} ${c.action} ${c.target} — "${sentences[c.s]?.slice(0, 70)}"`);
const links = layoutPanel(spec).marks.filter((m: any) => m.type === "partLink");
console.log(`note links: ${links.length}`, links.map((l: any) => `s${l.s}`).join(" "));
// Frames: the first two sentences that both point at a part and tie a note to one.
const frames = [...new Set(talk.map((c: any) => c.s))].filter((x: any) => links.some((l: any) => l.s === x)).slice(0, 2) as number[];
for (const f of frames.length ? frames : [...new Set(talk.map((c: any) => c.s))].slice(0, 2) as number[]) {
  const cue = talk.find((c: any) => c.s === f);
  const png = await boardPhoto(spec, { userId: s.userId, topic: s.topic, at: { sentence: f, progress: Math.min(0.95, (cue?.at ?? 0.3) + 0.08), waitMs: Number(process.env.WAIT ?? 16000) } });
  if (png) writeFileSync(`${prefix}-s${f}.png`, png);
  console.log(`frame at sentence ${f}: ${png ? "photographed" : "no photo"}`);
}
process.exit(0);
