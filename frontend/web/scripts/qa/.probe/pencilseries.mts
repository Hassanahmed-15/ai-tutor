// Frames of a board being written, caught at several moments (free): node --import tsx scripts/qa/.probe/pencilseries.mts <session> <board0> <sentence> <outPrefix>
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [session, board, sentence, prefix] = process.argv.slice(2);
const token = await new SignJWT({ email: "local-dev-canvas@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript("window.__name = (f) => f;");
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
await p.goto(`http://localhost:3000/canvas-lab?session=${session}&scrub=1&board=${board}&s=${sentence}&p=0.05`, { timeout: 120000 });
await p.waitForSelector("[data-panel][data-live='true']", { timeout: 60000 });
const t0 = Date.now();
for (const at of [2500, 4000, 5500, 7000, 9000]) {
  await p.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
  const tip = await p.evaluate(() => { const m = document.querySelector('[data-panel][data-live="true"] [data-marker-tip]') as SVGGElement | null; return m ? getComputedStyle(m).opacity : "none"; });
  await p.screenshot({ path: `${prefix}-${at}.png` });
  console.log(`${at} ms: pencil opacity ${tip}`);
}
await b.close();
process.exit(0);
