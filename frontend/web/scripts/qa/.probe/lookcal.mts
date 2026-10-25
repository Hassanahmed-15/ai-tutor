// Calibrate the board eyes (lib/canvas/boardLook.ts) on saved lectures — paid (~$0.002 a board).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { boardPhoto, lookAtBoard, LOOK_MODEL } from "../../../lib/canvas/boardLook";
import { client } from "../../../lib/canvas/generate";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [out, ...sessions] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const openai = client();
let cost = 0;
const rows: string[] = [];
for (const id of sessions) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.userId FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources.sort((a: any, b: any) => a.sequence - b.sequence) as any[];
  for (const b of beats) {
    const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
    if (!spec || spec.stage.kind === "exam") continue;
    const photo = await boardPhoto(spec, { userId: s.userId, topic: s.topic });
    if (!photo) { rows.push(`${s.topic.slice(0, 22)} | ${b.sequence} ${b.beat.title.slice(0, 34)} | NO PHOTO`); continue; }
    const name = `${id.slice(0, 6)}-${b.sequence}`;
    writeFileSync(`${out}/${name}.png`, photo);
    const v = await lookAtBoard(openai, photo, { topic: s.topic, title: b.beat.title, script: b.beat.script ?? "" });
    cost += v?.costUsd ?? 0;
    const line = `${s.topic.slice(0, 22).padEnd(22)} | ${String(b.sequence).padStart(2)} ${spec.stage.kind.padEnd(12)} ${b.beat.title.slice(0, 34).padEnd(34)} | ${v ? (v.ok ? "PASS" : "REFUSE " + v.problems.map((p) => `${p.kind}: ${p.detail}`).join(" | ").slice(0, 300)) : "no verdict"}`;
    rows.push(line);
    console.log(line);
  }
}
writeFileSync(`${out}/verdicts.txt`, rows.join("\n"));
console.log(`\n${rows.length} boards, model ${LOOK_MODEL}, $${cost.toFixed(3)}`);
process.exit(0);
