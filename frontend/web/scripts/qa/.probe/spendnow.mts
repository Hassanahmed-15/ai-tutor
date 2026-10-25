// Today's AI spend from the local spend log (free): node --import tsx scripts/qa/.probe/spendnow.mts [baseline]
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "local-dev-canvas@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const r = await (await fetch("http://localhost:3000/api/spend?day=today", { headers: { cookie: `aria_access=${token}` } })).json();
const total = Object.values(r.day.byModel as Record<string, any>).reduce((a: number, v: any) => a + (typeof v === "number" ? v : v.usd ?? v.totalUsd ?? 0), 0);
const base = Number(process.argv[2] ?? NaN);
console.log(Number.isFinite(base) ? `total ${total.toFixed(4)}  since baseline ${(total - base).toFixed(4)}` : `total ${total.toFixed(4)}`);
process.exit(0);
