import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const sub = process.env.QA_USER ?? "local-dev-canvas";
const token = await new SignJWT({ email: `${sub}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const [session, board, sentence, out] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript("window.__name = (f) => f;");
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
await p.goto(`http://localhost:3000/canvas-lab?session=${session}&scrub=1&board=${board}&s=${sentence}&p=0.9`, { timeout: 90000 });
await p.waitForTimeout(3000);
// Until the marker has been idle 1.5 s (it draws at a teacher's pace now).
for (let idle = 0, t = 0; idle < 1500 && t < 90000; t += 250) {
  const on = await p.evaluate(() => { const m = document.querySelector('[data-panel][data-live="true"] [data-marker-tip]'); return m ? Number(getComputedStyle(m).opacity) > 0.1 : false; });
  idle = on ? 0 : idle + 250;
  await p.waitForTimeout(250);
}
await p.waitForTimeout(800);
await p.screenshot({ path: out });
await b.close();
console.log("saved", out);
