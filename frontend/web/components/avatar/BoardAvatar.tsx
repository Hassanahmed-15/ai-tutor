"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { AriaAvatar } from "./AriaAvatar";
import { DotAvatar, type DotGaze } from "./DotAvatar";
import type { AvatarState } from "@/lib/avatar/face";
import { arcPoint, beam, covers, distanceTo, FLIGHT_GAP_S, FLY_S, gazeAt, HOP_GAP_S, LINGER_S, parkingSpot, REACH, RETURN_S, type Pt, type Rect } from "@/lib/avatar/dotFlight";
import { pointTarget, setDotPointer } from "@/lib/avatar/pointTarget";

/**
 * ARIA AT THE BOARD. Not a video tile in a box: she stands at the lower right of the board like a
 * teacher at the edge of her slide. Pointer events pass through, so nothing under her is lost.
 *
 * Two looks: "dot" (the cartoon orb, components/avatar/DotAvatar.tsx; the default) and "real" (the
 * photoreal head, components/avatar/AriaAvatar.tsx).
 *
 * She never covers a question, asked or answered:
 *  - "beside-panel": the questions panel is open. She stands just left of it, measured from its own
 *    edge, so the conversation and its input box are never under her.
 *  - "pip": a question is on the board (a checkpoint, a quiz) or she is drawing an answer there. She
 *    steps back to a small picture in the board's top-right corner and returns when it is done.
 *
 * DOT POINTS (`flies`, board mode only). When the board names one specific thing — the lesson
 * canvas publishes its pen target (lib/avatar/pointTarget.ts) — Dot flies to stand BESIDE it and
 * points with her eyes and a thin beam; the board draws the ring or highlighter itself. Rules and
 * their sources: lib/avatar/dotFlight.ts. Reduced motion: she stays home and only looks.
 */
export type BoardAvatarMode = "board" | "beside-panel" | "pip";
export type AvatarLook = "dot" | "real";

/** Dot's size at home and while she is away pointing (px). */
const HOME_PX = 164;
/** ~100 px while she travels and points: small enough not to crowd the board. */
const AWAY_SCALE = 0.62;

export function BoardAvatar({
  state,
  mode,
  board,
  panel,
  onUnavailable,
  look = "dot",
  flies = true,
}: {
  state: AvatarState;
  mode: BoardAvatarMode;
  /** The teaching board's element. */
  board: RefObject<HTMLElement | null>;
  /** The questions panel's element, when it is open. */
  panel: RefObject<HTMLElement | null>;
  onUnavailable?: () => void;
  look?: AvatarLook;
  /** Dot may leave her corner to point at what the board names. */
  flies?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ right: number; top?: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      if (!parent) return;
      const p = panel.current?.getBoundingClientRect();
      const panelLeft = p && p.width > 0 ? p.left : Infinity;
      if (mode === "beside-panel" && panelLeft < Infinity) {
        setPlace({ right: Math.max(8, parent.right - panelLeft + 12) });
        return;
      }
      const b = board.current?.getBoundingClientRect();
      if (mode === "pip" && b) {
        // The board's top-right corner, or the part of it the panel does not cover.
        const edge = Math.min(b.right, panelLeft - 6);
        setPlace({ right: Math.max(8, parent.right - edge + 10), top: Math.max(8, b.top - parent.top + 10) });
        return;
      }
      setPlace(null);
    };
    measure();
    // The panel slides in over ~300 ms: measure again once it has arrived.
    const late = window.setTimeout(measure, 380);
    const ro = new ResizeObserver(measure);
    for (const n of [el.offsetParent, board.current, panel.current]) if (n) ro.observe(n as Element);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(late);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode, board, panel]);

  const small = mode === "pip";
  const anchorClass = `pointer-events-none absolute z-30 hidden transition-[right,top,bottom] duration-500 ease-out md:block ${place ? "" : "bottom-[4.75rem] right-2 lg:right-4"}`;
  const anchorStyle = place ? { right: place.right, ...(place.top !== undefined ? { top: place.top } : { bottom: "4.75rem" }) } : undefined;

  if (look === "real") {
    return (
      <div ref={ref} className={anchorClass} style={anchorStyle}>
        <div
          aria-hidden="true"
          className={`absolute left-1/2 top-[58%] -z-10 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,width,height] duration-500 ${small ? "size-[8rem]" : "size-[16rem]"}`}
          style={{ background: "radial-gradient(circle, var(--hud-cyan-glow) 0%, rgba(0,0,0,0) 68%)", opacity: state === "speaking" ? 1 : state === "listening" ? 0.55 : 0.25 }}
        />
        <AriaAvatar
          state={state}
          transparent
          className={`transition-[width,height] duration-500 ease-out ${small ? "h-[9.5rem] w-[7.5rem]" : "h-[19rem] w-[15rem] lg:h-[21rem] lg:w-[16.5rem]"}`}
          onUnavailable={onUnavailable}
        />
      </div>
    );
  }
  return <DotAtBoard anchorRef={ref} anchorClass={anchorClass} anchorStyle={anchorStyle} state={state} mode={mode} board={board} flies={flies} small={small} />;
}

type Phase = "home" | "fly" | "parked" | "return";

function DotAtBoard({
  anchorRef,
  anchorClass,
  anchorStyle,
  state,
  mode,
  board,
  flies,
  small,
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  anchorClass: string;
  anchorStyle?: CSSProperties;
  state: AvatarState;
  mode: BoardAvatarMode;
  board: RefObject<HTMLElement | null>;
  flies: boolean;
  small: boolean;
}) {
  const flyerRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<SVGSVGElement>(null);
  const gaze = useRef<DotGaze>(null);
  const [parked, setParked] = useState(false);
  const modeRef = useRef(mode);
  const fliesRef = useRef(flies);
  useEffect(() => {
    modeRef.current = mode;
    fliesRef.current = flies;
  }, [mode, flies]);

  // While Dot can point, the board leaves its pen body out (it used to sit on what it showed).
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setDotPointer(flies && mode === "board" && !reduced);
    return () => setDotPointer(false);
  }, [flies, mode]);

  useEffect(() => {
    const anchor = anchorRef.current;
    const flyer = flyerRef.current;
    const svg = beamRef.current;
    if (!anchor || !flyer || !svg) return;
    const line = svg.querySelector("line") as SVGLineElement;
    const tip = svg.querySelector("circle") as SVGCircleElement;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let phase: Phase = "home";
    let key = "";
    let pos: Pt | null = null;          // her centre on screen while away
    let from: Pt = { x: 0, y: 0 };
    let to: Pt = { x: 0, y: 0 };
    let rel: Pt = { x: 0, y: 0 };       // parked spot relative to the target's centre (follows the camera)
    let started = 0;
    let lastDepart = -Infinity;
    let lastMove = -Infinity;
    let lostAt: number | null = null;
    let arrivedAt = 0;
    let beamOn = 0;
    let wasParked = false;
    let lastMs = performance.now();

    const rectOf = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const homeCentre = (): Pt => {
      const r = anchor.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const inkOn = (b: Element): Rect[] => {
      const out: Rect[] = [];
      const nodes = b.querySelectorAll("text, foreignObject, img, image");
      for (let i = 0; i < nodes.length && i < 400; i++) {
        const r = nodes[i].getBoundingClientRect();
        if (r.width > 2 && r.height > 2) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return out;
    };
    // Filled boxes smaller than the board itself: code listings, tables, cards.
    const cardsOn = (b: Element, bounds: Rect): Rect[] => {
      const out: Rect[] = [];
      const nodes = b.querySelectorAll("rect");
      for (let i = 0; i < nodes.length && i < 600; i++) {
        const n = nodes[i];
        const fill = n.getAttribute("fill");
        if (!fill || fill === "none" || fill === "transparent" || n.getAttribute("fill-opacity") === "0") continue;
        const r = n.getBoundingClientRect();
        if (r.width < 24 || r.height < 16 || r.width * r.height > bounds.w * bounds.h * 0.4) continue;
        out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return out;
    };
    const spotFor = (target: Rect, near: Pt, el: Element): Pt | null => {
      const b = board.current;
      if (!b) return null;
      // Inside the board panel the target belongs to (the chalkboard, not its frame or the page).
      const whole = rectOf(b);
      const panelEl = el.closest("[data-panel]");
      const p = panelEl ? rectOf(panelEl) : whole;
      const x0 = Math.max(whole.x, p.x) + 10, y0 = Math.max(whole.y, p.y) + 10;
      const x1 = Math.min(whole.x + whole.w, p.x + p.w) - 10, y1 = Math.min(whole.y + whole.h, p.y + p.h) - 10;
      const bounds = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
      const mine = (r: Rect) => !covers({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, 2, target);
      return parkingSpot(target, HOME_PX * AWAY_SCALE, bounds, inkOn(b).filter(mine), near, cardsOn(b, bounds).filter(mine));
    };
    const flyTo = (dest: Pt, now: number, target: Rect) => {
      from = pos ?? homeCentre();
      to = dest;
      rel = { x: dest.x - (target.x + target.w / 2), y: dest.y - (target.y + target.h / 2) };
      started = now;
      phase = "fly";
    };

    const loop = (nowMs: number) => {
      const now = nowMs / 1000;
      const home = homeCentre();
      const t = pointTarget();
      const target = t ? rectOf(t.el) : null;
      const allowed = fliesRef.current && modeRef.current === "board" && !reduced && target !== null && target.w > 0;

      // A new thing named.
      if (t && t.key !== key) {
        key = t.key;
        lostAt = null;
        if (allowed && target) {
          if ((phase === "parked" || phase === "fly") && pos && !covers(pos, HOME_PX * AWAY_SCALE, target) && distanceTo(pos, target) < REACH) {
            // She can point at it from where she stands: a new beam, not another flight.
            rel = { x: pos.x - (target.x + target.w / 2), y: pos.y - (target.y + target.h / 2) };
            if (phase === "fly") to = pos;
          } else {
            const away = phase === "parked" || phase === "fly";
            // From her corner at most every FLIGHT_GAP_S; a hop while out at most every HOP_GAP_S,
            // unless she would be standing on the new target (she never covers what is named).
            const due = away ? now - lastMove >= HOP_GAP_S || (pos !== null && covers(pos, HOME_PX * AWAY_SCALE, target)) : now - lastDepart >= FLIGHT_GAP_S;
            const spot = due ? spotFor(target, pos ?? home, t.el) : null;
            if (spot) {
              if (!away) lastDepart = now;
              lastMove = now;
              flyTo(spot, now, target);
            } else if (away && pos) {
              // Too soon to hop: point from where she stands.
              rel = { x: pos.x - (target.x + target.w / 2), y: pos.y - (target.y + target.h / 2) };
              if (phase === "fly") to = pos;
            }
          }
        }
      }
      if (!t) {
        if (phase !== "home" && phase !== "return") {
          lostAt ??= now;
          if (now - lostAt > LINGER_S) {
            from = pos ?? home;
            started = now;
            phase = "return";
          }
        }
        key = "";
      }
      // A question came up, or flying was switched off: straight home.
      if ((modeRef.current !== "board" || !fliesRef.current) && (phase === "fly" || phase === "parked")) {
        from = pos ?? home;
        started = now;
        phase = "return";
      }

      // Move.
      let scale = 1;
      if (phase === "fly") {
        // The target may move under the camera mid-flight: aim at where her spot is now.
        if (target && t?.key === key) to = { x: target.x + target.w / 2 + rel.x, y: target.y + target.h / 2 + rel.y };
        const k = (now - started) / FLY_S;
        pos = arcPoint(from, to, k);
        scale = 1 - (1 - AWAY_SCALE) * Math.min(1, k * 1.4);
        if (k >= 1) {
          phase = "parked";
          arrivedAt = now;
        }
      } else if (phase === "parked") {
        scale = AWAY_SCALE;
        if (target && t?.key === key) {
          const want = { x: target.x + target.w / 2 + rel.x, y: target.y + target.h / 2 + rel.y };
          if (covers(want, HOME_PX * AWAY_SCALE, target)) {
            // The camera zoomed and her spot now covers the target: step aside.
            const spot = t ? spotFor(target, want, t.el) : null;
            if (spot) flyTo(spot, now, target);
          } else pos = want;
        }
      } else if (phase === "return") {
        const k = (now - started) / RETURN_S;
        pos = arcPoint(from, home, k);
        scale = AWAY_SCALE + (1 - AWAY_SCALE) * Math.min(1, k);
        if (k >= 1) {
          phase = "home";
          pos = null;
        }
      }
      const at = pos ?? home;
      flyer.style.transform = pos ? `translate(${(pos.x - home.x).toFixed(1)}px, ${(pos.y - home.y).toFixed(1)}px) scale(${scale.toFixed(3)})` : "";

      // Eyes on what is named, wherever she is; the beam only once she stands beside it.
      gaze.current = target ? gazeAt(at, target) : null;
      const showBeam = phase === "parked" && target && now - arrivedAt > 0.12;
      beamOn += ((showBeam ? 1 : 0) - beamOn) * Math.min(1, (nowMs - lastMs) / 90);
      lastMs = nowMs;
      const parent = svg.getBoundingClientRect();
      const b = showBeam && target ? beam(at, (HOME_PX * AWAY_SCALE) / 2 - 10, target) : null;
      if (b && beamOn > 0.02) {
        line.setAttribute("x1", (b.from.x - parent.left).toFixed(1));
        line.setAttribute("y1", (b.from.y - parent.top).toFixed(1));
        line.setAttribute("x2", (b.to.x - parent.left).toFixed(1));
        line.setAttribute("y2", (b.to.y - parent.top).toFixed(1));
        tip.setAttribute("cx", (b.to.x - parent.left).toFixed(1));
        tip.setAttribute("cy", (b.to.y - parent.top).toFixed(1));
        svg.style.opacity = beamOn.toFixed(2);
      } else svg.style.opacity = "0";

      const nowParked = phase === "parked";
      if (nowParked !== wasParked) {
        wasParked = nowParked;
        setParked(nowParked);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anchorRef, board]);

  const sizeClass = small ? "size-[6.5rem]" : "size-[10.25rem]";
  return (
    <>
      {/* The beam: a thin line of light from her to what she names, ending in a small dot. */}
      <svg ref={beamRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible" style={{ opacity: 0 }}>
        <line style={{ stroke: "var(--dot-trail)" }} strokeOpacity={0.75} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="1 6" />
        <circle r={3.5} style={{ fill: "var(--dot-trail)" }} />
      </svg>
      <div ref={anchorRef} className={anchorClass} style={anchorStyle}>
        <div ref={flyerRef} className={`${sizeClass} origin-center transition-[width,height] duration-500 ease-out will-change-transform`}>
          <DotAvatar state={state} gaze={gaze} still={parked} className="h-full w-full drop-shadow-[0_6px_18px_var(--dot-shadow)]" />
        </div>
      </div>
    </>
  );
}
