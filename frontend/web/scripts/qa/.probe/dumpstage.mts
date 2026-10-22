import { readFileSync, writeFileSync } from "node:fs";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const [session, board, out] = process.argv.slice(2);
const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${session}`, { headers: { cookie: `aria_access=${token}` } })).json();
const beat = snap.beats[Number(board)];
writeFileSync(out, JSON.stringify(beat, null, 1));
console.log("wrote", out);
