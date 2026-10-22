import { chromium } from "playwright";
const [fixture, board, out] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript("window.__name = (f) => f;");
const p = await ctx.newPage();
await p.goto(`http://localhost:3000/canvas-lab?fixture=${fixture}&scrub=1&board=${board}&done=1`, { timeout: 120000 });
await p.waitForTimeout(3000);
for (let idle = 0, t = 0; idle < 1500 && t < 60000; t += 250) {
  const on = await p.evaluate(() => { const m = document.querySelector('[data-panel][data-live="true"] [data-marker-tip]'); return m ? Number(getComputedStyle(m).opacity) > 0.1 : false; });
  idle = on ? 0 : idle + 250;
  await p.waitForTimeout(250);
}
await p.waitForTimeout(800);
await p.screenshot({ path: out });
await b.close();
console.log("saved", out);
