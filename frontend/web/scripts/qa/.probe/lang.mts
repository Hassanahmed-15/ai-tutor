import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { languageIssues } from "../../../lib/canvas/releaseAudit";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${process.argv[2]}`, { headers: { cookie: `aria_access=${token}` } })).json();
for (const beat of snap.beats) { const spec = beat.draw.ops.find((o: { kind: string }) => o.kind === "canvasBoard").spec; console.log(spec.heading, "→", JSON.stringify(languageIssues(spec, beat.script))); }
