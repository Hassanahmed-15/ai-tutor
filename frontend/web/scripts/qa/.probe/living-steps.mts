// Steps a board through its sentences in the canvas-lab scrubber and photographs each change mid-way and settled.
//   node --import tsx scripts/qa/.probe/living-steps.mts "<canvas-lab query>" <board> <sentences> <outDir>
import { readFileSync, mkdirSync } from "node:fs";
import { SignJWT } from "jose";
import { chromium } from "playwright";
const [query, board, count, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
await page.addInitScript("window.__name = f => f");
const errs: string[] = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:3000/canvas-lab?${query}&scrub=1&board=${board}&s=0&p=1`, { waitUntil: "load", timeout: 120000 });
await page.waitForSelector("[data-lab-ready]", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/s0.png` });
for (let s = 1; s < Number(count); s++) {
  await page.evaluate((v) => { const r = document.querySelectorAll<HTMLInputElement>('input[type="range"]')[0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(r, String(v)); r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); }, s);
  await page.waitForTimeout(450); await page.screenshot({ path: `${out}/s${s}-mid.png` });
  await page.waitForTimeout(2600); await page.screenshot({ path: `${out}/s${s}.png` });
}
console.log("step", await page.evaluate(() => document.querySelector("[data-living]")?.getAttribute("data-step")), "errors", errs.slice(0, 5));
await browser.close();
