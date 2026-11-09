/**
 * MATHS DIAGRAM AUDIT (free): every board of saved lectures, finished, as the student sees it. In the browser it
 * measures writing on writing, lines through writing and anything outside the drawing, and saves a shot of each.
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/qa/maths-audit.mts <outDir> <userId:session> …
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { signAccessToken } from "../../lib/auth";
const [out, ...items] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report: Array<Record<string, unknown>> = [];
type Issue = { type: string; a: string; b?: string; pct?: number };
for (const item of items) {
  const [userId, session] = item.split(":");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "aria_access", value: await signAccessToken(userId, "qa@example.com"), domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.addInitScript("window.__name = f => f");
  await page.goto(`http://localhost:3000/canvas-lab?session=${session}&scrub=1&board=0&done=1`, { timeout: 180000 });
  await page.waitForSelector("select", { timeout: 120000 });
  await page.waitForTimeout(3000);
  const options = await page.locator("select").first().locator("option").allTextContents();
  for (let b = 0; b < options.length; b++) {
    await page.locator("select").first().selectOption(String(b));
    await page.waitForTimeout(500);
    // Choosing a board goes back to its first sentence: the audit looks at it finished.
    await page.locator('input[type="checkbox"]').first().check({ force: true });
    await page.waitForTimeout(1200);
    await page.waitForFunction(() => { const l = document.querySelector('g[data-live="true"] [data-lab]'); return !l || l.hasAttribute("data-lab-ready") || l.hasAttribute("data-lab-error"); }, undefined, { timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(2600);
    const result = await page.evaluate(() => {
      const issues: Array<{ type: string; a: string; b?: string; pct?: number }> = [];
      const root = document.querySelector('g[data-live="true"]');
      if (!root) return { kind: "no board", issues };
      const lab = root.querySelector<HTMLElement>("[data-lab]");
      if (lab?.getAttribute("data-lab-error")) issues.push({ type: "failed", a: lab.getAttribute("data-lab-error")! });
      const kind = lab?.getAttribute("data-lab") ?? "other";
      if (!lab) return { kind, issues };
      const box = lab.getBoundingClientRect();
      const rects = [...lab.querySelectorAll<HTMLElement>(".JXGtext, text")].filter((e) => e.textContent?.trim() && getComputedStyle(e).visibility !== "hidden" && e.getBoundingClientRect().width > 1).map((e) => ({ t: e.textContent!.trim().slice(0, 30), r: e.getBoundingClientRect() }));
      for (let i = 0; i < rects.length; i++) {
        const a = rects[i].r;
        if (a.left < box.left - 1 || a.right > box.right + 1 || a.top < box.top - 1 || a.bottom > box.bottom + 1) issues.push({ type: "cut off", a: rects[i].t });
        for (let j = i + 1; j < rects.length; j++) {
          const c = rects[j].r;
          const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
          if (w > 1 && h > 1) { const pct = Math.round((100 * w * h) / Math.min(a.width * a.height, c.width * c.height)); if (pct >= 12) issues.push({ type: "text on text", a: rects[i].t, b: rects[j].t, pct }); }
        }
      }
      const lines = [...lab.querySelectorAll<SVGGeometryElement>("svg line, svg path, svg polyline")].filter((e) => { const cs = getComputedStyle(e); return cs.visibility !== "hidden" && cs.stroke !== "none" && Number(cs.strokeOpacity) > 0.25 && Number(cs.opacity) > 0.25; });
      for (const { t, r } of rects) {
        let hits = 0, seen = 0;
        const inner = { l: r.left + r.width * 0.12, r: r.right - r.width * 0.12, t: r.top + r.height * 0.2, b: r.bottom - r.height * 0.2 };
        for (const line of lines) {
          let length = 0;
          try { length = line.getTotalLength(); } catch { continue; }
          if (length < 2) continue;
          const m = line.getScreenCTM();
          if (!m) continue;
          for (let k = 0; k <= Math.min(160, length / 2); k++) {
            const p = line.getPointAtLength((length * k) / Math.max(1, Math.min(160, length / 2)));
            const x = p.x * m.a + p.y * m.c + m.e, y = p.x * m.b + p.y * m.d + m.f;
            seen++;
            if (x > inner.l && x < inner.r && y > inner.t && y < inner.b) { hits++; break; }
          }
        }
        if (hits) issues.push({ type: "line through text", a: t, pct: hits });
      }
      return { kind, labels: rects.length, issues };
    });
    const name = `${session.slice(0, 8)}-${String(b + 1).padStart(2, "0")}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    report.push({ session, board: b + 1, title: options[b], ...result });
    const issues = (result.issues ?? []) as Issue[];
    console.log(`${name} ${String(result.kind).padEnd(7)} ${options[b].slice(0, 46).padEnd(46)} ${issues.length ? issues.map((i) => `${i.type}: ${i.a}${i.b ? ` / ${i.b}` : ""}`).slice(0, 6).join(" | ") : "ok"}`);
  }
  await ctx.close();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
