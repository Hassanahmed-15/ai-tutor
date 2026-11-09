"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Mark } from "@/lib/canvas/layout";
import { revealUnits, shownCount } from "@/lib/canvas/blocks";
import { BlockView } from "./BlockContent";

type BlocksMark = Extract<Mark, { type: "blocks" }>;

/** The student has scrolled back: the board stops following her for this long. */
const FOLLOW_AGAIN_MS = 8000;

/** `aria.syncDebug` = "1" in this browser shows how late each piece appears (the sync check reads it too). */
function debugOn(): boolean {
  try {
    return window.localStorage.getItem("aria.syncDebug") === "1";
  } catch {
    return false;
  }
}

/** Safari, and every browser on an iPhone. */
function isWebKit(): boolean {
  return /^((?!chrome|chromium|android|edg).)*safari/i.test(navigator.userAgent);
}

/** The layer beside the board that holds the writing in WebKit: one per board, under the player's controls. */
function webkitLayer(svg: SVGSVGElement): HTMLElement {
  const next = svg.nextElementSibling;
  if (next instanceof HTMLElement && next.hasAttribute("data-blocks-layer")) return next;
  const layer = document.createElement("div");
  layer.setAttribute("data-blocks-layer", "");
  layer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
  svg.after(layer);
  return layer;
}

/**
 * WEBKIT PAINTS HTML INSIDE AN SVG IN THE WRONG PLACE once the HTML scrolls or has positioned parts, and maths
 * always does: the whole column landed over the title and the picture, and could not scroll (measured in
 * WebKit, 2026-11-09). There the writing sits in a plain HTML layer that follows the board's position on screen
 * every frame, with the board's own colours.
 */
function WebKitBlocks({ rect, children }: { rect: { x: number; y: number; w: number; h: number }; children: ReactNode }) {
  const anchor = useRef<SVGRectElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const svg = anchor.current?.ownerSVGElement;
    if (svg) setHost(webkitLayer(svg));
  }, []);
  useEffect(() => {
    if (!host) return;
    let frame = 0, last = "";
    const follow = () => {
      frame = requestAnimationFrame(follow);
      const a = anchor.current, el = holder.current, svg = a?.ownerSVGElement;
      const m = a?.getScreenCTM();
      if (!a || !el || !svg || !m) return;
      const at = host.getBoundingClientRect();
      const look = getComputedStyle(svg);
      const now = `matrix(${m.a},${m.b},${m.c},${m.d},${m.a * rect.x + m.c * rect.y + m.e - at.left},${m.b * rect.x + m.d * rect.y + m.f - at.top})|${look.filter}|${look.opacity}`;
      if (now === last) return;
      last = now;
      const [transform, filter, opacity] = now.split("|");
      el.style.transform = transform;
      el.style.filter = filter === "none" ? "" : filter;
      el.style.opacity = opacity;
      el.className = a.closest(".cv-course") ? "cv-course" : "";
      el.style.fontFamily = getComputedStyle(a).fontFamily;
      const key = look.getPropertyValue("--cv-key");
      if (key) el.style.setProperty("--cv-key", key);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [host, rect.x, rect.y]);
  return (
    <>
      <rect ref={anchor} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" data-no-marker="" data-blocks="" />
      {host && createPortal(<div ref={holder} style={{ position: "absolute", left: 0, top: 0, width: rect.w, height: rect.h, transformOrigin: "0 0", pointerEvents: "auto" }}>{children}</div>, host)}
    </>
  );
}

/**
 * THE FULL BOARD'S WRITING (lib/canvas/blocks.ts) on the board: every block in full, each piece appearing as
 * Aria says it. `clock` is the audio's own (the sentence playing + how far through it), so a pause or an
 * interruption holds the writing exactly where her voice stopped. What does not fit scrolls, following her
 * and keeping everything above it; nothing is cut.
 */
export function BlocksView({ mark, shownThrough, sentenceProgress, live, reducedMotion }: { mark: BlocksMark; shownThrough: number; sentenceProgress: number; live: boolean; reducedMotion: boolean }) {
  const timed = useMemo(() => mark.blocks.map((block) => ({ block, units: revealUnits(block) })), [mark.blocks]);
  const clock = live && Number.isFinite(shownThrough) ? shownThrough + Math.min(0.999, Math.max(0, sentenceProgress)) : Infinity;
  const box = useRef<HTMLDivElement>(null);
  const followAfter = useRef(0);
  const [debug, setDebug] = useState<{ last: number; median: number; n: number } | null>(null);
  const late = useRef<number[]>([]);
  const seen = useRef(0);

  const shown = timed.map((t) => shownCount(t.units, clock));
  const total = shown.reduce((a, b) => a + b, 0);

  // Follow her: the newest piece stays in the lower part of the board.
  const follow = useCallback(() => {
    const el = box.current;
    if (!el || Date.now() < followAfter.current) return;
    const units = el.querySelectorAll<HTMLElement>("[data-bk-unit]");
    const last = units[units.length - 1];
    if (!last) return;
    const top = last.getBoundingClientRect().top - el.getBoundingClientRect().top;
    const scale = el.getBoundingClientRect().height / Math.max(1, el.offsetHeight);
    const under = top / (scale || 1) + last.offsetHeight - el.clientHeight * 0.82;
    if (under > 4) el.scrollBy({ top: under, behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion]);
  useEffect(() => { follow(); }, [total, follow]);

  // Once the student stops scrolling, it catches up by itself: waiting for her next words left it behind.
  const catchUp = useRef(0);
  useEffect(() => () => window.clearTimeout(catchUp.current), []);
  const studentScrolled = () => {
    followAfter.current = Date.now() + FOLLOW_AGAIN_MS;
    window.clearTimeout(catchUp.current);
    catchUp.current = window.setTimeout(follow, FOLLOW_AGAIN_MS + 50);
  };

  // How far past its moment each new piece appeared, at a typical sentence's length.
  useEffect(() => {
    if (!Number.isFinite(clock) || total <= seen.current) { seen.current = total; return; }
    if (!debugOn()) { seen.current = total; return; }
    const flat = timed.flatMap((t) => t.units);
    const order = [...flat].sort((a, b) => a.at - b.at);
    for (const unit of order.slice(seen.current, total)) {
      late.current.push(Math.max(0, (clock - unit.at) * 4500));
      // The sync check (scripts/qa/block-sync.mts) compares these with when the audio really reached each piece.
      const log = ((window as unknown as { __blockLog?: unknown[] }).__blockLog ??= []);
      log.push({ section: mark.blocks[0]?.section_id, key: unit.key, at: unit.at, t: performance.now() });
    }
    seen.current = total;
    const sorted = [...late.current].sort((a, b) => a - b);
    const stats = { last: late.current[late.current.length - 1], median: sorted[Math.floor(sorted.length / 2)], n: sorted.length };
    (window as unknown as { __blockSync?: typeof stats }).__blockSync = stats;
    setDebug(stats);
  }, [total, clock, timed]);

  const [webkit, setWebkit] = useState(false);
  useLayoutEffect(() => { setWebkit(isWebKit()); }, []);
  const writing = (
    <div
      ref={box}
      className={`bk-board ${mark.rect.w > 600 ? "bk-wide" : ""}`}
      style={{ width: mark.rect.w, height: mark.rect.h }}
      onWheel={(e) => { e.stopPropagation(); studentScrolled(); }}
      onPointerDown={(e) => { e.stopPropagation(); studentScrolled(); }}
    >
      {timed.map(({ block, units }, i) => (shown[i] > 0 ? <BlockView key={block.id} block={block} units={units} shown={shown[i]} /> : null))}
      {debug && <div className="bk-debug">sync: last {Math.round(debug.last)} ms · median {Math.round(debug.median)} ms · {debug.n} pieces</div>}
    </div>
  );
  if (webkit) return <WebKitBlocks rect={mark.rect}>{writing}</WebKitBlocks>;
  return (
    <foreignObject x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} className="cv-in" data-no-marker="" data-blocks="">
      {writing}
    </foreignObject>
  );
}
