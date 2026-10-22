import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { figureDataIssues } from "../../../lib/canvas/releaseAudit";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
let n = 0;
for (const session of process.argv.slice(2)) {
  const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${session}`, { headers: { cookie: `aria_access=${token}` } })).json();
  for (const beat of snap.beats ?? []) {
    const spec = beat?.draw?.ops.find((o: { kind: string }) => o.kind === "canvasBoard")?.spec;
    if (spec?.stage.kind !== "figure") continue;
    n++;
    const issues = figureDataIssues(spec, beat.script);
    console.log(`${issues.length ? "✗" : "✓"} ${snap.topic} / ${beat.title} (${spec.stage.component})${issues.length ? ": " + issues[0].slice(0, 120) : ""}`);
  }
}
console.log("figure boards:", n);
