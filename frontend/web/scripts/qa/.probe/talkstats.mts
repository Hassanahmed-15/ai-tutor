// Across recent saved course picture boards (free): how often Aria's sentences name a picture part, and the parts never named.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { partMentionCues, pictureOf } = await import("../../../lib/canvas/pictureTalk");
const { layoutPanel } = await import("../../../lib/canvas/layout");
const { canvasSentences } = await import("../../../lib/canvas/plan");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const beats = (await db.container("progressive-lecture-beats").items.query("SELECT TOP 400 c.sessionId, c.sequence, c.beat FROM c ORDER BY c._ts DESC").fetchAll()).resources as any[];
const plans = new Map<string, any>();
let boards = 0, named = 0, parts = 0, partsNamed = 0, moves = 0, links = 0, notesNaming = 0, notes = 0;
const seen = new Set<string>();
for (const b of beats) {
  const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  const pic = spec && pictureOf(spec);
  if (!spec?.subject || !pic?.coursePicture || seen.has(`${b.sessionId}:${b.sequence}`)) continue;
  seen.add(`${b.sessionId}:${b.sequence}`);
  if (!plans.has(b.sessionId)) plans.set(b.sessionId, (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: b.sessionId }] }).fetchAll()).resources[0]?.plan);
  const script = plans.get(b.sessionId)?.[b.sequence]?.canvas?.script;
  if (!script) continue;
  boards++;
  const cues = partMentionCues(spec, script);
  const talk = cues.filter((c: any) => (c.action === "circle" || c.action === "point") && pic.parts.some((p: any) => p.id === c.target) && !spec.cues.includes(c));
  const ids = new Set(talk.map((c: any) => c.target));
  if (talk.length) named++;
  parts += pic.parts.length; partsNamed += ids.size; moves += talk.length;
  const l = layoutPanel({ ...spec, cues }).marks.filter((m: any) => m.type === "partLink").length;
  links += l; notes += spec.notes.length;
  const missed = pic.parts.filter((p: any) => !ids.has(p.id)).map((p: any) => p.name);
  console.log(`${b.sessionId.slice(0, 8)} b${b.sequence + 1} "${spec.heading}": ${talk.length} moves / ${canvasSentences(script).length} sentences, parts named ${ids.size}/${pic.parts.length}, links ${l}${missed.length ? `  never said: ${missed.join(" | ")}` : ""}`);
}
console.log(`\n${boards} boards: ${named} talk the picture through; parts named ${partsNamed}/${parts}; ${moves} pointer moves; ${links} note links over ${notes} notes`);
process.exit(0);
