"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import type { Mark } from "@/lib/canvas/layout";
import { labPartsFor } from "@/lib/canvas/labParts";

/**
 * ONE LIVING EQUATION (owner, 2026-11-08: "mostly B … A with better labelling … a general system for
 * maths"). A maths board's working is shown as ONE line that changes in place, step by step, as Aria says
 * each step — the way an equation moves in a 3Blue1Brown video — instead of a new line per step:
 *   - a term that stays slides to its new place (the same token id, step to step);
 *   - a new term comes from the drawing when it is a part of it (CanvasBoardSpec.lab links): a copy of
 *     the part flies out of the drawing and becomes the term, the part glowing as it arrives;
 *     otherwise from the term it replaced (an expansion unfolds where the bracket was), or it fades in;
 *   - two equal terms that leave in the same step cancel: they meet and vanish;
 *   - a linked term is written in its part's colour, with the part's name under it the first time it
 *     comes, which then settles into a line in that colour;
 *   - earlier steps stay above, small and grey, so the student can look back; the last step is boxed.
 * Nothing here knows any topic: it reads the board's own terms, steps and links.
 */
type LivingMark = Extract<Mark, { type: "living" }>;

const SIGN = /^\s*(?:[=+−×÷<>≤≥≈-]|\\times|\\div|\\cdot|\\pm|\\approx|\\le|\\ge|,)\s*$/;
const html = (tex: string | undefined, text: string) => katex.renderToString(tex ?? text.replace(/([{}#$%&_])/g, "\\$1"), { throwOnError: false, output: "html" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function LivingEquationView({ mark, shownThrough, reducedMotion }: { mark: LivingMark; shownThrough: number; reducedMotion: boolean }) {
  const steps = mark.steps;
  const s = Number.isFinite(shownThrough) ? shownThrough : 1e6;
  // The step being said: the last one whose sentence has come.
  const current = steps.reduce((k, st, i) => (st.s <= s ? i : k), -1);
  const tokens = useMemo(() => new Map(mark.tokens.map((t) => [t.id, t])), [mark.tokens]);
  const links = useMemo(() => new Map(mark.links.map((l) => [l.token, l])), [mark.links]);
  const line = useRef<HTMLDivElement>(null);
  const shown = useRef<number>(-2);
  const named = useRef(new Set<string>());
  const [size, setSize] = useState(Math.min(52, Math.max(26, mark.rect.w / 12)));

  // Colours: a linked term takes its part's colour; others keep the board's.
  const colourOf = (id: string) => {
    const l = links.get(id);
    const c = l ? labPartsFor(mark.drawing)?.colour(l.objects) : null;
    return c ?? tokens.get(id)?.color ?? "#f4f4ee";
  };

  // A step may hold more than one equation, joined by "," or ";" (a said line added to it): the first is
  // the living line, the others are written small under it.
  const clausesAt = (k: number): string[][] => {
    if (k < 0) return [];
    const out: string[][] = [[]];
    for (const id of steps[k].order) {
      const t = tokens.get(id);
      if (!t) continue;
      if (/^[,;]$/.test(t.text.trim())) { if (out[out.length - 1].length) out.push([]); continue; }
      out[out.length - 1].push(id);
    }
    return out.filter((c) => c.length);
  };
  const termsAt = (k: number) => clausesAt(k)[0] ?? [];

  useLayoutEffect(() => {
    const box = line.current;
    if (!box || current === shown.current) return;
    const before = shown.current;
    shown.current = current;
    const animate = !reducedMotion && before >= -1 && current === before + 1;
    const old = new Map([...box.children].map((c) => [(c as HTMLElement).dataset.id!, c.getBoundingClientRect()]));
    const oldIds = new Set(before >= 0 ? termsAt(before) : []);
    const now = termsAt(current);
    const nowIds = new Set(now);
    // The leaving terms, before the line is rebuilt (they are animated out from where they were).
    const leaving = [...box.children].filter((c) => !nowIds.has((c as HTMLElement).dataset.id!)) as HTMLElement[];
    const ghosts = leaving.map((el) => {
      const r = el.getBoundingClientRect();
      const g = el.cloneNode(true) as HTMLElement;
      Object.assign(g.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", zIndex: "40", pointerEvents: "none" });
      return { g, r, text: tokens.get(el.dataset.id!)?.text.replace(/\s+/g, "") ?? "" };
    });
    box.replaceChildren(...now.map((id) => {
      const t = tokens.get(id)!;
      const el = document.createElement("span");
      el.dataset.id = id;
      el.className = "lv-term";
      el.innerHTML = html(t.tex, t.text);
      const sign = SIGN.test(t.tex ?? t.text);
      el.style.color = sign ? "#8b93a7" : colourOf(id);
      const l = links.get(id);
      if (l && !sign) {
        el.classList.add("lv-linked");
        if (l.name && !named.current.has(id)) {
          named.current.add(id);
          const tag = document.createElement("span");
          tag.className = "lv-tag";
          tag.textContent = l.name;
          el.append(tag);
          window.setTimeout(() => tag.classList.add("lv-settled"), animate ? 2600 : 0);
        }
      }
      if (steps[current].highlight.includes(id)) el.classList.add("lv-hi");
      return el;
    }));
    // Fit the line to its area on ONE line: smaller type before it would wrap, never under 22 (then it wraps).
    box.style.flexWrap = "nowrap";
    const w = box.scrollWidth, room = mark.rect.w * 0.9;
    const k = parseFloat(getComputedStyle(box.parentElement!).fontSize) || size;
    const fitted = w > room ? Math.max(22, Math.floor((k * room) / w)) : Math.min(k, Math.min(52, Math.max(26, mark.rect.w / 12)));
    if (fitted !== k) { box.parentElement!.style.fontSize = `${fitted}px`; setSize(fitted); }
    if (box.scrollWidth > room) box.style.flexWrap = "wrap";
    if (!animate) return;

    const parts = labPartsFor(mark.drawing);
    const born: HTMLElement[] = [];
    for (const el of [...box.children] as HTMLElement[]) {
      const was = old.get(el.dataset.id!);
      const r = el.getBoundingClientRect();
      if (was && oldIds.has(el.dataset.id!)) el.animate([{ transform: `translate(${was.left - r.left}px, ${was.top - r.top}px)` }, { transform: "none" }], { duration: 750, easing: "cubic-bezier(.6,0,.2,1)" });
      else born.push(el);
    }
    // Leaving terms: equal pairs cancel (they meet and vanish); a lone term the new ones replace opens into them; the rest fade.
    const pairs = new Set<number>();
    ghosts.forEach((a, i) => { if (pairs.has(i) || SIGN.test(a.text)) return; const j = ghosts.findIndex((b, k) => k !== i && !pairs.has(k) && b.text === a.text); if (j >= 0) { pairs.add(i); pairs.add(j); } });
    const source = ghosts.length === 1 || (ghosts.filter((g, i) => !pairs.has(i) && !SIGN.test(g.text)).length === 1) ? ghosts.find((g, i) => !pairs.has(i) && !SIGN.test(g.text)) : undefined;
    const pairList = [...pairs].map((i) => ghosts[i]);
    const meetX = pairList.length ? pairList.reduce((x, g) => x + g.r.left + g.r.width / 2, 0) / pairList.length : 0;
    ghosts.forEach((g, i) => {
      document.body.append(g.g);
      const done = () => g.g.remove();
      if (pairs.has(i)) {
        g.g.animate([{ transform: "none", color: g.g.style.color }, { transform: "translateY(-0.5em)", color: "#ff5a5a", offset: 0.3 }, { transform: `translate(${meetX - g.r.left - g.r.width / 2}px, -0.5em) scale(.2)`, opacity: 0 }], { duration: 1100, easing: "ease-in", fill: "forwards" }).onfinish = done;
      } else g.g.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-0.6em) scale(.9)" }], { duration: 500, fill: "forwards" }).onfinish = done;
    });
    (async () => {
      for (const el of born) {
        const id = el.dataset.id!;
        const l = links.get(id);
        const nodes = l && parts ? parts.nodes(l.objects) : [];
        const r = el.getBoundingClientRect();
        if (nodes.length) {
          // A copy of the part flies out of the drawing and becomes the term.
          el.style.opacity = "0";
          parts!.glow(l!.objects, true);
          for (const n of nodes) {
            const nr = n.getBoundingClientRect();
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            const ownerSvg = n.ownerSVGElement;
            if (!ownerSvg) continue;
            const or = ownerSvg.getBoundingClientRect();
            Object.assign(svg.style, { position: "fixed", left: `${or.left}px`, top: `${or.top}px`, width: `${or.width}px`, height: `${or.height}px`, overflow: "visible", pointerEvents: "none", zIndex: "40" });
            svg.setAttribute("viewBox", ownerSvg.getAttribute("viewBox") ?? `0 0 ${or.width} ${or.height}`);
            svg.append(n.cloneNode(true));
            document.body.append(svg);
            const k = Math.max(0.12, Math.min(0.7, r.height / Math.max(nr.height, 1)));
            svg.style.transformOrigin = `${nr.left - or.left + nr.width / 2}px ${nr.top - or.top + nr.height / 2}px`;
            svg.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${r.left + r.width / 2 - (nr.left + nr.width / 2)}px, ${r.top + r.height / 2 - (nr.top + nr.height / 2)}px) scale(${k})`, opacity: 0 }], { duration: 1050, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" }).onfinish = () => svg.remove();
          }
          await sleep(800);
          el.style.opacity = "";
          el.animate([{ opacity: 0, transform: "scale(1.5)" }, { opacity: 1, transform: "none" }], { duration: 420 });
          window.setTimeout(() => parts!.glow(l!.objects, false), 900);
          await sleep(250);
        } else if (source) {
          // Opens out of the term it replaces (a bracket expanding into its terms).
          el.animate([{ transform: `translate(${source.r.left + source.r.width / 2 - r.left - r.width / 2}px, ${source.r.top - r.top}px) scale(.35)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 800, easing: "cubic-bezier(.6,0,.2,1)" });
        } else {
          el.animate([{ opacity: 0, transform: "translateY(0.4em)" }, { opacity: 1, transform: "none" }], { duration: 450, delay: 80 });
          await sleep(90);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reducedMotion]);

  // Earlier steps, small above (the last three that differ from the current one).
  // Each earlier step's own equation (its first clause), shrunk to the column when it is long.
  const history = Array.from({ length: Math.max(0, current) }, (_, k) => clausesAt(k)[0] ?? []).filter((c) => c.length).map((c) => c.map((id) => tokens.get(id)!)).slice(-3);
  const last = current === steps.length - 1;
  useEffect(() => () => { shown.current = -2; }, []);

  return (
    <foreignObject x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} data-no-marker="" className="cv-in">
      <div style={{ width: mark.rect.w, height: mark.rect.h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, color: "#f4f4ee" }} data-living="" data-step={current}>
        <style>{LIVING_CSS}</style>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minHeight: 90, justifyContent: "flex-end" }}>
          {history.map((row, i) => (
            <div key={i} className="lv-history" style={{ opacity: 0.35 + (0.35 * (i + 1)) / Math.max(1, history.length) }} dangerouslySetInnerHTML={{ __html: row.map((t) => html(t.tex, t.text)).join(" ") }} />
          ))}
        </div>
        <div className={last && current > 0 ? "lv-line lv-final" : "lv-line"} style={{ fontSize: size }}>
          <div ref={line} className="lv-terms" />
        </div>
        {clausesAt(current).slice(1).map((c, i) => (
          <div key={`${current}-${i}`} className="lv-side" dangerouslySetInnerHTML={{ __html: c.map((id) => html(tokens.get(id)!.tex, tokens.get(id)!.text)).join("\u2009") }} />
        ))}
        <div style={{ minHeight: 34, fontSize: 18, color: "#aeb4c2" }}>{current >= 0 ? steps[current].caption ?? "" : ""}</div>
      </div>
    </foreignObject>
  );
}

const LIVING_CSS = `
.lv-line { position: relative; padding: 10px 22px; border-radius: 16px; border: 3px solid transparent; transition: border-color .6s, box-shadow .6s; }
.lv-final { border-color: #f2d35b; box-shadow: 0 0 22px rgba(242, 211, 91, .35); }
.lv-terms { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; column-gap: .32em; row-gap: .2em; }
.lv-term { position: relative; display: inline-block; white-space: nowrap; }
.lv-term .katex { font-size: 1em; color: inherit; }
.lv-linked::after { content: ""; position: absolute; left: 6%; right: 6%; bottom: -0.18em; height: 3px; border-radius: 2px; background: currentColor; opacity: 0; transition: opacity .5s; }
.lv-linked:has(.lv-settled)::after, .lv-linked:not(:has(.lv-tag))::after { opacity: .75; }
.lv-tag { position: absolute; left: 50%; top: 100%; transform: translate(-50%, .35em); font: 600 15px/1.1 system-ui, sans-serif; white-space: nowrap; color: currentColor; background: rgba(255,255,255,.06); border: 1px solid currentColor; border-radius: 999px; padding: 3px 9px; transition: opacity .5s, transform .5s; }
.lv-tag.lv-settled { opacity: 0; transform: translate(-50%, 0); }
.lv-hi { text-shadow: 0 0 12px currentColor; }
.lv-side { font-size: 24px; color: #c3c7d2; white-space: normal; text-align: center; max-width: 94%; animation: lv-in .6s ease-out both; }
.lv-side .katex { font-size: 1em; }
@keyframes lv-in { from { opacity: 0; transform: translateY(.4em); } to { opacity: 1; transform: none; } }
.lv-history { font-size: 20px; color: #8b8d98; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.lv-history .katex { font-size: 1em; }
`;
