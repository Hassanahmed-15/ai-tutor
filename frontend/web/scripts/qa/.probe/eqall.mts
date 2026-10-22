import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { equationProblem } from "../../../lib/canvas/equationCheck";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
let n = 0;
for (const session of process.argv.slice(2)) {
  const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${session}`, { headers: { cookie: `aria_access=${token}` } })).json();
  
  for (const beat of snap.beats ?? []) {
    const st = beat?.draw?.ops.find((o: { kind: string }) => o.kind === "canvasBoard")?.spec?.stage;
    if (st?.kind !== "equation") continue;
    n++;
    const p = equationProblem(st, st, beat.script);
    if (p) console.log(`${snap.topic} / ${beat.title}: ${p.slice(0, 160)}`);
  }
}
console.log("equation boards checked:", n);
