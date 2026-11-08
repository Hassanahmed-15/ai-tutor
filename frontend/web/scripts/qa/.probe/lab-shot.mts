import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { chromium } from "playwright";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const token = await new SignJWT({ email: "local-dev-canvas@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("3h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const session = process.argv[2];
const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${session}`, { headers: { cookie: `aria_access=${token}` } })).json();
for (const b of snap.beats ?? []) { const sp = b?.draw?.ops?.[0]?.spec; console.log(b?.id, sp?.stage?.kind, sp?.lab?.kind ?? "no lab", sp?.lab?.kind === "pencil" ? JSON.stringify(sp.lab.scene).length + " chars" : ""); }
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
await page.addInitScript("window.__name = f => f");
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const out = process.env.HOME + "/aria-qa-images/2026-11-08-pythagoras-lab";
const shots: Array<[number, number, string]> = JSON.parse(process.argv[3]);
for (const [board, s, name] of shots) {
  await page.goto(`http://localhost:3000/canvas-lab?session=${session}&scrub=1&board=${board}&s=${s}&p=1`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector("[data-lab-ready], [data-lab-error]", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(s >= 99 ? 12000 : 8000);
  const st = await page.evaluate(() => [...document.querySelectorAll("[data-lab]")].map((e) => ({ kind: (e as HTMLElement).dataset.lab, ready: e.hasAttribute("data-lab-ready"), error: (e as HTMLElement).dataset.labError ?? null })));
  console.log(name, JSON.stringify(st));
  await page.screenshot({ path: `${out}/${name}.png` });
}
console.log("errors:", [...new Set(errors)].slice(0, 8));
await browser.close();
