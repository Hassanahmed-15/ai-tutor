import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { createOpenAI } from "../../../lib/openaiClient";
import { mathsCheck } from "../../../lib/canvas/mathsCheck";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
let total = 0;
for (const pair of process.argv.slice(2)) {
  const [id, idx] = pair.split(":");
  const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${id}`, { headers: { cookie: `aria_access=${token}` } })).json();
  const b = snap.beats[Number(idx)];
  const spec = b.draw.ops.find((o: { kind: string }) => o.kind === "canvasBoard").spec;
  const v = await mathsCheck(openai, snap.topic, spec, { title: b.title, script: b.script }, 120_000);
  total += v.costUsd;
  console.log(`== ${snap.topic} board ${Number(idx) + 1}: ${v.checked ? "checked" : "NOT CHECKED"} in ${(v.ms / 1000).toFixed(1)}s, $${v.costUsd.toFixed(4)}, ship=${v.ship}`);
  for (const p of v.problems) console.log(`   - ${p.where}/${p.kind}${p.sentence !== undefined ? ` (s${p.sentence})` : ""}: ${p.detail} → ${p.fix}`);
}
console.log(`total $${total.toFixed(4)}`);
