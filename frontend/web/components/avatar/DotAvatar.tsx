"use client";

import { useEffect, useRef, type RefObject } from "react";
import { mouthShape, visemeWeights } from "@/lib/adhd/mouth";
import { DOT_REST, dotMuscles, easeMuscles, type DotMuscles } from "@/lib/avatar/dotFace";
import type { VisemeWeights } from "@/lib/avatar/visemes";
import type { AvatarState } from "@/lib/avatar/face";

/**
 * ARIA — a planet made of dots, with a ring of dots around her and a face (owner's design, 2026-11-27:
 * UI_motivation/Aria homepage (light|dark).html). Replaces the flat violet orb with a gold ring, everywhere.
 *
 * Drawn on a canvas: a sphere of points (a Fibonacci lattice) over a glowing violet body, a tilted ring of points
 * that turns slowly, and the face on top. The colours are theme tokens (--aria-*), so she matches light and dark.
 *
 * HOW SHE TALKS. Unchanged from the orb: the same mouth bus as the photoreal head (lib/adhd/mouth.ts) — the live
 * viseme weights say WHICH sound, the voice how loud — turned into seven mouth muscles (lib/avatar/dotFace.ts),
 * drawn every frame without React. A blink every few seconds, a breath while she is quiet, a small nod on a
 * stressed syllable, and her eyes on what she points at (`gaze`), or on the pointer (`followPointer`, the home
 * page). Thinking: eyes up and aside; listening: eyes a little wider, the glow brighter.
 *
 * Reduced motion: the planet stands still; only the face (blinks, mouth) moves.
 */
export type DotGaze = { x: number; y: number } | null;
/** A mouth from somewhere other than the voice bus (the home page greeting, typed letter by letter). */
export type DotMouthInput = { weights: VisemeWeights; open: number } | null;

type P3 = [number, number, number];
const SPHERE_CACHE = new Map<number, P3[]>();
const RING_CACHE = new Map<number, Array<[number, number, number, number]>>();
/** Points evenly over a unit sphere (Fibonacci lattice). */
function sphere(n: number): P3[] {
  let s = SPHERE_CACHE.get(n);
  if (!s) {
    s = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996;
      s.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    SPHERE_CACHE.set(n, s);
  }
  return s;
}
/** A flat ring of points 1.45–1.95 radii out, each with a fixed brightness pick (seeded, so it never flickers). */
function ring(n: number) {
  let r = RING_CACHE.get(n);
  if (!r) {
    r = [];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, d = 1.45 + rnd() * 0.5;
      r.push([Math.cos(a) * d, (rnd() - 0.5) * 0.03, Math.sin(a) * d, rnd()]);
    }
    RING_CACHE.set(n, r);
  }
  return r;
}

export function DotAvatar({
  state,
  gaze,
  mouth,
  still = false,
  followPointer = false,
  className = "",
}: {
  state: AvatarState;
  /** Where to look, as a direction (-1..1 each axis); null = at the student. Read every frame. */
  gaze?: RefObject<DotGaze>;
  /** Overrides the voice bus while it holds a value. Read every frame. */
  mouth?: RefObject<DotMouthInput>;
  /** Parked beside something she points at: no breath bob, no nod travel. */
  still?: boolean;
  /** The whole planet turns toward the pointer, as on the home page's stage. */
  followPointer?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const stillRef = useRef(still);
  useEffect(() => {
    stateRef.current = state;
    stillRef.current = still;
  }, [state, still]);

  useEffect(() => {
    const cv = canvasRef.current;
    const cx = cv?.getContext("2d");
    if (!cv || !cx) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let m: DotMuscles = { ...DOT_REST };
    let nod = 0, nodV = 0, lift = 0, blink = -1, nextBlink = 2.5, clock = 0, breath = 0, spin = 0;
    let look = { x: 0, y: 0 }, idleLook = { x: 0, y: 0 }, nextLook = 1.5;
    let prevOpen = 0, lastBeat = -1;
    // The pointer, for followPointer (smoothed below).
    const pointer = { x: 0, y: 0 }, turn = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      const b = cv.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, (e.clientX - b.left - b.width / 2) / (window.innerWidth * 0.45)));
      pointer.y = Math.max(-1, Math.min(1, (e.clientY - b.top - b.height / 2) / (window.innerHeight * 0.45)));
    };
    if (followPointer) window.addEventListener("pointermove", onPointer);
    const css = (n: string, fallback: string) => getComputedStyle(cv).getPropertyValue(n).trim() || fallback;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      const s = stateRef.current;
      const ext = mouth?.current ?? null;
      const voice = ext ? { open: ext.open, width: 0.5 } : mouthShape();
      const talking = s === "speaking";
      m = easeMuscles(m, talking ? dotMuscles(ext ? ext.weights : (visemeWeights() as VisemeWeights), voice) : DOT_REST, dt);

      // A nod on a stressed syllable: the voice rising through a loud level, at most every 0.45 s.
      if (talking && !reduced && voice.open > 0.62 && prevOpen <= 0.62 && clock - lastBeat > 0.45) {
        lastBeat = clock;
        nodV += 22 * voice.open;
        if (voice.open > 0.85) lift = 1;
      }
      prevOpen = voice.open;
      nodV += (-180 * nod - 18 * nodV) * dt;
      nod += nodV * dt;
      lift *= Math.pow(0.04, dt);
      if (stillRef.current) nod *= 0.5;

      if (clock > nextBlink) { blink = 0; nextBlink = clock + (talking ? 2.2 : 3) + Math.random() * 2.4; }
      let lid = 1;
      if (blink >= 0) {
        blink += dt;
        const bt = blink / 0.17;
        if (bt >= 1) blink = -1;
        else lid = 1 - 0.92 * Math.sin(bt * Math.PI);
      }
      if (s === "thinking") lid *= 0.85;
      if (s === "listening") lid *= 1.06;
      lid *= 1 + 0.08 * lift;

      const g = gaze?.current ?? null;
      if (!g && clock > nextLook) {
        idleLook = s === "thinking" ? { x: 0.5, y: -0.6 } : { x: (Math.random() * 2 - 1) * 0.5, y: (Math.random() * 2 - 1) * 0.3 };
        nextLook = clock + 1.2 + Math.random() * 2;
      }
      const want = followPointer && !g ? pointer : g ?? idleLook;
      const k = 1 - Math.pow(0.7, dt * 60);
      look = { x: look.x + (want.x - look.x) * k, y: look.y + (want.y - look.y) * k };
      turn.x += ((followPointer ? pointer.x : look.x * 0.4) - turn.x) * 0.08;
      turn.y += ((followPointer ? pointer.y : look.y * 0.4) - turn.y) * 0.08;
      breath = !talking && !stillRef.current && !reduced ? 0.5 + 0.5 * Math.sin(clock * 1.6) : breath * 0.9;
      if (!reduced) spin += dt * 0.24;

      // ── draw ──────────────────────────────────────────────────────────────
      const d = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) { raf = requestAnimationFrame(loop); return; }
      if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
      cx.setTransform(d, 0, 0, d, 0, 0);
      cx.clearRect(0, 0, w, h);
      // Fewer points when she is small: the look is the same, the cost is not.
      const size = Math.min(w, h);
      const N = size > 300 ? 3600 : size > 140 ? 1800 : 720;
      const M = size > 300 ? 2400 : size > 140 ? 1200 : 600;
      const S = sphere(N), R = ring(M);
      const u = Math.min(w / 4.5, h / 3.4) * (1 + 0.012 * breath);
      const X = w / 2, Y = h * 0.5 + nod * 0.55 * (u / 90);
      const c1 = css("--aria-dot1", "#8d6df0"), c2 = css("--aria-dot2", "#ffffff"), body = css("--aria-body", "#2f1670"), hi = css("--aria-body-hi", "#8a62f2");
      const ink = css("--aria-ink", "#120a22"), glow = css("--aria-glow", "rgba(139,108,255,.6)");
      const yaw = spin + turn.x * 0.7, pit = turn.y * 0.35;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
      const rotS = (p: P3): P3 => { const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1]; return [x, y * cp - z * sp, y * sp + z * cp]; };
      const tilt = -0.38 + turn.y * 0.35, roll = 0.22 + turn.x * 0.2, ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(roll), sr = Math.sin(roll);
      const rr = spin * 2.5, crr = Math.cos(rr), srr = Math.sin(rr);
      const rotR = (p: [number, number, number, number]): P3 => {
        let x = p[0] * crr + p[2] * srr, z = -p[0] * srr + p[2] * crr, y = p[1];
        [y, z] = [y * ct - z * st, y * st + z * ct];
        [x, y] = [x * cr - y * sr, x * sr + y * cr];
        return [x, y, z];
      };
      const dot = (x: number, y: number, z: number, sz: number, col: string) => {
        cx.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.min(1, (z + 1.6) / 3.2));
        cx.fillStyle = col;
        cx.fillRect(X + x * u - sz / 2, Y - y * u - sz / 2, sz, sz);
      };
      const dotSize = Math.max(1, u * 0.012);
      const rp = R.map(rotR);
      rp.forEach((q, i) => { if (q[2] < 0) dot(q[0], q[1], q[2], dotSize, R[i][3] > 0.5 ? c2 : c1); });
      // The body, glowing brighter while she listens or speaks.
      cx.globalAlpha = 1;
      cx.beginPath();
      cx.arc(X, Y, u, 0, 6.283);
      const grad = cx.createRadialGradient(X - u * 0.3, Y - u * 0.4, u * 0.1, X, Y, u);
      grad.addColorStop(0, hi);
      grad.addColorStop(1, body);
      cx.fillStyle = grad;
      cx.shadowColor = glow;
      cx.shadowBlur = u * (s === "speaking" ? 0.7 : s === "listening" ? 0.62 : 0.5);
      cx.fill();
      cx.shadowBlur = 0;
      S.forEach((p) => {
        const q = rotS(p);
        if (q[2] < -0.05) return;
        const lit = (q[1] * 0.6 - q[0] * 0.3 + q[2] * 0.4 + 1) / 2;
        dot(q[0], q[1], q[2], Math.max(1, u * (lit > 0.6 ? 0.014 : 0.01)), lit > 0.66 ? c2 : c1);
      });
      rp.forEach((q, i) => { if (q[2] >= 0) dot(q[0], q[1], q[2], Math.max(1.2, u * 0.014), q[1] > -0.2 && R[i][3] > 0.3 ? c2 : c1); });
      cx.globalAlpha = 1;

      // The face: eyes (with blinks and gaze), cheeks, mouth.
      const fx = X + look.x * u * 0.3, fy = Y + look.y * u * 0.22, kk = 1 - Math.hypot(look.x, look.y) * 0.1;
      cx.fillStyle = "rgba(255,130,185,.32)";
      [-0.52, 0.52].forEach((e) => { cx.beginPath(); cx.ellipse(fx + e * u * kk, fy + u * 0.12, u * 0.11, u * 0.065, 0, 0, 6.283); cx.fill(); });
      [-0.3, 0.3].forEach((ex) => {
        const ex2 = fx + ex * u * kk;
        cx.fillStyle = ink;
        cx.beginPath();
        cx.ellipse(ex2, fy - u * 0.16, u * 0.075 * kk, Math.max(0.6, u * 0.125 * lid), 0, 0, 6.283);
        cx.fill();
        if (lid > 0.4) {
          cx.fillStyle = "#fff";
          cx.beginPath();
          cx.ellipse(ex2 + look.x * u * 0.025, fy - u * 0.16 - u * 0.05 * lid + look.y * u * 0.03, u * 0.022, u * 0.036 * lid, 0, 0, 6.283);
          cx.fill();
        }
      });
      drawMouth(cx, m, talking ? 0.3 : 0.5, fx, fy + u * 0.16, u / 72, ink);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (followPointer) window.removeEventListener("pointermove", onPointer);
    };
  }, [gaze, mouth, followPointer]);

  return <canvas ref={canvasRef} className={`block ${className}`} role="img" aria-label="Aria" />;
}

/**
 * The mouth from the seven muscles, drawn at (x, y) at scale `k`: a smile line when closed (a tucked lip for f/v),
 * an open shape with teeth and tongue when she opens it — the same geometry as the orb's.
 */
function drawMouth(cx: CanvasRenderingContext2D, m: DotMuscles, smile: number, x: number, y: number, k: number, ink: string) {
  const hw = 13 * k * (1 + 0.7 * m.spread - 0.58 * m.round) * (1 - 0.1 * m.seal) * (1 + 0.15 * smile);
  const open = (30 * m.jaw + 6 * m.round * Math.min(1, m.jaw * 3)) * k;
  const cy = y - 1.8 * k * smile + 1.2 * k * m.round;
  const L = x - hw, R = x + hw;
  cx.lineCap = "round";
  cx.lineJoin = "round";
  if (open < 1.6 * k || m.fv > 0.5) {
    const bulge = (3 + 4 * smile - 2 * m.seal - 1.5 * m.round) * (1 - 0.7 * Math.min(1, m.fv)) * k * 1.4;
    cx.strokeStyle = ink;
    cx.lineWidth = (3.4 + 1.8 * m.seal + 1.2 * m.fv + 1.5 * m.round) * k * 0.9;
    cx.beginPath();
    cx.moveTo(L, cy);
    cx.quadraticCurveTo(x, cy + bulge * 2.2, R, cy);
    cx.stroke();
    if (m.fv > 0.25) {
      cx.globalAlpha = Math.min(1, (m.fv - 0.25) * 3);
      cx.fillStyle = "#fff";
      cx.fillRect(x - hw * 0.48, cy + bulge * 0.5 - 4.6 * k - 0.6 * k, hw * 0.95, 4.6 * k);
      cx.globalAlpha = 1;
    }
    return;
  }
  const top = cy - open * 0.34, bot = cy + open * 0.66;
  const c1 = (0.1 + 0.42 * (1 - m.round)) * hw;
  const ty = cy - (cy - top) / 0.75, by = cy + (bot - cy) / 0.75;
  cx.beginPath();
  cx.moveTo(L, cy);
  cx.bezierCurveTo(L + c1, ty, R - c1, ty, R, cy);
  cx.bezierCurveTo(R - c1, by, L + c1, by, L, cy);
  cx.closePath();
  cx.fillStyle = ink;
  cx.fill();
  cx.save();
  cx.clip();
  if (m.teeth > 0.25 || m.fv > 0.3) {
    cx.fillStyle = "#fff";
    cx.fillRect(L, top - k, hw * 2, Math.min(6 * k, open * (0.25 + 0.2 * m.teeth)));
  }
  if (open > 9 * k || m.tongue > 0.3) {
    cx.fillStyle = "#ff8fb8";
    cx.beginPath();
    cx.ellipse(x, bot - open * 0.12 - m.tongue * open * 0.5, hw * (0.62 - 0.12 * m.tongue), Math.max(3 * k, open * 0.28), 0, 0, 6.283);
    cx.fill();
  }
  cx.restore();
  cx.strokeStyle = ink;
  cx.lineWidth = (2.4 + 2.6 * m.round) * k;
  cx.stroke();
}
