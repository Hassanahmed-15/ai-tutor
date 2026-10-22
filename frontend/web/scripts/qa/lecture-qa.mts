/**
 * LECTURE QA — the automatic checker for maths and computer-science lectures (2026-10-20).
 *
 * For each topic it generates a REAL lecture through the running app (POST /api/progressive-lectures,
 * as the local test user), then checks every board two ways:
 *   1. its data: does every sentence change the board, are the numbers right, do graph points lie on
 *      their curves, how many camera zooms and how big, which renderer drew it;
 *   2. its pixels: it opens the board in the dev canvas lab (finished, and halfway through), measures
 *      writing overlapping writing, lines through writing and anything outside the board, and saves a
 *      screenshot of each.
 *
 *   node --import tsx scripts/qa/lecture-qa.mts "Topic one" "Topic two" …     (paid: ~$0.02–0.04 per lecture)
 *   node --import tsx scripts/qa/lecture-qa.mts --session <id> [--session <id>] (re-check, free)
 *
 * Needs the dev server on :3000 and AUTH_SECRET in .env.local. Writes report.json and screenshots to
 * ~/aria-qa-images/<date>-lecture-qa/.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { SignJWT } from "jose";
import { chromium, type Page } from "playwright";
import { layoutPanel } from "../../lib/canvas/layout";
import { canvasSentences } from "../../lib/canvas/plan";
import { auditBoardForRelease } from "../../lib/canvas/releaseAudit";
import { labelTexts } from "../../lib/canvas/studentCritic";
import { checkNumbers } from "../../lib/canvas/numberCheck";
import { equationProblem } from "../../lib/canvas/equationCheck";
import { narratedStructureMismatch } from "../../lib/canvas/structure";
import type { CanvasBoardSpec } from "../../lib/canvas/types";

const BASE = process.env.QA_BASE ?? "http://localhost:3000";
const day = new Date().toISOString().slice(0, 10);
const OUT = `${homedir()}/aria-qa-images/${day}-lecture-qa`;
mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "local-dev-canvas@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("3h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const headers = { "content-type": "application/json", cookie: `aria_access=${token}` };

type Snapshot = { topic: string; status: string; costUsd?: number; beats: Array<{ id: string; title: string; script: string; draw?: { ops: Array<{ kind: string; spec?: CanvasBoardSpec }> } } | null> };

async function generate(topic: string): Promise<{ session: string; snap: Snapshot; seconds: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/progressive-lectures`, { method: "POST", headers, body: JSON.stringify({ topic, learner: { claimedLevel: 3 } }) });
  const start = (await res.json()) as { sessionId?: string; error?: string };
  if (!start.sessionId) throw new Error(`could not start "${topic}": ${start.error ?? res.status}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 6000));
    const snap = (await (await fetch(`${BASE}/api/progressive-lectures/${start.sessionId}`, { headers })).json()) as Snapshot;
    if (["complete", "completed", "failed", "error"].includes(snap.status) || Date.now() - t0 > 600_000) return { session: start.sessionId, snap, seconds: Math.round((Date.now() - t0) / 1000) };
  }
}

async function load(session: string): Promise<Snapshot> {
  return (await (await fetch(`${BASE}/api/progressive-lectures/${session}`, { headers })).json()) as Snapshot;
}

/** Sentences of the board that change nothing on it (from the board's data). */
function stillSentences(spec: CanvasBoardSpec, sentences: number): number[] {
  const at = new Set<number>();
  const walk = (v: unknown, key = "") => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
    if (!v || typeof v !== "object") return;
    const r = v as Record<string, unknown>;
    if (typeof r.s === "number") at.add(r.s);
    if (typeof r.hide === "number") at.add(r.hide);
    for (const [k, x] of Object.entries(r)) if (x && typeof x === "object") walk(x, k);
  };
  walk(spec.notes);
  walk(spec.stage);
  walk(spec.cues);
  return Array.from({ length: sentences }, (_, i) => i).filter((i) => !at.has(i));
}

type PixelIssue = { kind: "overlap" | "ink-through-text" | "off-board" | "capture-failed"; a: string; b?: string };

/** What the student sees on the live board: overlapping writing, lines through writing, writing off the board. */
async function pixelCheck(page: Page): Promise<PixelIssue[]> {
  return page.evaluate(() => {
    const live = document.querySelector('[data-panel][data-live="true"]') as SVGGElement | null;
    if (!live) return [];
    const ctm = live.getScreenCTM();
    if (!ctm) return [];
    const inv = ctm.inverse();
    const toBoard = (r: DOMRect) => {
      const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
      const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    };
    const visible = (el: Element) => {
      let e: Element | null = el;
      while (e && e !== live) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.15) return false;
        e = e.parentElement;
      }
      return true;
    };
    // Writing: SVG text, and the writing inside foreignObjects (KaTeX, sketch writing).
    const writings: Array<{ id: string; box: { x: number; y: number; w: number; h: number }; el: Element }> = [];
    live.querySelectorAll("text").forEach((t) => {
      if (!t.textContent?.trim() || !visible(t) || t.closest("foreignObject")) return;
      const r = t.getBoundingClientRect();
      if (r.width > 1) writings.push({ id: t.textContent.trim().slice(0, 30), box: toBoard(r), el: t });
    });
    live.querySelectorAll("foreignObject").forEach((f) => {
      if (!visible(f)) return;
      const inner = (f.querySelector("[data-ink-content]") ?? f.querySelector(".katex") ?? f.firstElementChild) as HTMLElement | null;
      if (!inner || !inner.textContent?.trim()) return;
      const r = inner.getBoundingClientRect();
      if (r.width > 1) writings.push({ id: inner.textContent.trim().slice(0, 30), box: toBoard(r), el: f });
    });
    const issues: Array<{ kind: "overlap" | "ink-through-text" | "off-board"; a: string; b?: string }> = [];
    const shrink = (b: { x: number; y: number; w: number; h: number }, k: number) => ({ x: b.x + b.w * k, y: b.y + b.h * k, w: b.w * (1 - 2 * k), h: b.h * (1 - 2 * k) });
    for (const w of writings) if (w.box.x < -4 || w.box.y < -4 || w.box.x + w.box.w > 1004 || w.box.y + w.box.h > 564) issues.push({ kind: "off-board", a: w.id });
    for (let i = 0; i < writings.length; i++)
      for (let j = i + 1; j < writings.length; j++) {
        const a = shrink(writings[i].box, 0.08), b = shrink(writings[j].box, 0.08);
        if (writings[i].el.contains(writings[j].el) || writings[j].el.contains(writings[i].el)) continue;
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix > 2 && iy > 2) issues.push({ kind: "overlap", a: writings[i].id, b: writings[j].id });
      }
    // Lines through writing: strokes sampled along their length (faint grid lines are scenery).
    const strokes = Array.from(live.querySelectorAll("path, line, polyline")) as SVGGeometryElement[];
    for (const sEl of strokes) {
      if (!visible(sEl) || sEl.closest("foreignObject")) continue;
      const cs = getComputedStyle(sEl);
      if (cs.stroke === "none" || Number(cs.strokeOpacity) * Number(cs.opacity) < 0.4 || parseFloat(cs.strokeWidth) < 1.5) continue;
      if (sEl.closest("[data-no-marker]")) continue;
      // Aria's own pen marks (underline, tap, outline, ring) touch what they point at on purpose.
      if (sEl.matches(".cv-swipe, .cv-tap, .cv-outline, .cv-ring")) continue;
      let len = 0;
      try { len = sEl.getTotalLength(); } catch { continue; }
      if (!len || len > 4000) continue;
      const m = sEl.getScreenCTM();
      if (!m) continue;
      const hits = new Set<string>();
      for (let k = 0; k <= 40; k++) {
        const p = sEl.getPointAtLength((len * k) / 40);
        const sp = new DOMPoint(p.x, p.y).matrixTransform(m).matrixTransform(inv);
        for (const w of writings) {
          if (w.el.contains(sEl) || hits.has(w.id)) continue;
          const b = shrink(w.box, 0.2);
          if (sp.x > b.x && sp.x < b.x + b.w && sp.y > b.y && sp.y < b.y + b.h) hits.add(w.id);
        }
      }
      for (const h of hits) issues.push({ kind: "ink-through-text", a: h });
    }
    return issues;
  });
}

const args = process.argv.slice(2);
const sessions: Array<{ topic: string; session: string; seconds?: number }> = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--session") sessions.push({ topic: "", session: args[++i] });
  else {
    process.stdout.write(`generating "${args[i]}"… `);
    const g = await generate(args[i]);
    console.log(`${g.snap.status} in ${g.seconds}s, $${(g.snap.costUsd ?? 0).toFixed(4)}`);
    sessions.push({ topic: args[i], session: g.session, seconds: g.seconds });
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
// tsx names functions with a helper the page does not have.
await ctx.addInitScript("window.__name = (f) => f;");
await ctx.addCookies([{ name: "aria_access", value: token, domain: new URL(BASE).hostname, path: "/" }]);
const report: unknown[] = [];
let totalIssues = 0;
for (const { topic, session, seconds } of sessions) {
  const snap = await load(session);
  const beats = (snap.beats ?? []).filter((b): b is NonNullable<typeof b> => Boolean(b));
  const dir = `${OUT}/${(snap.topic || topic).replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}-${session.slice(0, 6)}`;
  mkdirSync(dir, { recursive: true });
  const boards: unknown[] = [];
  console.log(`\n== ${snap.topic || topic} (${session}) — ${beats.length} boards`);
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const spec = beat.draw?.ops.find((o) => o.kind === "canvasBoard")?.spec;
    if (!spec) continue;
    const n = canvasSentences(beat.script).length;
    const still = stillSentences(spec, n);
    const numbers = labelTexts(spec).flatMap((t) => checkNumbers(t)).map((x) => `${x.calculation} = ${x.stated} (is ${x.computed})`);
    const audit = auditBoardForRelease(spec, { id: beat.id, title: beat.title, script: beat.script, stage: spec.stage.kind, brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false } as never)
      .filter((f) => ["numbers", "graph", "layout"].includes(f.gate))
      .map((f) => `${f.gate}: ${f.message}`);
    const equation = spec.stage.kind === "equation" ? equationProblem(spec.stage, spec.stage, beat.script) : null;
    if (equation) audit.push(`equation: ${equation}`);
    const ds = spec.stage.kind === "code" || spec.stage.kind === "structure" ? spec.stage.structure : undefined;
    const said = ds && (spec.stage.kind === "code" || spec.stage.kind === "structure") ? narratedStructureMismatch(ds, spec.stage.steps, canvasSentences(beat.script)) : null;
    if (said) audit.push(`structure: ${said}`);
    const layout = layoutPanel(spec);
    const zooms = spec.cues.filter((c) => c.action === "zoom").map((c) => {
      const t = layout.targets[c.target ?? ""];
      return t ? Math.round(((t.w * t.h) / (1000 * 560)) * 100) : -1;
    });
    const pixels: PixelIssue[] = [];
    for (const [tag, query] of [["mid", `s=${Math.floor(n / 2)}&p=1`], ["done", "done=1"]] as const) {
      const page = await ctx.newPage();
      // Under load the lecture can take a while to load, and canvas-lab then shows its home page: a
      // board that never appeared is reported, never passed (round 1 scored four such frames ✓).
      let shown = false;
      for (let attempt = 0; attempt < 2 && !shown; attempt++) {
        await page.goto(`${BASE}/canvas-lab?session=${session}&scrub=1&board=${i}&${query}`, { timeout: 90_000 });
        shown = await page.waitForSelector('[data-panel][data-live="true"]', { timeout: 45_000 }).then(() => true, () => false);
      }
      if (!shown) {
        pixels.push({ kind: "capture-failed", a: `board ${i + 1} (${tag}) never appeared on the canvas` });
        await page.screenshot({ path: `${dir}/board${i + 1}-${tag}.png` });
        await page.close();
        continue;
      }
      await page.waitForTimeout(3000);
      // The pen writes at a teacher's pace: measured once it has finished (idle 1.5 s), never half-drawn.
      for (let idle = 0, t = 0; idle < 1500 && t < 60_000; t += 250) {
        const on = await page.evaluate(() => { const m = document.querySelector('[data-panel][data-live="true"] [data-marker-tip]'); return m ? Number(getComputedStyle(m).opacity) > 0.1 : false; });
        idle = on ? 0 : idle + 250;
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(800);
      for (const issue of await pixelCheck(page)) if (!pixels.some((p) => JSON.stringify(p) === JSON.stringify(issue))) pixels.push(issue);
      await page.screenshot({ path: `${dir}/board${i + 1}-${tag}.png` });
      await page.close();
    }
    const issues = [...numbers.map((x) => `wrong number: ${x}`), ...audit, ...pixels.map((p) => `${p.kind}: "${p.a}"${p.b ? ` × "${p.b}"` : ""}`), ...(still.length > Math.max(1, n * 0.34) ? [`${still.length}/${n} sentences change nothing on the board (${still.join(", ")})`] : [])];
    totalIssues += issues.length;
    boards.push({ board: i + 1, title: beat.title, stage: spec.stage.kind, component: (spec.stage as { component?: string }).component, sentences: n, still, zooms, issues });
    console.log(`  ${i + 1}. ${spec.stage.kind.padEnd(9)} ${beat.title.slice(0, 44).padEnd(44)} ${issues.length ? `✗ ${issues.length}` : "✓"}${zooms.length ? `  zooms ${zooms.join("/")}%` : ""}`);
    for (const x of issues) console.log(`       - ${x}`);
  }
  report.push({ topic: snap.topic || topic, session, seconds, costUsd: snap.costUsd, boards });
}
await browser.close();
writeFileSync(`${OUT}/report-${Date.now()}.json`, JSON.stringify(report, null, 1));
console.log(`\n${totalIssues} issue(s). Screenshots and report: ${OUT}`);
