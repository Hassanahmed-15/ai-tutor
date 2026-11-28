"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Mark } from "@/lib/canvas/layout";
import { revealUnits } from "@/lib/canvas/blocks";
import { leadFirstPieces, markTextStart, pieceSentences, reportBoardText, textStartOf } from "@/lib/canvas/textLead";

/**
 * WHEN EACH SENTENCE'S WRITING REALLY STARTS, on the live board (lib/canvas/textLead.ts: text first, her
 * voice TEXT_LEAD_MS later). Not a timer: the first frame on which a piece of the sentence is VISIBLE —
 * in view of the camera, faded up (a `cv-in` entrance starts at opacity 0), not still covered by the
 * marker (its wipe clip or its trace dash) — whatever drew it: a note, a table, KaTeX, a sticky note, a flow
 * node, a picture, the pen. The player holds her voice until then.
 *
 * A piece belongs to its mark's sentence (`data-s`), or to the board's sentence when it appeared, whichever
 * is later (parts timed later inside one mark). The heading (before every sentence) counts for the first
 * sentence only when it is drawn after that sentence's cue (the pen writes it then); shown with the board,
 * it is not that sentence's writing.
 */
const DRAWN = "text, foreignObject, image, path, line, polyline, polygon, circle, ellipse, rect";
/** A piece not visible after this long is no longer watched (ms). */
const WATCH_MS = 8000;
/** A shape seen with its sentence's writing still to come counts after this long without it (ms). */
const SHAPE_GRACE_MS = 700;
/** At most this many pieces are looked at per frame. */
const PER_FRAME = 80;

export function TextStartWatch({ panelKey, sentence, marks, pen }: { panelKey: string; sentence: number; marks: Mark[]; /** The marker writes this board (its heading is drawn after the first cue). */ pen: boolean }) {
  const ref = useRef<SVGGElement>(null);
  const sentenceRef = useRef(sentence);
  const marksRef = useRef(marks);
  const penRef = useRef(pen);
  // Before the MutationObserver hears of this render's new pieces (its callback runs after layout effects).
  useLayoutEffect(() => {
    sentenceRef.current = sentence;
    marksRef.current = marks;
    penRef.current = pen;
  }, [sentence, marks, pen]);

  useEffect(() => {
    // A full board's pieces start sentences of their own inside one mark (BlocksView).
    let pieces: { marks: Mark[]; sentences: Set<number> } | null = null;
    const pieceStarts = () => {
      if (pieces?.marks !== marksRef.current) {
        const all = new Set<number>();
        for (const m of marksRef.current) if (m.type === "blocks") for (const b of m.blocks) for (const s of pieceSentences(leadFirstPieces(revealUnits(b)))) all.add(s);
        pieces = { marks: marksRef.current, sentences: all };
      }
      return pieces.sentences;
    };
    return reportBoardText(panelKey, (s) => marksRef.current.some((m) => m.s === s || (s === 0 && penRef.current && m.type === "heading")) || pieceStarts().has(s));
  }, [panelKey]);

  useEffect(() => {
    const board = ref.current?.parentElement as unknown as SVGGElement | null;
    const svg = board?.ownerSVGElement;
    if (!board || !svg || typeof MutationObserver === "undefined") return;
    /** `text`: writing (text, KaTeX, an HTML block). A sentence's start is its first writing seen, when it has any. */
    type Piece = { s: number; since: number; text: boolean };
    const pending = new Map<Element, Piece>();
    // Kept by the registry, so a replay of the board (the player clears it) is watched anew.
    const marked = { has: (s: number) => textStartOf(panelKey, s) !== null };
    let raf = 0;

    const consider = (el: Element) => {
      if (pending.has(el) || el.closest("[data-marker-tip]") || el === ref.current) return;
      // Inside an HTML block (KaTeX lines, a living equation, the full board): the HTML piece added is the writing.
      const html = el.namespaceURI === "http://www.w3.org/1999/xhtml";
      if (!html && el.matches("text") && el.closest("foreignObject")) return;
      if (html && (!(el.textContent ?? "").trim() || el.closest(".bk-debug"))) return;
      // Inside a full-board piece already up (a word lit as she names it), not new writing: the piece is.
      if (html && el.parentElement?.closest("[data-bk-unit]")) return;
      if (el.matches("rect") && Number(el.getAttribute("width")) >= 900) return;
      if (el.matches("text, foreignObject") && !(el.textContent ?? "").trim()) return;
      const owner = el.closest("[data-s]");
      if (!owner || !board.contains(owner)) return;
      const ds = Number(owner.getAttribute("data-s"));
      if (!Number.isFinite(ds)) return;
      const s = Math.max(ds, sentenceRef.current);
      if (s >= 0 && marked.has(s)) return;
      pending.set(el, { s, since: performance.now(), text: html || el.matches("text, foreignObject") });
    };
    const hidden = (el: Element, view: DOMRect): boolean => {
      const r = el.getBoundingClientRect();
      if ((r.width < 0.5 && r.height < 0.5) || r.right < view.left || r.bottom < view.top || r.left > view.right || r.top > view.bottom) return true;
      const g = el as SVGGraphicsElement;
      // The marker's trace: still all dash gap.
      if (g.style?.strokeDasharray) {
        const len = parseFloat(g.style.strokeDasharray);
        if (len > 0 && parseFloat(getComputedStyle(g).strokeDashoffset || "0") >= len * 0.98) return true;
      }
      let opacity = 1;
      for (let e: Element | null = el; e && e !== svg; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden") return true;
        opacity *= Number(cs.opacity || 1);
        // The marker's wipe: inset(top RIGHT …) — still covered while RIGHT is ~100%.
        const wipe = /inset\(\s*[-\d.]+%\s+([-\d.]+)%/.exec(cs.clipPath || "");
        if (wipe && Number(wipe[1]) > 97) return true;
      }
      return opacity < 0.05;
    };
    /*
     * A shape seen first (an arrow's line before its label, a box before its words) does not start the
     * sentence while its writing is still on the way — her voice would then come before the words. It does
     * once SHAPE_GRACE_MS has passed with no writing (writing that never shows must not hold her).
     */
    const shapeSeen = new Map<number, number>();
    const textWaiting = (s: number, now: number) => {
      for (const [el, p] of pending) if (p.text && p.s === s && el.isConnected && now - p.since <= WATCH_MS) return true;
      return false;
    };
    const frame = () => {
      raf = 0;
      const now = performance.now();
      const view = svg.getBoundingClientRect();
      for (const [s, t] of shapeSeen) {
        if (marked.has(s)) shapeSeen.delete(s);
        else if (now - t >= SHAPE_GRACE_MS || !textWaiting(s, now)) {
          shapeSeen.delete(s);
          markTextStart(panelKey, s, now - t >= SHAPE_GRACE_MS ? now : t);
        }
      }
      let looked = 0;
      for (const [el, piece] of pending) {
        if (looked++ >= PER_FRAME) break;
        if (!el.isConnected || now - piece.since > WATCH_MS || (piece.s >= 0 && marked.has(piece.s))) {
          pending.delete(el);
          continue;
        }
        if (hidden(el, view)) continue;
        pending.delete(el);
        // The heading: the first sentence's writing only when drawn after its cue.
        const s = piece.s >= 0 ? piece.s : sentenceRef.current >= 0 ? 0 : -1;
        if (s < 0 || marked.has(s)) continue;
        if (!piece.text && textWaiting(s, now)) {
          if (!shapeSeen.has(s)) shapeSeen.set(s, now);
          continue;
        }
        markTextStart(panelKey, s, now);
      }
      // Pieces looked at go to the back, so every one is reached.
      if (pending.size > PER_FRAME) for (const [el, piece] of [...pending].slice(0, PER_FRAME)) { pending.delete(el); pending.set(el, piece); }
      if (pending.size || shapeSeen.size) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (!raf && pending.size) raf = requestAnimationFrame(frame);
    };
    const add = (nodes: Element[]) => {
      for (const n of nodes) {
        if (n.matches(DRAWN) || (n.namespaceURI === "http://www.w3.org/1999/xhtml" && n.closest("foreignObject"))) consider(n);
        n.querySelectorAll?.(DRAWN).forEach(consider);
      }
      wake();
    };
    add([board]);
    const XHTML = "http://www.w3.org/1999/xhtml";
    const observer = new MutationObserver((records) => {
      add(records.flatMap((r) => Array.from(r.addedNodes)).filter((n): n is Element => n instanceof Element));
      // A full board's piece switched on in place (BlocksView gives it data-bk-unit as it turns on) is new
      // writing too, of the sentence it is switched on in.
      const switched = records.filter((r) => r.type === "attributes" && r.oldValue === null && r.target instanceof Element && r.target.namespaceURI === XHTML).map((r) => r.target as Element);
      for (const el of new Set(switched)) {
        pending.delete(el);
        consider(el);
      }
      if (switched.length) wake();
    });
    observer.observe(board, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["data-bk-unit"] });
    // A new cue re-reads what is waiting: a piece already there (a mark timed inside) may now be due.
    const recheck = window.setInterval(() => {
      if (pending.size) wake();
    }, 250);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      window.clearInterval(recheck);
    };
  }, [panelKey]);

  return <g ref={ref} data-no-marker="" aria-hidden="true" />;
}
