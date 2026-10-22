import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync("/Users/hassanahmed/ai-tutor/frontend/web/.env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const [session, board] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript("window.__name = (f) => f; window.__qaMarker = true;");
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
await p.goto(`http://localhost:3000/canvas-lab?session=${session}&scrub=1&play=1&board=${board}`, { timeout: 90000 });
for (let i = 0; i < 400; i++) {
  const r = await p.evaluate(() => {
    const svg = document.querySelector("svg[viewBox]")!;
    const f = svg.getBoundingClientRect();
    const m = document.querySelector('[data-panel][data-live="true"] [data-marker-tip]') as SVGGElement | null;
    if (!m || Number(getComputedStyle(m).opacity) < 0.5) return null;
    const r = m.getBoundingClientRect();
    const inView = r.left >= f.left - 2 && r.right <= f.right + 2 && r.top >= f.top - 2 && r.bottom <= f.bottom + 2;
    if (inView) return null;
    const cur = (window as unknown as { __markerCurrent?: { el: SVGGraphicsElement; wait: number; startBox: unknown; batch: number } }).__markerCurrent;
    const el = cur?.el;
    const er = el?.getBoundingClientRect();
    const job = el ? { tag: el.tagName, cls: el.getAttribute("class"), text: el.textContent?.slice(0, 40), d: el.getAttribute("d")?.slice(0, 60), rect: er ? [er.left, er.top, er.width, er.height].map(Math.round) : null, parentStyle: (el.parentElement as HTMLElement | null)?.getAttribute("style")?.slice(0, 120), dash: el.style.strokeDasharray, clip: el.style.clipPath, wait: cur!.wait, startBox: cur!.startBox, batch: cur!.batch, kind: el.closest("[data-kind]")?.getAttribute("data-kind"), html: el.outerHTML.slice(0, 200) } : null;
    const log = { errors: ((window as unknown as { __markerErrors?: string[] }).__markerErrors ?? []).slice(-3), dir: ((window as unknown as { __dirLog?: unknown[] }).__dirLog ?? []).slice(-2) };
    const director = { log, d: (window as unknown as { __director?: unknown }).__director, c: (window as unknown as { __camera?: unknown }).__camera };
    return { director, job, frame: [f.left, f.top, f.right, f.bottom].map(Math.round), marker: [r.left, r.top, r.right, r.bottom].map(Math.round), transform: m.getAttribute("transform"), view: svg.getAttribute("viewBox"), sentence: document.querySelector("label")?.textContent };
  });
  if (r) { console.log(JSON.stringify(r)); await p.screenshot({ path: "/Users/hassanahmed/aria-qa-images/penoff.png" }); break; }
  await p.waitForTimeout(150);
}
await b.close();
