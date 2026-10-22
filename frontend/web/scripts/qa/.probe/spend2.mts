import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "local-dev-canvas@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const r = await (await fetch("http://localhost:3000/api/spend?day=today", { headers: { cookie: `aria_access=${token}` } })).json();
console.log(JSON.stringify({ total: r.day.totalUsd, calls: r.day.calls, byKind: r.day.byKind, byModel: r.day.byModel }, null, 1).slice(0, 3000));
