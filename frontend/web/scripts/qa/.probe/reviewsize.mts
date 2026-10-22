import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { BOARD_REVIEW_PROMPT, boardReviewRequest } from "../../../lib/canvas/boardReview";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const sizes: number[] = [];
let boards = 0;
for (const id of process.argv.slice(2)) {
  const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${id}`, { headers: { cookie: `aria_access=${token}` } })).json();
  for (const b of snap.beats ?? []) {
    const spec = b?.draw?.ops?.find((o: { kind: string }) => o.kind === "canvasBoard")?.spec;
    if (!spec) continue;
    boards++;
    sizes.push(boardReviewRequest(spec, b, snap.topic).length);
  }
}
const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
console.log(JSON.stringify({ lectures: process.argv.length - 2, boards, promptChars: BOARD_REVIEW_PROMPT.length, avgRequestChars: Math.round(avg), maxRequestChars: Math.max(...sizes) }));
