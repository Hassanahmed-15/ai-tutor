// MATHS PICTURE PREVIEW (paid: ≈ $0.05 a picture): gpt-image-2 draws the white-on-black maths figure for
// saved boards from their real context, and each is photographed beside the board as it shipped.
//   node --conditions=react-server --import tsx scripts/qa/maths-picture-preview.mts <session> <board,board,…> [outDir] [--cap 0.40]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { createOpenAI } = await import("../../lib/openaiClient");
const { mathsPicture, withMathsPicture } = await import("../../lib/canvas/mathsPicture");
const { asMathsPicture, mathsBoardContext, withMathsBoardWriting } = await import("../../lib/canvas/mathsPicturePrompt");
const { boardPhoto } = await import("../../lib/canvas/boardLook");

const [sessionPrefix, list, outArg] = process.argv.slice(2);
const capAt = process.argv.indexOf("--cap");
const cap = capAt > 0 ? Number(process.argv[capAt + 1]) : 0.4;
const out = outArg && !outArg.startsWith("--") ? outArg : `${os.homedir()}/aria-qa-images/maths-pictures`;
mkdirSync(out, { recursive: true });
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, c.topic, c.userId, c.plan FROM c WHERE STARTSWITH(c.id, @id)", parameters: [{ name: "@id", value: sessionPrefix }] }).fetchAll()).resources[0] as any;
const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll()).resources as any[];
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
let spent = 0;
for (const n of list.split(",").map(Number)) {
  if (spent >= cap) { console.log(`stopped at $${spent.toFixed(3)} (cap $${cap})`); break; }
  const beat = (s.plan[n - 1].canvas ?? s.plan[n - 1]);
  const shipped = beats.find((b) => b.sequence === n - 1)?.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  if (!shipped) { console.log(`b${n}: no saved board`); continue; }
  // The board as it shipped (free), for comparison.
  const before = await boardPhoto(shipped, { userId: s.userId, topic: s.topic });
  if (before) writeFileSync(`${out}/b${n}-before.png`, before);
  // The second drawing: the board written for a picture keeps its heading and notes.
  const switched = asMathsPicture({ objects: [], carry: [], inside: null, ...beat, stage: beat.stage === "equation" ? "equation" : "figure" });
  const ctx = withMathsBoardWriting(mathsBoardContext(s.topic, switched), shipped);
  let display: Buffer | null = null;
  const started = Date.now();
  try {
    const pic = await mathsPicture(openai, ctx, { share: false, asDrawn: true, budget: { left: () => 300_000 }, save: async (_key, d) => { display = d; } });
    spent += pic.costUsd;
    if (!display) display = pic.display;
    writeFileSync(`${out}/b${n}-picture.jpg`, pic.display);
    const src = `data:image/jpeg;base64,${pic.display.toString("base64")}`;
    const board = { v: 1, heading: shipped.heading, notes: shipped.notes ?? [], stage: { kind: "illustration", subject: pic.fields.diagramType, parts: [], labels: [] }, cues: [] } as any;
    const after = await boardPhoto(withMathsPicture(board, pic, src), { userId: s.userId, topic: s.topic });
    if (after) writeFileSync(`${out}/b${n}-after.png`, after);
    console.log(`b${n} "${beat.title}": ${Math.round((Date.now() - started) / 1000)}s $${pic.costUsd.toFixed(3)} — ${pic.fields.diagramType} | labels: ${pic.fields.labels.map((l: any) => l.text).join(", ")} | ${pic.log}`);
  } catch (error) {
    spent += (error as { costUsd?: number }).costUsd ?? 0;
    console.log(`b${n} "${beat.title}": failed — ${(error as Error).message}`);
  }
}
console.log(`\nspent $${spent.toFixed(3)}; pictures in ${out}`);
process.exit(0);
