// Does the pen stop when the lecture is paused? (free) — the marker tip's place 1 s and 4 s after opening a
// board mid-sentence, playing and paused.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [session, board, sentence] = process.argv.slice(2);
const sub = process.env.QA_USER ?? "local-dev-canvas";
const token = await new SignJWT({ email: `${sub}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const b = await chromium.launch();
for (const pause of [0, 1, 2]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3000/canvas-lab?session=${session}&scrub=1&board=${board}&s=${sentence}&p=0.2&pause=${pause === 1 ? 1 : 0}`, { timeout: 120000 });
  await p.waitForSelector("[data-panel][data-live='true']", { timeout: 60000 });
  const tip = () => p.evaluate(() => { const m = document.querySelector('[data-panel][data-live="true"] [data-marker-tip]') as SVGGElement | null; return m ? `${m.getAttribute("transform")} op=${getComputedStyle(m).opacity}` : "none"; });
  const ink = () => p.evaluate(() => [...document.querySelectorAll('[data-panel][data-live="true"] *')].filter((e) => (e as SVGElement).style?.strokeDashoffset && (e as SVGElement).style.strokeDashoffset !== "0px" && (e as SVGElement).style.strokeDashoffset !== "0").length);
  await p.waitForTimeout(2500);
  // 2: pressed pause while the pen is writing.
  if (pause === 2) await p.evaluate(() => (window as unknown as { __setPaused: (v: boolean) => void }).__setPaused(true));
  await p.waitForTimeout(300);
  const a = await tip(), ia = await ink();
  await p.waitForTimeout(3000);
  const c = await tip(), ic = await ink();
  if (pause === 2) { await p.evaluate(() => (window as unknown as { __setPaused: (v: boolean) => void }).__setPaused(false)); await p.waitForTimeout(2500); console.log(`  after resume: ${await tip()}`); }
  console.log(`${pause === 2 ? "PAUSED MID-STROKE" : pause ? "PAUSED " : "PLAYING"}  pen at 2.5 s: ${a}  |  at 5.5 s: ${c}  ${a === c ? "(still)" : "(moved)"}  unfinished strokes ${ia} → ${ic}`);
  await ctx.close();
}
await b.close();
