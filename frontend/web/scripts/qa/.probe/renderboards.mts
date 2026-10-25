// Every board of saved lectures, rendered as the student sees it when finished (free: no AI).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { boardPhoto } from "../../../lib/canvas/boardLook";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const [out, ...sessions] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let html = `<!doctype html><meta charset="utf-8"><title>Lesson boards</title><style>body{font:15px system-ui;margin:0;padding:20px;background:#111;color:#eee}img{width:100%;max-width:1100px;border-radius:8px;display:block;margin:6px 0 4px}p{max-width:1100px;opacity:.8}</style>`;
for (const id of sessions) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.userId FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  const beats = ((await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources as any[]).sort((a, b) => a.sequence - b.sequence);
  html += `<h2>${s.topic}</h2>`;
  for (const b of beats) {
    const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
    if (!spec) continue;
    const photo = await boardPhoto(spec, { userId: s.userId, topic: s.topic });
    const name = `${id.slice(0, 8)}-${b.sequence + 1}.png`;
    if (photo) writeFileSync(`${out}/${name}`, photo);
    console.log(`${name} ${spec.stage.kind}${spec.stage.component ? ` (${spec.stage.component})` : ""}${spec.stage.coursePicture ? " gpt-image-2" : ""} — ${b.beat.title}${photo ? "" : " (NO PHOTO)"}`);
    html += `<h3>${b.sequence + 1}. ${b.beat.title} <small>(${spec.stage.kind}${spec.stage.coursePicture ? ", gpt-image-2 picture" : ""})</small></h3>${photo ? `<img src="${name}">` : "<p>could not render</p>"}<p>${b.beat.script}</p>`;
  }
}
writeFileSync(`${out}/index.html`, html);
console.log(`${out}/index.html`);
process.exit(0);
