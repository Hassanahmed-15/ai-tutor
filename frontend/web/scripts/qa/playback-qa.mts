/**
 * PLAYBACK QA — what a student sees while a lecture PLAYS, not two still frames per board
 * (scripts/qa/lecture-qa.mts). A saved lecture is played in /canvas-lab?scrub=1&play=1 on a speaking
 * clock (no voice, free) and sampled every 400 ms:
 *   - writing on writing ANYWHERE on screen (every board in view, not only the live one), and lines
 *     through writing on the live board;
 *   - the camera: how often it changes, and whether the marker is in view while it writes;
 *   - the marker's stroke times (window.__markerJobs, kept by MarkerWriter in development).
 * Each new overlap is screenshotted once. Output: ~/aria-qa-images/<date>-playback/<topic>/.
 *
 *   node --import tsx scripts/qa/playback-qa.mts <sessionId> [<sessionId> …]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { chromium, type Page } from "playwright";
import { SignJWT } from "jose";

const BASE = process.env.QA_BASE ?? "http://localhost:3000";
const day = new Date().toISOString().slice(0, 10);
const OUT = `${homedir()}/aria-qa-images/${day}-playback`;
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
// QA_USER: replay a lecture another local account made (its id), read-only; default the QA account.
const subject = process.env.QA_USER ?? "local-dev-canvas";
const token = await new SignJWT({ email: `${subject}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(subject).setIssuedAt().setExpirationTime("3h").sign(new TextEncoder().encode(env.AUTH_SECRET));

type Sample = {
  t: number;
  board: string;
  sentence: string;
  view: string;
  overlaps: Array<{ a: string; b: string; live: boolean }>;
  inkThrough: string[];
  marker: { on: boolean; inView: boolean } | null;
};

/** One sample of the page, measured in screen pixels so every board in view counts. */
async function sample(page: Page, withInk: boolean): Promise<Omit<Sample, "t">> {
  return page.evaluate((withInk) => {
    const svg = document.querySelector("svg[viewBox]") as SVGSVGElement | null;
    const frame = svg?.getBoundingClientRect();
    const select = document.querySelector("select") as HTMLSelectElement | null;
    const board = select ? select.options[select.selectedIndex]?.text ?? "" : "";
    const sentence = (document.querySelector("label")?.textContent ?? "").trim();
    const live = document.querySelector('[data-panel][data-live="true"]');
    const visible = (el: Element) => {
      for (let e: Element | null = el; e && e !== svg; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.15) return false;
        // Still masked, waiting for the marker to write it: not on screen yet.
        if (/inset\([^)]*\b100%/.test((e as HTMLElement).style?.clipPath ?? "")) return false;
      }
      return true;
    };
    const inFrame = (r: DOMRect) => frame && r.right > frame.left && r.left < frame.right && r.bottom > frame.top && r.top < frame.bottom;
    // Seen, not covered: another board's writing under the live board's surface is not on screen.
    const onTop = (el: Element, r: DOMRect) => {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const panel = el.closest("[data-panel]");
      // On top on its own board — not under another board's surface, nor under the page's toolbar.
      return Boolean(top && panel && (panel.contains(top) || top === svg));
    };
    const writings: Array<{ id: string; r: DOMRect; el: Element; live: boolean }> = [];
    svg?.querySelectorAll("text").forEach((t) => {
      if (!t.textContent?.trim() || t.closest("foreignObject") || t.closest("[data-no-marker]") || !visible(t)) return;
      const r = t.getBoundingClientRect();
      if (r.width > 1 && inFrame(r) && onTop(t, r)) writings.push({ id: t.textContent.trim().slice(0, 32), r, el: t, live: Boolean(live?.contains(t)) });
    });
    svg?.querySelectorAll("foreignObject").forEach((f) => {
      if (f.closest("[data-no-marker]") || !visible(f)) return;
      const inner = (f.querySelector("[data-ink-content]") ?? f.querySelector(".katex") ?? f.firstElementChild) as HTMLElement | null;
      if (!inner?.textContent?.trim()) return;
      const r = inner.getBoundingClientRect();
      if (r.width > 1 && inFrame(r) && onTop(f, r)) writings.push({ id: inner.textContent.trim().slice(0, 32), r, el: f, live: Boolean(live?.contains(f)) });
    });
    // The same rule as the checker: boxes shrunk 8%, more than 2 px of overlap each way.
    const shrink = (r: DOMRect, k: number) => ({ x: r.left + r.width * k, y: r.top + r.height * k, w: r.width * (1 - 2 * k), h: r.height * (1 - 2 * k) });
    const overlaps: Array<{ a: string; b: string; live: boolean }> = [];
    for (let i = 0; i < writings.length; i++)
      for (let j = i + 1; j < writings.length; j++) {
        const A = writings[i], B = writings[j];
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        const a = shrink(A.r, 0.08), b = shrink(B.r, 0.08);
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        // Scaled to the text: 2 px on a full-size board.
        const min = Math.max(1.5, Math.min(A.r.height, B.r.height) * 0.08);
        if (ix > min && iy > min) overlaps.push({ a: A.id, b: B.id, live: A.live && B.live });
      }
    const inkThrough: string[] = [];
    if (withInk && live) {
      const strokes = Array.from(live.querySelectorAll("path, line, polyline")) as SVGGeometryElement[];
      const lw = writings.filter((w) => w.live);
      for (const s of strokes) {
        if (!visible(s) || s.closest("foreignObject, [data-no-marker]") || s.matches(".cv-swipe, .cv-tap, .cv-outline, .cv-ring")) continue;
        const cs = getComputedStyle(s);
        if (cs.stroke === "none" || Number(cs.strokeOpacity) * Number(cs.opacity) < 0.4 || parseFloat(cs.strokeWidth) < 1.5) continue;
        // Only the ink already drawn (a stroke the marker has not reached is dashed out).
        if (s.style.strokeDashoffset && parseFloat(s.style.strokeDashoffset) > 1) continue;
        let len = 0;
        try { len = s.getTotalLength(); } catch { continue; }
        if (!len || len > 4000) continue;
        const m = s.getScreenCTM();
        if (!m) continue;
        for (let k = 0; k <= 40; k++) {
          const p = s.getPointAtLength((len * k) / 40);
          const q = new DOMPoint(p.x, p.y).matrixTransform(m);
          const hit = lw.find((w) => !w.el.contains(s) && (() => { const b = shrink(w.r, 0.2); return q.x > b.x && q.x < b.x + b.w && q.y > b.y && q.y < b.y + b.h; })());
          if (hit) { inkThrough.push(hit.id); break; }
        }
      }
    }
    const markerEl = live?.querySelector("[data-marker-tip]") as SVGGElement | null;
    let marker: { on: boolean; inView: boolean } | null = null;
    if (markerEl) {
      const on = Number(getComputedStyle(markerEl).opacity) > 0.5;
      const r = markerEl.getBoundingClientRect();
      marker = { on, inView: Boolean(frame && r.left >= frame.left - 2 && r.right <= frame.right + 2 && r.top >= frame.top - 2 && r.bottom <= frame.bottom + 2) };
    }
    return { board, sentence, view: svg?.getAttribute("viewBox") ?? "", overlaps, inkThrough: [...new Set(inkThrough)], marker };
  }, withInk);
}

const sessions = process.argv.slice(2);
const browser = await chromium.launch();
const summary: unknown[] = [];
for (const session of sessions) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx.addInitScript("window.__name = (f) => f; window.__qaMarker = true;");
  await ctx.addCookies([{ name: "aria_access", value: token, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/canvas-lab?session=${session}&scrub=1&play=1`, { timeout: 90_000 });
  await page.waitForSelector('[data-panel][data-live="true"]', { timeout: 90_000 });
  const firstBoard = await page.evaluate(() => (document.querySelector("select") as HTMLSelectElement | null)?.options[0]?.text ?? "");
  const dir = `${OUT}/${session.slice(0, 8)}-${firstBoard.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 30)}`;
  mkdirSync(dir, { recursive: true });
  const samples: Sample[] = [];
  const shot = new Set<string>();
  let offShots = 0;
  const t0 = Date.now();
  let n = 0;
  for (;;) {
    const done = await page.evaluate(() => Boolean((window as unknown as { __playDone?: boolean }).__playDone));
    if (done || Date.now() - t0 > 12 * 60_000) break;
    const s = { t: (Date.now() - t0) / 1000, ...(await sample(page, n % 3 === 0)) };
    samples.push(s);
    for (const o of s.overlaps) {
      const key = `${o.a}|${o.b}`;
      if (shot.has(key) || shot.size >= 14) continue;
      shot.add(key);
      await page.screenshot({ path: `${dir}/overlap-${shot.size}.png` });
      writeFileSync(`${dir}/overlap-${shot.size}.txt`, `${s.board} · ${s.sentence}\n"${o.a}" × "${o.b}" (live board: ${o.live})\n`);
    }
    // The pen writing where the camera is not looking: seen once or twice, to know why.
    if (s.marker?.on && !s.marker.inView && offShots < 3) await page.screenshot({ path: `${dir}/marker-off-${++offShots}.png` });
    // A look at the screen every 8 s, as the student sees it.
    if (n % 20 === 0) await page.screenshot({ path: `${dir}/frame-${String(n / 20).padStart(3, "0")}.png` });
    n++;
    await page.waitForTimeout(400);
  }
  const skipped = (await page.evaluate(() => (window as unknown as { __markerSkipped?: number[] }).__markerSkipped ?? [])) as number[];
  const markerJobs = (await page.evaluate(() => (window as unknown as { __markerJobs?: Array<{ kind: string; dur: number; len: number }> }).__markerJobs ?? [])) as Array<{ kind: string; dur: number; len: number }>;
  await ctx.close();

  // Camera: a change is a view that moved or zoomed by more than 4% of its width.
  const views = samples.map((s) => s.view.split(/\s+/).map(Number));
  const changes: number[] = [];
  for (let i = 1; i < views.length; i++) {
    const [ax, ay, aw] = views[i - 1], [bx, by, bw] = views[i];
    if (!aw || !bw) continue;
    const moved = Math.hypot(bx - ax, by - ay) / aw > 0.04 || Math.abs(bw / aw - 1) > 0.04;
    const wasMoving = i > 1 && (() => { const [px, py, pw] = views[i - 2]; return Math.hypot(ax - px, ay - py) / pw > 0.04 || Math.abs(aw / pw - 1) > 0.04; })();
    if (moved && !wasMoving) changes.push(samples[i].t);
  }
  const gaps = changes.slice(1).map((t, i) => t - changes[i]);
  const writing = samples.filter((s) => s.marker?.on);
  const offView = writing.filter((s) => !s.marker!.inView);
  const pairs = new Map<string, { n: number; live: boolean; board: string }>();
  for (const s of samples) for (const o of s.overlaps) {
    const k = `"${o.a}" × "${o.b}"`;
    const p = pairs.get(k) ?? { n: 0, live: o.live, board: s.board };
    p.n++;
    pairs.set(k, p);
  }
  const inks = new Map<string, number>();
  for (const s of samples) for (const i of s.inkThrough) inks.set(`${s.board} :: ${i}`, (inks.get(`${s.board} :: ${i}`) ?? 0) + 1);
  // The strokes that teach (a curve, an outline, an arrow) — not a graph's grid or tick marks.
  const traces = (markerJobs as Array<{ kind: string; dur: number; len: number; faint?: boolean }>).filter((j) => j.kind === "trace" && j.len > 120 && !j.faint);
  const speed = traces.length ? traces.reduce((a, j) => a + j.len / j.dur, 0) / traces.length : 0;
  console.log(`\n== ${firstBoard} (${session}) — ${samples.length} samples over ${Math.round(samples.at(-1)?.t ?? 0)} s`);
  console.log(`  overlapping writing: ${pairs.size} pair(s)${pairs.size ? "" : " ✓"}`);
  for (const [k, v] of [...pairs].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) console.log(`    - ${k}  (${v.n} samples, ${v.live ? "on the live board" : "across boards"}; ${v.board})`);
  console.log(`  lines through writing: ${inks.size}${inks.size ? "" : " ✓"}`);
  for (const [k, n2] of [...inks].slice(0, 8)) console.log(`    - ${k} (${n2})`);
  console.log(`  camera: ${changes.length} moves; median gap ${gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)].toFixed(1) : "-"} s; ${gaps.filter((g) => g < 4).length} gaps under 4 s`);
  console.log(`  marker writing off-screen: ${offView.length} of ${writing.length} writing samples`);
  for (const o of offView.slice(0, 6)) console.log(`    - at ${o.t.toFixed(1)} s: ${o.board} · ${o.sentence}`);
  console.log(`  drawn by CSS, not the marker (too many at once): ${skipped.length} piece(s)${skipped.length ? ` — ${skipped.map((n) => (n < 0 ? `board start ${-n}` : n)).join(", ")} elements` : " ✓"}`);
  console.log(`  strokes: ${traces.length} long traces, mean speed ${speed.toFixed(2)} units/ms (${Math.round(speed * 1000)} units/s)`);
  const sp = traces.map((j) => Math.round((j.len / j.dur) * 1000)).sort((a, b) => a - b);
  if (sp.length) console.log(`    speeds (units/s): min ${sp[0]}, median ${sp[Math.floor(sp.length / 2)]}, 90% ${sp[Math.floor(sp.length * 0.9)]}, max ${sp.at(-1)}; ${(markerJobs as Array<{ faint?: boolean; kind: string }>).filter((j) => j.kind === "trace" && j.faint).length} faint strokes drawn quickly`);
  summary.push({ session, firstBoard, samples: samples.length, overlaps: [...pairs], inks: [...inks], cameraMoves: changes.length, gapsUnder4s: gaps.filter((g) => g < 4).length, markerOff: offView.length, markerWriting: writing.length, traceSpeed: speed });
}
writeFileSync(`${OUT}/report-${Date.now()}.json`, JSON.stringify(summary, null, 1));
await browser.close();
