// Aria's talk-through of a saved maths lecture's pictures (free): label boxes read off the real pictures,
// pointer cues and note lines from the real script and notes, and the board photographed mid-sentence.
//   node --conditions=react-server --import tsx scripts/qa/.probe/mathstalk.mts <session> [board,board]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
process.env.CANVAS_STORE = "blob";
const { loadSharedCanvasImage } = await import("../../../lib/canvas/store");
const { mathsLabelBoxes } = await import("../../../lib/canvas/mathsLabels");
const { partMentionCues, pictureOf } = await import("../../../lib/canvas/pictureTalk");
const { layoutPanel } = await import("../../../lib/canvas/layout");
const { canvasSentences } = await import("../../../lib/canvas/plan");
const { boardPhoto } = await import("../../../lib/canvas/boardLook");
const [id, only] = process.argv.slice(2);
const pick = only ? new Set(only.split(",").map(Number)) : null;
const out = `${os.homedir()}/aria-qa-images/maths-talk`;
mkdirSync(out, { recursive: true });
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const session = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.userId FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
const rows = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources as any[];
for (const r of rows.sort((a, b) => a.sequence - b.sequence)) {
  if (pick && !pick.has(r.sequence + 1)) continue;
  const spec = r.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  const pic = spec && pictureOf(spec);
  if (!pic?.onBoard || !pic.src) continue;
  const name = pic.src.split("/").pop();
  const image = (await loadSharedCanvasImage(name)) ?? readFileSync(`.canvas-cache/shared-images/${name}.jpg`);
  const boxes = await mathsLabelBoxes(image, pic.parts.map((p: any) => p.name));
  for (const p of pic.parts) { const b = boxes.get(p.name); if (b) p.labelBox = b; else delete p.labelBox; }
  const before = spec.cues.length;
  spec.cues = partMentionCues(spec, r.beat.script);
  const sentences = canvasSentences(r.beat.script);
  const pointer = spec.cues.slice(before >= 0 ? 0 : 0).filter((c: any) => pic.parts.some((p: any) => p.id === c.target));
  const links = layoutPanel(spec).marks.filter((m: any) => m.type === "partLink") as any[];
  console.log(`\nb${r.sequence + 1} ${spec.heading}: labels read ${boxes.size}/${pic.parts.length}`);
  for (const c of pointer) console.log(`  pointer s${c.s} → "${pic.parts.find((p: any) => p.id === c.target).name}"   ("${sentences[c.s]?.slice(0, 90)}")`);
  for (const l of links) { const note = spec.notes.find((n: any) => l.id.startsWith(`link-${n.id}`)); console.log(`  line   s${l.s} from note "${note?.text}"`); }
  const at = links[0]?.s ?? pointer[0]?.s;
  if (at === undefined) continue;
  const photo = await boardPhoto(spec, { userId: session.userId, topic: session.topic, at: { sentence: at, progress: 0.95, waitMs: Number(process.env.WAIT ?? 6000) } });
  if (photo) writeFileSync(`${out}/${id.slice(0, 8)}-b${r.sequence + 1}-s${at}.png`, photo);
}
process.exit(0);
