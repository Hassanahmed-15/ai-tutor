"use client";

import { useEffect, useRef } from "react";
import { resolveWritings, type Box, type Point, type Scene } from "@/lib/canvas/textDeconflict";

/**
 * NO WRITING ON WRITING, on the live board (owner, 2026-10-21). Reads what is really drawn — every
 * word, label and line in board units — and moves a free label that lands on other writing (or has a
 * line through it) to the nearest clear spot (lib/canvas/textDeconflict.ts). Free labels also get a
 * halo of board colour, so a line passing behind a label stops short of its letters (the
 * cartographers' halo).
 *
 * What may move: labels on figures, sketches, graphs and arrows; a note or callout as a whole; a
 * sketch's writing or working as one piece. What never moves: headings, equations, code, tables,
 * nodes and structures, and any word inside its own shape (a gate's name, a box's text).
 */

/** Mark kinds whose single labels are free to give way. */
const MOVABLE_KINDS = new Set(["figure", "figure-label", "sketch", "graph", "arrow", "link", "picture", "free-body", "text"]);
/** Mark kinds that move as one piece. */
const GROUP_KINDS = new Set(["note", "callout"]);
const BOARD_AREA = 1000 * 560;
const TRANSPARENT = /^(none|transparent)$|rgba\([^)]*,\s*0\)$/;
const PEN_MARKS = ".cv-swipe, .cv-tap, .cv-outline, .cv-ring";
const BOUNDS: Box = { x: 6, y: 6, w: 988, h: 548 };
/** A moved label glides there; nothing is measured while it does. */
const GLIDE_MS = 360;

type Unit = { el: SVGGraphicsElement; box: Box; movable: boolean; lastResort: boolean; order: number; halo: Element[] };

export function TextDeconflict() {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const self = ref.current;
    const board = self?.parentElement as unknown as SVGGraphicsElement | null;
    if (!self || !board || typeof MutationObserver === "undefined") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    /** Each moved piece's total move so far, in board units. */
    const offsets = new WeakMap<Element, Point>();
    /** Each line's sampled points in its own units, kept while its geometry is unchanged. */
    const samples = new WeakMap<Element, { key: string; pts: Point[] }>();
    let busyUntil = 0;
    let timer = 0;

    const run = () => {
      if (document.hidden) return;
      const now = performance.now();
      if (now < busyUntil) {
        schedule(busyUntil - now + 20);
        return;
      }
      const ctm = board.getScreenCTM();
      if (!ctm) return;
      const inv = ctm.inverse();
      const toBoard = (r: DOMRect): Box => {
        const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
        const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
        return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      };
      const seen = new Map<Element, boolean>();
      const visible = (el: Element | null): boolean => {
        if (!el || el === board) return true;
        const known = seen.get(el);
        if (known !== undefined) return known;
        const cs = getComputedStyle(el);
        const v = cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) >= 0.15 && visible(el.parentElement);
        seen.set(el, v);
        return v;
      };

      // Shapes: containers (a word inside one is part of it) and filled areas (a moved label avoids them).
      const containers: Box[] = [];
      const fills: Box[] = [];
      board.querySelectorAll("rect, circle, ellipse, polygon, path").forEach((el) => {
        if (el.closest("foreignObject, [data-no-marker]") || !visible(el)) return;
        const cs = getComputedStyle(el);
        const fill = !TRANSPARENT.test(cs.fill);
        const stroke = !TRANSPARENT.test(cs.stroke) && parseFloat(cs.strokeWidth || "0") > 0;
        if (!fill && !stroke) return;
        const b = toBoard(el.getBoundingClientRect());
        if (b.w * b.h < 120 || b.w >= 900 || b.w * b.h > BOARD_AREA * 0.15) return;
        const closed = !el.matches("path") || /z\s*$/i.test(el.getAttribute("d") ?? "");
        if (closed && (fill || stroke)) containers.push(b);
        if (fill) fills.push(b);
      });
      const enclosed = (b: Box) =>
        containers.some((c) => {
          const ix = Math.min(b.x + b.w, c.x + c.w) - Math.max(b.x, c.x);
          const iy = Math.min(b.y + b.h, c.y + c.h) - Math.max(b.y, c.y);
          return ix > 0 && iy > 0 && (ix * iy) / Math.max(1, b.w * b.h) >= 0.75 && c.w * c.h > b.w * b.h * 1.3;
        });

      // Writing, gathered into the pieces that move together.
      const units = new Map<Element, Unit>();
      let order = 0;
      const add = (el: Element, box: Box, own: SVGGraphicsElement) => {
        if (box.w <= 1) return;
        const unitEl = el.closest("[data-text-unit]");
        const kindEl = el.closest("[data-kind]");
        const kind = kindEl?.getAttribute("data-kind") ?? "";
        let unit: SVGGraphicsElement = own;
        let movable: boolean;
        let lastResort = false;
        if (unitEl && board.contains(unitEl)) {
          unit = unitEl as SVGGraphicsElement;
          movable = unitEl.getAttribute("data-text-unit") === "move";
        } else if (kindEl && GROUP_KINDS.has(kind)) {
          unit = kindEl as SVGGraphicsElement;
          movable = true;
        } else {
          const stroked = own.matches("text") && !TRANSPARENT.test(getComputedStyle(own).stroke) && !own.hasAttribute("data-halo");
          movable = MOVABLE_KINDS.has(kind) && !enclosed(box) && !stroked;
          lastResort = MOVABLE_KINDS.has(kind) && !movable && !stroked;
        }
        const u = units.get(unit);
        if (u) {
          const x = Math.min(u.box.x, box.x), y = Math.min(u.box.y, box.y);
          u.box = { x, y, w: Math.max(u.box.x + u.box.w, box.x + box.w) - x, h: Math.max(u.box.y + u.box.h, box.y + box.h) - y };
          u.movable = u.movable && movable;
          u.lastResort = u.lastResort && lastResort;
          if (movable) u.halo.push(own);
        } else units.set(unit, { el: unit, box, movable, lastResort, order: order++, halo: movable ? [own] : [] });
      };
      board.querySelectorAll("text, foreignObject").forEach((el) => {
        if (self.contains(el) || el.closest("[data-no-marker]") || !visible(el)) return;
        if (el.matches("text")) {
          if (el.closest("foreignObject") || !el.textContent?.trim()) return;
          add(el, toBoard(el.getBoundingClientRect()), el as SVGGraphicsElement);
        } else {
          const inner = el.querySelector("[data-ink-content]") ?? el.querySelector(".katex") ?? el.firstElementChild;
          if (!inner?.textContent?.trim()) return;
          add(el, toBoard(inner.getBoundingClientRect()), el as SVGGraphicsElement);
        }
      });
      const list = [...units.values()];
      for (const u of list) for (const h of u.halo) if (!h.hasAttribute("data-halo")) h.setAttribute("data-halo", "");
      if (!list.some((u) => u.movable || u.lastResort)) return;

      // Lines (as the QA checker samples them), each tagged with the piece it belongs to.
      const ink: Scene["ink"] = [];
      board.querySelectorAll("path, line, polyline").forEach((el) => {
        if (self.contains(el) || el.closest("foreignObject, [data-no-marker]") || el.matches(PEN_MARKS) || !visible(el)) return;
        const cs = getComputedStyle(el);
        if (TRANSPARENT.test(cs.stroke) || Number(cs.strokeOpacity) * Number(cs.opacity) < 0.4 || parseFloat(cs.strokeWidth) < 1.5) return;
        const g = el as SVGGeometryElement;
        const key = `${el.getAttribute("d") ?? ""}|${el.getAttribute("points") ?? ""}|${el.getAttribute("x1")},${el.getAttribute("y1")},${el.getAttribute("x2")},${el.getAttribute("y2")}`;
        let s = samples.get(el);
        if (!s || s.key !== key) {
          let len = 0;
          try {
            len = g.getTotalLength();
          } catch {
            return;
          }
          if (!len || len > 4000) return;
          const pts: Point[] = [];
          for (let k = 0; k <= 40; k++) {
            const p = g.getPointAtLength((len * k) / 40);
            pts.push({ x: p.x, y: p.y });
          }
          s = { key, pts };
          samples.set(el, s);
        }
        const m = g.getScreenCTM();
        if (!m) return;
        const owner = list.findIndex((u) => u.el.contains(el));
        ink.push({ owner: owner >= 0 ? owner : null, pts: s.pts.map((p) => new DOMPoint(p.x, p.y).matrixTransform(m).matrixTransform(inv)) });
      });

      const moves = resolveWritings({ writings: list.map((u, i) => ({ id: i, box: u.box, movable: u.movable, lastResort: u.lastResort, order: u.order })), ink, fills, bounds: BOUNDS });
      if (!moves.length) return;
      for (const mv of moves) {
        const el = list[mv.id].el;
        const prev = offsets.get(el) ?? { x: 0, y: 0 };
        const total = { x: prev.x + mv.dx, y: prev.y + mv.dy };
        offsets.set(el, total);
        // CSS `translate` is in the parent's units: turn the board-unit move into them.
        const parent = el.parentNode as SVGGraphicsElement | null;
        const pm = parent?.getScreenCTM?.();
        if (!pm) continue;
        const toLocal = pm.inverse().multiply(ctm);
        const lx = toLocal.a * total.x + toLocal.c * total.y;
        const ly = toLocal.b * total.x + toLocal.d * total.y;
        // Not yet drawn (the marker is still to write it): it simply starts in its new place.
        const drawn = !el.style.clipPath;
        if (!reduced && drawn && !/translate/.test(el.style.transition)) {
          el.style.transition = [el.style.transition, `translate ${GLIDE_MS}ms cubic-bezier(.2,.8,.2,1)`].filter(Boolean).join(", ");
        }
        el.style.translate = `${lx.toFixed(2)}px ${ly.toFixed(2)}px`;
      }
      busyUntil = performance.now() + GLIDE_MS + 40;
      (window as unknown as { __cvDeconflict?: number }).__cvDeconflict = ((window as unknown as { __cvDeconflict?: number }).__cvDeconflict ?? 0) + moves.length;
    };

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, ms);
    };
    // New writing: placed at once (before the marker writes it), then again once its entrance settles.
    let settle = 0;
    const observer = new MutationObserver((records) => {
      if (records.every((r) => self.contains(r.target))) return;
      requestAnimationFrame(run);
      window.clearTimeout(settle);
      settle = window.setTimeout(run, 620);
    });
    observer.observe(board, { childList: true, subtree: true });
    // Fonts, KaTeX and timed figure parts change sizes without adding nodes: a slow look-over too.
    const every = window.setInterval(run, 1400);
    requestAnimationFrame(run);
    return () => {
      observer.disconnect();
      window.clearInterval(every);
      window.clearTimeout(timer);
      window.clearTimeout(settle);
    };
  }, []);
  return <g ref={ref} data-no-marker="" style={{ display: "none" }} />;
}
