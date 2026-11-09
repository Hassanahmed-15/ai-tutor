"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Safari, and every browser on an iPhone. */
export function isWebKit(): boolean {
  return typeof navigator !== "undefined" && /^((?!chrome|chromium|android|edg).)*safari/i.test(navigator.userAgent);
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
export function WebKitHtml({ rect, blocks = false, children }: { rect: { x: number; y: number; w: number; h: number }; blocks?: boolean; children: ReactNode }) {
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
      // What fades the board or one term of it fades this too.
      // Only the board in play: this layer lies over the whole board, so another board's writing would show through it.
      let faded = a.closest('[data-live="true"]') ? Number(look.opacity) : 0;
      for (let e: Element | null = a.parentElement; e && e !== svg; e = e.parentElement) faded *= Number(getComputedStyle(e).opacity);
      const now = `matrix(${m.a},${m.b},${m.c},${m.d},${m.a * rect.x + m.c * rect.y + m.e - at.left},${m.b * rect.x + m.d * rect.y + m.f - at.top})|${look.filter}|${faded}`;
      if (now === last) return;
      last = now;
      const [transform, filter, opacity] = now.split("|");
      el.style.transform = transform;
      el.style.filter = filter === "none" ? "" : filter;
      el.style.opacity = opacity;
      el.style.visibility = opacity === "0" ? "hidden" : "";
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
      <rect ref={anchor} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" data-no-marker="" {...(blocks ? { "data-blocks": "" } : {})} />
      {host && createPortal(<div ref={holder} style={{ position: "absolute", left: 0, top: 0, width: rect.w, height: rect.h, transformOrigin: "0 0", pointerEvents: "auto" }}>{children}</div>, host)}
    </>
  );
}
