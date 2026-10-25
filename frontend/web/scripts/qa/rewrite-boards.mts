/**
 * REWRITE A SAVED LESSON'S PICTURE BOARDS through the real board writer (lib/canvas/progressive.ts
 * writeCanvasBoard), with the lesson's own plan and syllabus document, and save them back over the old
 * boards — for a test lesson whose pictures were lost to a bug (course benchmark, 2026-10-24). Paid: the
 * board writer and the board's picture, as when the lesson was made.
 *
 *   node --conditions=react-server --import tsx scripts/qa/rewrite-boards.mts <sessionId> [boardNumbers comma-separated]
 *   (no board numbers: every picture board)
 */
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { writeCanvasBoard } = await import("../../lib/canvas/progressive");
const { curriculumDocumentOf } = await import("../../lib/canvas/lessonRequest");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const blob = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
const [sessionId, only] = process.argv.slice(2);

const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT * FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: sessionId }] }).fetchAll()).resources[0] as any;
const input = JSON.parse((await blob.getContainerClient(env.AZURE_STORAGE_CONTAINER || env.AZURE_STORAGE_CONTAINER_NAME || "lectures").getBlobClient(s.inputBlobName).downloadToBuffer()).toString("utf8"));
const beatsC = db.container("progressive-lecture-beats");
const saved = (await beatsC.items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: sessionId }] }).fetchAll()).resources as any[];
const wanted = only ? only.split(",").map((n) => Number(n) - 1) : saved.filter((b) => b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec?.stage?.kind === "illustration").map((b) => b.sequence);
let total = 0;
for (const index of wanted) {
  const t0 = Date.now();
  // As the worker does (lib/progressiveLectureWorker.ts): the plan's canvas boards, and the course lesson's document.
  const plan = s.plan.map((p: any) => p.canvas).filter(Boolean);
  const made = await writeCanvasBoard({ userId: s.userId, sessionId, topic: s.topic, plan, index, earlier: [], notes: s.adaptationNotes ?? [], document: curriculumDocumentOf(input) });
  total += made.costUsd;
  const doc = saved.find((b) => b.sequence === index);
  if (doc) await beatsC.items.upsert({ ...doc, beat: made.beat });
  const st = (made.beat.draw?.ops?.find((o: any) => o.kind === "canvasBoard") as any)?.spec?.stage;
  console.log(`board ${index + 1} "${made.beat.title}": ${st?.kind}${st?.coursePicture ? " (gpt-image-2)" : ""} in ${Math.round((Date.now() - t0) / 1000)} s, $${made.costUsd.toFixed(3)}${made.fallback ? " FALLBACK" : ""}\n  ${made.log.filter((l: string) => /picture|look|illustration/i.test(l)).join("\n  ").slice(0, 600)}`);
}
console.log(`rewrote ${wanted.length} board(s), $${total.toFixed(3)}`);
process.exit(0);
