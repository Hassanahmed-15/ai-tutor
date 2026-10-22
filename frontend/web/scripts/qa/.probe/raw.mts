import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
for (const id of process.argv.slice(2)) {
  const r = await fetch(`http://localhost:3000/api/progressive-lectures/${id}`, { headers: { cookie: `aria_access=${token}` } }).catch((e) => e);
  if (r instanceof Error) { console.log(id.slice(0, 8), "fetch error", r.message); continue; }
  const text = await r.text();
  try { const j = JSON.parse(text); console.log(id.slice(0, 8), r.status, j.status ?? Object.keys(j).slice(0, 8).join(","), (j.beats ?? []).filter(Boolean).length, j.topic ?? ""); } catch { console.log(id.slice(0, 8), r.status, text.slice(0, 120)); }
}
