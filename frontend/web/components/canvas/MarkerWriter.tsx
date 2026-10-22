"use client";

import { useEffect, useRef } from "react";
import type { Rect } from "@/lib/canvas/layout";

/**
 * THE MARKER DRAWS THE BOARD (owner, 2026-10-20 "I don't see the marker"; 2026-10-21 "draw everything
 * by own hand"). On a maths or computer-science lecture, everything new on the live board is put there
 * by the marker, in the order it appears:
 *   - a line, curve, arrow or outline is TRACED from its start to its end, the marker's tip on the ink;
 *   - writing (a word, a term, a line of code) and a filled shape are uncovered left to right with the
 *     tip at the edge.
 * Research: watching a drawing being made beats a finished one (Fiorella et al. 2019, d = 0.54), and
 * drawings that appear with no visible hand showed no benefit.
 *
 * Pace: a teacher's pace, not a flash (owner, 2026-10-21: "when it draws any graphs or diagram it
 * moves way too fast", then "the sketches are drawn pretty fast"). A line is traced at about 200 board
 * units a second; a sentence's new ink shares about seven and a half seconds, and is never sped up past
 * 85% of its natural pace (≈ 235 units a second) unless the drawing has fallen more than nine seconds
 * behind Aria's voice — then the backlog gently catches up. A whole board
 * arriving at once (a jump to a finished board) is simply there. Nothing is ever left hidden: every
 * item is finished when its stroke ends, or when this unmounts.
 *
 * The camera follows the marker, not the clock: before the first stroke of each new piece of ink the
 * marker tells `onRegion` where it will draw (board units) and waits the time it answers, so the
 * camera is already there when the pen touches the board (LessonCanvas, lib/canvas/camera.ts).
 */

type Kind = "trace" | "wipe";
type Job = { el: SVGGraphicsElement; kind: Kind; dur: number; len: number; pathLength: string | null; x0: number; x1: number; y: number; left: number; boxW: number; batch: number; faint?: boolean; caughtUp?: boolean };
/** `drawing`: a diagram, graph, equation or code — worth a close-up; notes and headings are not. */
type Batch = { jobs: Job[]; ms: number; drawing: boolean; scenery: SVGGraphicsElement[] };

const WRITABLE = "text, foreignObject";
const SHAPES = "path, line, polyline, polygon, circle, ellipse, rect";
/** A sentence's new ink is drawn in about this long (ms). */
const BATCH_MS = 7500;
/**
 * A traced line: ms per board unit (≈ 200 units a second — a teacher's hand on a whiteboard; owner,
 * 2026-10-21, twice: "the sketches are drawn pretty fast"), and the shortest and longest one stroke takes.
 */
const TRACE_MS_PER_UNIT = 5;
const TRACE_MIN_MS = 450;
const TRACE_MAX_MS = 6500;
/** Writing uncovered left to right: ms per board unit of width. */
const WIPE_MS_PER_UNIT = 4.5;
const WIPE_MIN_MS = 200;
const WIPE_MAX_MS = 1800;
/** Never faster than this share of the natural pace (≈ 235 units a second), unless far behind the voice. */
const SLOWEST_SQUEEZE = 0.85;
/** Drawing this far (ms) behind: what is waiting is sped up (gently) to catch up with Aria. */
const BEHIND_MS = 9000;
/** A new board: the camera flies in from the last one first; the pen starts once it has landed. */
const BOARD_FLIGHT_MS = 1500;
/** More new items than this at once is a whole board appearing: it is shown, not drawn. */
const WHOLE_BOARD = 200;
const TRANSPARENT = /^(none|transparent)$|rgba\([^)]*,\s*0\)$/;

export function MarkerWriter({ onRegion, finished = false }: { onRegion?: (box: Rect | null, ms: number, drawing: boolean) => number; finished?: boolean } = {}) {
  const ref = useRef<SVGGElement>(null);
  const regionRef = useRef(onRegion);
  /** Opened on a finished board (a jump back, a replay): what is there is simply there. Read at mount. */
  const openedFinished = useRef(finished);
  /** Everything held is put on the board at once (set by the drawing effect). */
  const flushRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(0);
  // Turned finished within moments of opening (a jump to a finished board, the scrubber): it is all
  // simply there, not drawn from scratch at a teacher's pace.
  useEffect(() => {
    if (finished && performance.now() - mountedRef.current < 2500) flushRef.current?.();
  }, [finished]);
  useEffect(() => {
    regionRef.current = onRegion;
  }, [onRegion]);
  useEffect(() => {
    const marker = ref.current;
    const board = marker?.parentElement as unknown as SVGGElement | null;
    if (!marker || !board || typeof MutationObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const queue: Job[] = [];
    const pending = new Set<Element>();
    let raf = 0;
    let current: { job: Job; start: number } | null = null;
    let idle = 0;
    const batches = new Map<number, Batch>();
    /**
     * SCENERY IS NOT TRACED. A graph's grid lines, tick marks and axis numbers (faint or hairline
     * strokes, strokes under 30 units, a lone number or axis letter) fade in together when the pen
     * starts that piece of the drawing. Traced one by one they took 10–15 s on a graph board, the
     * drawing fell behind Aria, and the catch-up rushed the curve itself (playback QA, 2026-10-21).
     */
    const scenery = new Map<SVGGraphicsElement, string>();
    let sceneryNow: SVGGraphicsElement[] = [];
    const reveal = (els: SVGGraphicsElement[]) => {
      for (const el of els) {
        if (!scenery.has(el)) continue;
        if (!/opacity/.test(el.style.transition)) el.style.transition = [el.style.transition, "opacity 520ms ease-out"].filter(Boolean).join(", ");
        el.style.opacity = scenery.get(el) ?? "";
        scenery.delete(el);
      }
    };
    let batchSeq = 0;
    // A figure's numbers and letters (a Venn region's count, an axis's tick values) come in when the pen
    // has drawn the piece they belong to — not as it starts: the Venn counts stood on the board before
    // their circles (owner, 2026-10-21: "the diagram just appears done").
    const afterBatch = new Map<number, { left: number; els: SVGGraphicsElement[] }>();
    const counted = new WeakSet<object>();
    let drawingBatch = -1;

    const boxOf = (el: Element) => {
      const ctm = board.getScreenCTM();
      const r = el.getBoundingClientRect();
      if (!ctm || (!r.width && !r.height)) return null;
      const inv = ctm.inverse();
      const p0 = new DOMPoint(r.left, r.top).matrixTransform(inv);
      const p1 = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
      return { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
    };
    const finish = (job: Job) => {
      const s = job.el.style;
      s.clipPath = "";
      if (job.kind === "trace") {
        s.strokeDasharray = "";
        s.strokeDashoffset = "";
        if (job.pathLength !== null) job.el.setAttribute("pathLength", job.pathLength);
      }
      pending.delete(job.el);
      if (!counted.has(job)) {
        counted.add(job);
        const after = afterBatch.get(job.batch);
        if (after && --after.left <= 0) {
          afterBatch.delete(job.batch);
          reveal(after.els);
        }
      }
    };

    /**
     * Seen at all? Anything faded out (a future term waiting at opacity 0) is not written: the pen was
     * sweeping across empty board while Aria talked about something else (playback QA, 2026-10-21).
     */
    const seen = (el: Element): boolean => {
      for (let e: Element | null = el; e && e !== board; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        // Transparent only because its entrance is starting (cv-in fades up from 0) still counts.
        if (Number(cs.opacity) < 0.15 && !e.getAnimations?.().some((a) => a.playState !== "finished")) return false;
      }
      return true;
    };
    /** Is this an element the marker should put on the board? (Visible ink, not scenery or a hit area.) */
    const inked = (el: Element): boolean => {
      if (marker.contains(el) || el.closest("[data-no-marker]")) return false;
      if (!seen(el)) return false;
      if (!el.matches("foreignObject") && el.closest("foreignObject")) return false;
      if (el.matches(WRITABLE)) return Boolean(el.textContent?.trim());
      const cs = getComputedStyle(el);
      const stroke = !TRANSPARENT.test(cs.stroke) && parseFloat(cs.strokeWidth || "0") > 0;
      const fill = !TRANSPARENT.test(cs.fill);
      if (!stroke && !fill) return false;
      // The board itself and its frame are the whiteboard, not something drawn on it.
      if (el.matches("rect") && Number(el.getAttribute("width")) >= 900) return false;
      return true;
    };

    const hold = (el: Element) => {
      if (pending.has(el) || !inked(el)) return;
      const g = el as SVGGraphicsElement;
      const cs = getComputedStyle(g);
      const traced = !el.matches(WRITABLE) && !TRANSPARENT.test(cs.stroke) && TRANSPARENT.test(cs.fill) && "getTotalLength" in g;
      g.style.animation = "none";
      const isScenery = (() => {
        if (el.matches(WRITABLE)) {
          // A tick's number or an axis letter on a figure or graph.
          const t = (el.textContent ?? "").trim();
          return /^(?:[−-]?\d+(?:[.,]\d+)?|[OxyXY])$/.test(t) && Boolean(el.closest('[data-kind="figure"], [data-kind="graph"], [data-kind="sketch"]'));
        }
        if (!traced) return false;
        let len = 0;
        try {
          len = (g as unknown as SVGGeometryElement).getTotalLength();
        } catch {
          len = 0;
        }
        return Number(cs.strokeOpacity || 1) * Number(cs.opacity || 1) < 0.5 || parseFloat(cs.strokeWidth || "2") < 1.6 || len < 30;
      })();
      if (isScenery) {
        scenery.set(g, g.style.opacity);
        g.style.opacity = "0";
        sceneryNow.push(g);
        return;
      }
      const job: Job = { el: g, kind: traced ? "trace" : "wipe", dur: 0, len: 0, pathLength: g.getAttribute("pathLength"), x0: 0, x1: 0, y: 0, left: 0, boxW: 1, batch: batchSeq };
      if (traced) {
        // Traced in the element's own units: pathLength is taken off while it is drawn.
        if (job.pathLength !== null) g.removeAttribute("pathLength");
        let len = 0;
        try {
          len = (g as unknown as SVGGeometryElement).getTotalLength();
        } catch {
          len = 0;
        }
        if (!len || len > 6000) {
          finish(job);
          return;
        }
        job.len = len;
        g.style.strokeDasharray = `${len} ${len + 2}`;
        g.style.strokeDashoffset = `${len}`;
      } else {
        g.style.clipPath = "inset(-40% 100% -40% -6%)";
      }
      pending.add(el);
      queue.push(job);
    };

    const show = (on: boolean) => {
      marker.style.opacity = on ? "1" : "0";
    };
    const place = (x: number, y: number) => marker.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);

    /** Give a batch its durations: by size, at a teacher's pace, fitted (within limits) to its budget. */
    const plan = (jobs: Job[]) => {
      const want = jobs.map((j) => {
        if (j.kind === "trace") {
          // Scenery (a graph's grid, its tick marks: faint or hairline) is drawn quickly, so the curve
          // and the shapes that teach keep the slow pace without the board falling behind the voice.
          const cs = getComputedStyle(j.el);
          const faint = Number(cs.strokeOpacity || 1) * Number(cs.opacity || 1) < 0.5 || parseFloat(cs.strokeWidth || "2") < 1.6 || j.len < 30;
          j.faint = faint;
          if (faint) return Math.max(90, Math.min(600, j.len * TRACE_MS_PER_UNIT * 0.3));
          return Math.max(TRACE_MIN_MS, Math.min(TRACE_MAX_MS, j.len * TRACE_MS_PER_UNIT));
        }
        const b = boxOf(j.el);
        return b ? Math.max(WIPE_MIN_MS, Math.min(WIPE_MAX_MS, b.w * WIPE_MS_PER_UNIT)) : WIPE_MIN_MS;
      });
      const total = want.reduce((a, b) => a + b, 0);
      // What is still to draw before this batch: a backlog shortens this batch's budget.
      const now = performance.now();
      const backlog = (current ? Math.max(0, current.start + current.job.dur - now) : 0) + queue.filter((j) => !jobs.includes(j)).reduce((a, j) => a + j.dur, 0);
      const budget = Math.max(1500, BATCH_MS - backlog);
      // Far behind the voice it may speed up — never past half its natural pace (≈ 400 units a second).
      const k = backlog > BEHIND_MS ? Math.min(1, Math.max(0.5, budget / total)) : Math.min(1, Math.max(SLOWEST_SQUEEZE, budget / total));
      jobs.forEach((j, i) => (j.dur = Math.max(60, want[i] * k)));
      // …and what is still waiting catches up too, once (sped up again and again it raced at 1,300 units a second).
      if (backlog > BEHIND_MS) for (const j of queue) if (!jobs.includes(j) && !j.caughtUp) { j.dur = Math.max(60, j.dur * 0.75); j.caughtUp = true; }
    };

    /** The writing's span, read now: the pen wipes from its left edge to its right. */
    const measureWipe = (job: Job): boolean => {
      const b = boxOf(job.el);
      const inner = job.el.querySelector?.("[data-ink-content]") as Element | null;
      const ink = inner ? boxOf(inner) : b;
      if (!b || !ink || ink.w < 2) return false;
      job.x0 = ink.x;
      job.x1 = ink.x + ink.w;
      job.y = ink.y + Math.min(ink.h * 0.8, Math.max(0, ink.h - 2));
      job.left = b.x;
      job.boxW = Math.max(1, b.w);
      return true;
    };
    /** Being moved by a script animation (an equation term's arc), on it or any group above it. */
    const settling = (el: Element): boolean => {
      for (let e: Element | null = el; e && e !== board; e = e.parentElement) {
        if (e.getAnimations?.().some((a) => a.playState === "running" && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))) return true;
      }
      return false;
    };
    let settleSince = 0;
    const mountedAt = performance.now();
    mountedRef.current = mountedAt;
    flushRef.current = () => {
      if (current) finish(current.job);
      current = null;
      for (const job of queue.splice(0)) finish(job);
      reveal([...scenery.keys()]);
      show(false);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // The pen never writes on a board the camera has not reached yet.
      if (!current && now - mountedAt < BOARD_FLIGHT_MS) return;
      if (!current) {
        // A term still gliding to its new place (an equation step's arc) is written once it lands.
        if (queue[0] && settling(queue[0].el) && now - (settleSince ||= now) < 1600) return;
        settleSince = 0;
        const job = queue.shift();
        if (!job) {
          if (now - idle > 650) show(false);
          return;
        }
        // Gone, or no longer drawn (an equation's highlight redrawn for the next step): skipped — the
        // pen followed one such 0 × 0 underline to the board's corner (maths benchmark, 2026-10-21).
        if (!job.el.isConnected || !boxOf(job.el)) {
          finish(job);
          return;
        }
        if (job.kind === "wipe" && !measureWipe(job)) {
          finish(job);
          return;
        }
        // The first stroke of a new piece of ink: the camera is told where, and the pen waits for it.
        let wait = 0;
        if (job.batch !== drawingBatch) {
          drawingBatch = job.batch;
          const batch = batches.get(job.batch);
          batches.delete(job.batch);
          if (batch) {
            const boxes = [job, ...batch.jobs.filter((j) => j !== job && j.el.isConnected)].map((j) => boxOf(j.el)).filter((b): b is Rect => Boolean(b && b.w > 0 && b.h > 0));
            const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
            const box = boxes.length ? { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y } : null;
            wait = Math.max(0, Math.min(3000, regionRef.current?.(box, batch.ms, batch.drawing) ?? 0));
          }
          // The piece's scenery (grid, ticks, axis numbers) comes in as the pen starts it.
          if (batch?.scenery.length) {
            const els = batch.scenery;
            if (wait > 0) window.setTimeout(() => reveal(els), wait);
            else reveal(els);
          }
        } else {
          // Every later stroke too: one that would land outside the frame (an equation's term that
          // glided to a new place after its piece was framed) brings the camera back before the pen —
          // only ever back out, never a new close-up on one stroke (that moved the camera every few seconds).
          const at = boxOf(job.el);
          if (at && at.w > 0) wait = Math.max(0, Math.min(3000, regionRef.current?.(at, job.dur, false) ?? 0));
        }
        current = { job, start: now + wait };
        // Lifted while the camera flies (it stood where it last wrote as the view moved away), and
        // shown again when it starts writing.
        show(wait <= 0);
        // Playback QA (scripts/qa/playback-qa.mts) reads each stroke's time; nothing is kept otherwise.
        const qa = window as unknown as { __qaMarker?: boolean; __markerJobs?: Array<{ kind: Kind; dur: number; len: number; faint: boolean }> };
        if (qa.__qaMarker) (qa.__markerJobs ??= []).push({ kind: job.kind, dur: job.dur, len: job.len, faint: Boolean(job.faint) });
        if (qa.__qaMarker) (window as unknown as { __markerCurrent?: unknown }).__markerCurrent = { el: job.el, wait, startBox: boxOf(job.el), batch: job.batch };
      }
      const { job, start } = current;
      if (!job.el.isConnected) {
        finish(job);
        current = null;
        return;
      }
      if (now < start) return;
      if (marker.style.opacity !== "1") {
        // Where to write is read as the pen touches the board (after the camera's move), not before.
        if (job.kind === "wipe" && !measureWipe(job)) {
          finish(job);
          current = null;
          return;
        }
        show(true);
      }
      const t = Math.max(0, Math.min(1, (now - start) / job.dur));
      if (job.kind === "trace") {
        job.el.style.strokeDashoffset = `${job.len * (1 - t)}`;
        try {
          const g = job.el as unknown as SVGGeometryElement;
          const p = g.getPointAtLength(job.len * t);
          const inv = board.getScreenCTM()?.inverse();
          // The tip is placed through the element's own box, which is always where it is on screen:
          // through its matrix it sat 250 units away on an equation's animated term (maths benchmark).
          const bb = g.getBBox();
          const r = g.getBoundingClientRect();
          const sx = bb.width > 0.5 ? r.width / bb.width : bb.height > 0.5 ? r.height / bb.height : 0;
          const sy = bb.height > 0.5 ? r.height / bb.height : sx;
          if (inv && sx > 0 && sy > 0) {
            const q = new DOMPoint(r.left + (p.x - bb.x) * sx, r.top + (p.y - bb.y) * sy).matrixTransform(inv);
            place(q.x, q.y);
          } else {
            const m = g.getScreenCTM();
            if (m && inv) {
              const q = new DOMPoint(p.x, p.y).matrixTransform(m).matrixTransform(inv);
              place(q.x, q.y);
            }
          }
        } catch (error) {
          // A shape that cannot report its points is still drawn; the marker just does not follow it.
          const qa = window as unknown as { __qaMarker?: boolean; __markerErrors?: string[] };
          if (qa.__qaMarker) (qa.__markerErrors ??= []).push(String(error).slice(0, 160));
        }
      } else {
        const at = job.x0 + (job.x1 - job.x0) * t;
        job.el.style.clipPath = `inset(-40% ${Math.max(0, (1 - (at - job.left) / job.boxW) * 100).toFixed(2)}% -40% -6%)`;
        place(at, job.y);
      }
      if (t >= 1) {
        finish(job);
        current = null;
        idle = now;
      }
    };

    const collect = (nodes: Element[]) => {
      const found: Element[] = [];
      for (const n of nodes) {
        if (n.matches(WRITABLE) || n.matches(SHAPES)) found.push(n);
        n.querySelectorAll?.(`${WRITABLE}, ${SHAPES}`).forEach((el) => found.push(el));
      }
      return found;
    };
    const enqueue = (els: Element[]) => {
      const before = queue.length;
      sceneryNow = [];
      for (const el of els) hold(el);
      const jobs = queue.slice(before);
      const sceneryHere = sceneryNow;
      // Scenery with nothing to draw beside it: in at once.
      if (!jobs.length) {
        reveal(sceneryHere);
        return;
      }
      plan(jobs);
      // Where it is drawn is measured when the pen starts it (below): queued behind slower ink, an
      // equation's terms had moved by then and the camera framed where they used to be.
      const drawing = jobs.some((j) => !j.el.closest('[data-kind="note"], [data-kind="heading"]'));
      const labels = sceneryHere.filter((el) => el.matches(WRITABLE));
      if (labels.length) afterBatch.set(batchSeq, { left: jobs.length, els: labels });
      batches.set(batchSeq, { jobs, ms: jobs.reduce((a, j) => a + j.dur, 0), drawing, scenery: sceneryHere.filter((el) => !el.matches(WRITABLE)) });
      batchSeq++;
    };

    // What is on the board when it becomes live is drawn too, unless it is a whole board at once.
    // Counted as the pen would draw them: scenery (grid lines kept off the marker) and anything unseen
    // do not make a graph "a whole board at once" — a sketch graph of 60+ pieces used to flash on.
    const already = collect([board]).filter((el) => !marker.contains(el) && inked(el));
    if (already.length <= WHOLE_BOARD && !openedFinished.current) enqueue(already);
    else if ((window as unknown as { __qaMarker?: boolean }).__qaMarker) ((window as unknown as { __markerSkipped?: number[] }).__markerSkipped ??= []).push(-already.length);

    const observer = new MutationObserver((records) => {
      const added = records.flatMap((r) => Array.from(r.addedNodes)).filter((n): n is Element => n instanceof Element);
      const found = collect(added).filter((el) => inked(el));
      const qa = window as unknown as { __qaMarker?: boolean; __markerSkipped?: number[] };
      if (qa.__qaMarker && found.length > WHOLE_BOARD) (qa.__markerSkipped ??= []).push(found.length);
      if (!found.length || found.length > WHOLE_BOARD) return;
      enqueue(found);
    });
    observer.observe(board, { childList: true, subtree: true });
    raf = requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      // Never leave ink hidden.
      reveal([...scenery.keys()]);
      for (const job of queue) finish(job);
      if (current) finish(current.job);
    };
  }, []);

  return (
    <g ref={ref} data-no-marker="" data-marker-tip="" pointerEvents="none" style={{ opacity: 0, transition: "opacity 250ms ease" }}>
      {/* The marker: tip at (0, 0), body up and to the right. */}
      <g transform="translate(-2 -40)">
        {/* A light marker, so it shows on the black board. */}
        <path d="M2 40 L5 32 L10 37 Z" fill="#ffffff" />
        <path d="M5 32 L26 11 L31 16 L10 37 Z" fill="#e5e7eb" stroke="#000000" strokeWidth={1} />
        <path d="M26 11 L33 4 L38 9 L31 16 Z" fill="#60a5fa" stroke="#000000" strokeWidth={1} />
        <path d="M9 30 L24 15" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1.5} />
      </g>
    </g>
  );
}
