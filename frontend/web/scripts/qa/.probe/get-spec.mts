// Prints a saved board's whole spec as JSON (for building fixtures from real boards).
//   node --import tsx scripts/qa/.probe/get-spec.mts <sessionId> <boardIndex>
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${process.argv[2]}`, { headers: { cookie: `aria_access=${token}` } })).json();
const b = snap.beats[Number(process.argv[3])];
console.log(JSON.stringify({ script: b.script, spec: b.draw.ops[0].spec }));
