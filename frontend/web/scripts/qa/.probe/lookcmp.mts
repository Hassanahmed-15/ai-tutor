// The same photos judged again (effort/model from env) — paid, a few boards.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { lookAtBoard, LOOK_MODEL } from "../../../lib/canvas/boardLook";
import { client } from "../../../lib/canvas/generate";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const dir = process.argv[2];
let cost = 0;
for (const pair of process.argv.slice(3)) {
  const [id, seq, expect] = pair.split(":");
  const r = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.beat FROM c WHERE STARTSWITH(c.sessionId, @id) AND c.sequence = @s", parameters: [{ name: "@id", value: id }, { name: "@s", value: Number(seq) }] }).fetchAll()).resources[0] as any;
  const png = readFileSync(`${dir}/${id}-${seq}.png`);
  const v = await lookAtBoard(client(), png, { topic: r.beat.title, title: r.beat.title, script: r.beat.script ?? "" });
  cost += v?.costUsd ?? 0;
  const got = v ? (v.ok ? "pass" : "refuse") : "none";
  console.log(`${got === expect ? "  OK " : "MISS "} expect ${expect.padEnd(6)} got ${got.padEnd(6)} | ${r.beat.title.slice(0, 36).padEnd(36)} | ${v && !v.ok ? v.problems.map((p) => `${p.kind}: ${p.detail}`).join(" | ").slice(0, 200) : ""}`);
}
console.log(`model ${LOOK_MODEL} effort ${process.env.CANVAS_BOARD_LOOK_EFFORT ?? "low"} $${cost.toFixed(3)}`);
process.exit(0);
