// A board caught mid-sentence in the canvas lab, the pencil writing (free):
//   node --import tsx scripts/qa/.probe/pencilshot.mts <session> <board> <sentence> <out.png> [waitMs]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [session, board, sentence, out, wait] = process.argv.slice(2);
const sub = process.env.QA_USER ?? "local-dev-canvas";
const token = await new SignJWT({ email: `${sub}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript("window.__name = (f) => f;");
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
await p.goto(`http://localhost:3000/canvas-lab?session=${session}&scrub=1&board=${board}&s=${sentence}&p=0.05`, { timeout: 120000 });
await p.waitForSelector("[data-panel][data-live='true']", { timeout: 60000 });
await p.waitForTimeout(Number(wait ?? 1400));
const tip = await p.evaluate(() => Boolean(document.querySelector('[data-panel][data-live="true"] [data-marker-tip]')));
await p.screenshot({ path: out });
console.log(`pencil on the board: ${tip}`);
await b.close();
process.exit(0);
