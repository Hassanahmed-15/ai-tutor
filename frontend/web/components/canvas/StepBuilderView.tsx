"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import type { Mark } from "@/lib/canvas/layout";
import { stateTimes } from "@/lib/canvas/livingTiming";
import { reportEquationRemaining } from "@/lib/canvas/penClock";
import { isWebKit, WebKitHtml } from "./webkitHtml";

/**
 * THE STEP-BY-STEP BUILDER (owner, 2026-11-14: maths courses like every other course, "just the equation should have
 * something new", "problems and examples step by step"). A maths course board's working, line under line:
 *   - each line comes when Aria says it (the step's place in its sentence, lib/canvas/livingTiming.ts), under the one
 *     before — nothing changes in place, so the student can always read back up;
 *   - in the new line, the part that CHANGED from the line above is lit gold (the step's highlight, or else every term
 *     the line above did not have);
 *   - the operation that gave the line is written beside it ("÷ 2 both sides", "expand the brackets") — the step's caption;
 *   - the answer, once reached, is boxed.
 * The player holds the board until the last line has come and been read (lib/canvas/penClock.ts).
 * Nothing here knows any topic: it reads the board's own terms and steps.
 */
type LivingMark = Extract<Mark, { type: "living" }>;

const CHALK = "#E9EBF0";
const GOLD = "var(--cv-gold, #F5C451)";
const html = (tex: string | undefined, text: string) => katex.renderToString(tex ?? text.replace(/([{}#$%&_])/g, "\\$1"), { throwOnError: false, output: "html" });
const norm = (t: { tex?: string; text: string } | undefined) => (t?.tex ?? t?.text ?? "").replace(/\s+/g, "");
/** Each line is held this long before the next comes, when several are due together. */
const HOLD_MS = 1500;

export function StepBuilderView({ mark, shownThrough, sentenceProgress = 0, reducedMotion }: { mark: LivingMark; shownThrough: number; sentenceProgress?: number; reducedMotion: boolean }) {
  const tokens = useMemo(() => new Map(mark.tokens.map((t) => [t.id, t])), [mark.tokens]);
  // A step may hold several equations joined by "," or ";" ("h² = 225, h = 15"): each is its own line, in order.
  const lines = useMemo(() => mark.steps.flatMap((st) => {
    const out: string[][] = [[]];
    st.order.forEach((id) => {
      const t = tokens.get(id);
      if (!t) return;
      if (/^[,;]$/.test(t.text.trim())) { if (out[out.length - 1].length) out.push([]); return; }
      out[out.length - 1].push(id);
    });
    return out.filter((c) => c.length).map((order, k) => ({ ...st, order, caption: k === 0 ? st.caption : undefined }));
  }), [mark.steps, tokens]);

  // Where her voice is, and which line that has reached.
  const clock = Number.isFinite(shownThrough) ? shownThrough + Math.min(0.999, Math.max(0, sentenceProgress)) : 1e6;
  const times = useMemo(() => stateTimes(lines), [lines]);
  const target = times.reduce((k, t, i) => (t <= clock ? i : k), -1);
  const [current, setCurrent] = useState(-1);
  const due = useRef({ target, current, shownAt: 0 });
  due.current.target = target;
  const live = Number.isFinite(shownThrough);
  useEffect(() => {
    if (!live) return;
    return reportEquationRemaining(() => {
      const { target: t, current: c, shownAt } = due.current;
      return Math.max(0, t - c) * HOLD_MS + Math.max(0, shownAt + 1500 - performance.now());
    });
  }, [live]);
  useEffect(() => { due.current.current = current; due.current.shownAt = performance.now(); }, [current]);
  useEffect(() => {
    if (target === current) return;
    if (reducedMotion || target < current || target - current > 3) { setCurrent(target); return; }
    const t = window.setTimeout(() => setCurrent((c) => Math.min(target, c + 1)), current < 0 ? 0 : HOLD_MS);
    return () => window.clearTimeout(t);
  }, [target, current, reducedMotion]);

  // What changed in each line: its highlight, or every term the line above did not have.
  const changed = useMemo(() => lines.map((ln, k) => {
    if (k === 0) return new Set<string>();
    if (ln.highlight?.length) return new Set(ln.highlight.filter((id) => ln.order.includes(id)));
    const before = new Map<string, number>();
    for (const id of lines[k - 1].order) before.set(norm(tokens.get(id)), (before.get(norm(tokens.get(id))) ?? 0) + 1);
    const out = new Set<string>();
    for (const id of ln.order) {
      const key = norm(tokens.get(id));
      const n = before.get(key) ?? 0;
      if (n > 0) before.set(key, n - 1);
      else if (!/^[=+−×÷<>≤≥≈-]$/.test(tokens.get(id)?.text.trim() ?? "")) out.add(id);
    }
    return out;
  }), [lines, tokens]);

  const shown = current < 0 ? [] : lines.slice(0, current + 1);
  const last = current === lines.length - 1 && current > 0;
  // Fit: a type size the lines fit at, width and height; the oldest lines step out when there are too many.
  const col = useRef<HTMLDivElement>(null);
  const base = Math.min(38, Math.max(20, mark.rect.w / 15));
  const [size, setSize] = useState(base);
  const rows = Math.max(1, shown.length);
  const tall = Math.max(14, Math.min(size, (mark.rect.h - 30) / (rows * 1.95)));
  const fitsRows = Math.max(1, Math.floor((mark.rect.h - 30) / (16 * 1.95)));
  const visible = shown.slice(-fitsRows);
  // Every line must fit its OWN column (measured, not estimated): the widest overflow sets the size, until all fit.
  useLayoutEffect(() => {
    const box = col.current;
    if (!box) return;
    const ratio = Math.min(1, ...[...box.querySelectorAll<HTMLElement>(".sb-eq")].map((e) => (e.clientWidth > 0 ? e.clientWidth / Math.max(e.scrollWidth, 1) : 1)));
    if (ratio < 0.999 && size > 14) setSize(Math.max(14, Math.floor(size * ratio * 0.97)));
  }, [shown.length, size, mark.rect.w]);

  const [webkit, setWebkit] = useState(false);
  useLayoutEffect(() => { setWebkit(isWebKit()); }, []);
  const body = (
    <div style={{ width: mark.rect.w, height: mark.rect.h, display: "flex", flexDirection: "column", justifyContent: "center", color: CHALK, fontVariantLigatures: "none" }} data-step-builder="" data-step={current}>
      <style>{CSS}</style>
      <div ref={col} className="sb-col" style={{ fontSize: tall }}>
        {visible.map((ln) => {
          const k = shown.indexOf(ln);
          const newest = k === current;
          const isAnswer = last && newest;
          return (
            <div key={`${k}-${ln.order.join(".")}`} className={`sb-row${newest && !reducedMotion ? " sb-in" : ""}`} style={{ opacity: newest ? 1 : 0.78 }} data-line={k}>
              <div className={isAnswer ? "sb-eq sb-answer" : "sb-eq"}>
                {ln.order.map((id) => {
                  const t = tokens.get(id)!;
                  const lit = changed[k].has(id);
                  return <span key={id} className={lit ? (newest ? "sb-t sb-lit" : "sb-t sb-was") : "sb-t"} dangerouslySetInnerHTML={{ __html: html(t.tex, t.text) }} />;
                })}
              </div>
              <div className="sb-note">{ln.caption ? <><span className="sb-arrow">←</span>{ln.caption}</> : null}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
  if (webkit) return <WebKitHtml rect={mark.rect}>{body}</WebKitHtml>;
  return (
    <foreignObject x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} data-no-marker="" className="cv-in">
      {body}
    </foreignObject>
  );
}

const CSS = `
.sb-col { display: flex; flex-direction: column; gap: .55em; padding: 0 14px; font-family: KaTeX_Main, "Times New Roman", serif; }
.sb-row { display: grid; grid-template-columns: minmax(0, 66%) minmax(0, 34%); align-items: center; column-gap: 14px; transition: opacity .5s; }
.sb-in { animation: sb-in .55s ease-out both; }
@keyframes sb-in { from { opacity: 0; transform: translateY(.5em); } to { opacity: 1; transform: none; } }
.sb-eq { display: flex; flex-wrap: nowrap; align-items: baseline; justify-content: flex-start; column-gap: .3em; white-space: nowrap; padding: .12em .4em; border-radius: 12px; border: 2px solid transparent; overflow: hidden; min-width: 0; }
.sb-answer { border-color: rgba(245, 196, 81, .85); box-shadow: 0 0 16px rgba(245, 196, 81, .2); }
.sb-t { display: inline-block; transition: color .4s; }
.sb-t .katex { font-size: 1em; color: inherit; }
.sb-lit { color: ${GOLD}; text-shadow: 0 0 12px rgba(245, 196, 81, .35); }
.sb-was { color: rgba(245, 196, 81, .72); }
.sb-note { font: 600 clamp(14px, .55em, 20px)/1.25 "Aria Board", "Nunito", system-ui, sans-serif; color: #aeb4c2; white-space: normal; }
.sb-arrow { color: ${GOLD}; margin-right: .4em; }
`;
