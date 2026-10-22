import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
let total = 0;
for (const id of process.argv.slice(2)) {
  const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${id}`, { headers: { cookie: `aria_access=${token}` } })).json();
  total += snap.costUsd ?? 0;
  console.log(id.slice(0, 8), (snap.costUsd ?? 0).toFixed(4), snap.topic);
}
console.log("total", total.toFixed(4));
