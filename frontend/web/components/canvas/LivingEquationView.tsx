"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import type { Mark } from "@/lib/canvas/layout";
import { labPartsFor } from "@/lib/canvas/labParts";
import { stateTimes } from "@/lib/canvas/livingTiming";
import { reportEquationRemaining } from "@/lib/canvas/penClock";
import { isWebKit, WebKitHtml } from "./webkitHtml";

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

const CHALK = "#E9EBF0";
const ACCENT = "#F5C451";
/** The accent as the board sets it: light mode gives it a colour that turns into amber (CANVAS_CSS --cv-gold). */
const GOLD = `var(--cv-gold, ${ACCENT})`;
const SIGN = /^\s*(?:[=+−×÷<>≤≥≈-]|\\times|\\div|\\cdot|\\pm|\\approx|\\le|\\ge|,)\s*$/;
const html = (tex: string | undefined, text: string) => katex.renderToString(tex ?? text.replace(/([{}#$%&_])/g, "\\$1"), { throwOnError: false, output: "html" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function LivingEquationView({ mark, shownThrough, sentenceProgress = 0, reducedMotion }: { mark: LivingMark; shownThrough: number; sentenceProgress?: number; reducedMotion: boolean }) {
  const tokens = useMemo(() => new Map(mark.tokens.map((t) => [t.id, t])), [mark.tokens]);
  const links = useMemo(() => new Map(mark.links.map((l) => [l.token, l])), [mark.links]);
  // EACH EQUATION IS A STATE. A step may hold several, joined by "," or ";" ("h² = 289 − 64, h² = 225,
  // h = 15 m"): they come one after another within its sentence, so the newest — the answer — is the
  // living line and the ones before it go up into the history.
  const steps = useMemo(() => mark.steps.flatMap((st) => {
    const out: string[][] = [[]];
    const text = (id: string | undefined) => (id ? tokens.get(id)?.text.trim() ?? "" : "");
    st.order.forEach((id, i) => {
      const t = tokens.get(id);
      if (!t) return;
      if (/^[,;]$/.test(t.text.trim())) { if (out[out.length - 1].length) out.push([]); return; }
      // Two equations with nothing between them ("3² + 4² = 25 c = 5 cm"): a number ends the first, and a
      // letter about to be equated starts the second (lib/canvas/layout.ts does the same for written working).
      const cur = out[out.length - 1];
      if (cur.some((c) => /^[=≈]$/.test(text(c))) && /^[A-Za-z]/.test(t.text.trim()) && /^[=≈]$/.test(text(st.order[i + 1])) && /^[\d.,]+$/.test(text(st.order[i - 1]))) out.push([]);
      out[out.length - 1].push(id);
    });
    return out.filter((c) => c.length).map((order) => ({ ...st, order }));
  }), [mark.steps, tokens]);
  // Where her voice is: the sentence playing and how far through it.
  const clock = Number.isFinite(shownThrough) ? shownThrough + Math.min(0.999, Math.max(0, sentenceProgress)) : 1e6;
  // EACH STATE COMES WHEN SHE SAYS IT (lib/canvas/livingTiming.ts): at its place in its sentence, not 1.3 s
  // after the last one — that ran a sentence's steps past faster than she could talk them through.
  const times = useMemo(() => stateTimes(steps), [steps]);
  const target = times.reduce((k, t, i) => (t <= clock ? i : k), -1);
  const [current, setCurrent] = useState(-1);
  // One state at a time, each held long enough to be read (at least 1.6 s) when several are due together;
  // a jump back or far ahead goes straight there.
  // The player waits, at the end of the board, for the states still to come and a moment to read the last.
  const due = useRef({ target, current, shownAt: 0 });
  due.current.target = target;
  const live = Number.isFinite(shownThrough);
  useEffect(() => {
    if (!live) return;
    return reportEquationRemaining(() => {
      const { target: t, current: c, shownAt } = due.current;
      return Math.max(0, t - c) * 1600 + Math.max(0, shownAt + 1800 - performance.now());
    });
  }, [live]);
  useEffect(() => {
    due.current.current = current;
    due.current.shownAt = performance.now();
  }, [current]);
  useEffect(() => {
    if (target === current) return;
    if (reducedMotion || target < current || target - current > 3) { setCurrent(target); return; }
    const t = window.setTimeout(() => setCurrent((c) => Math.min(target, c + 1)), current < 0 ? 0 : 1600);
    return () => window.clearTimeout(t);
  }, [target, current, reducedMotion]);
  const line = useRef<HTMLDivElement>(null);
  const shown = useRef<number>(-2);
  const named = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const [size, setSize] = useState(Math.min(52, Math.max(26, mark.rect.w / 12)));

  // ONE CHALK WHITE for every term (owner, 2026-11-08: "I don't like the text being colourful"); the gold
  // accent is kept for the term being talked about and its part of the drawing, together.
  const colourOf = (_id: string) => CHALK;
  const termsAt = (k: number) => (k < 0 ? [] : steps[k].order);

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
      const t = tokens.get(el.dataset.id!);
      return { g, r, text: t?.text.replace(/\s+/g, "") ?? "", key: (t?.tex ?? t?.text ?? "").replace(/\s+/g, ""), used: false };
    });
    let tagCount = 0;
    const firstTime = new Set(now.filter((id) => !seen.current.has((tokens.get(id)?.tex ?? tokens.get(id)?.text ?? "").replace(/\s+/g, ""))));
    box.replaceChildren(...now.map((id) => {
      const t = tokens.get(id)!;
      const el = document.createElement("span");
      el.dataset.id = id;
      el.className = "lv-term";
      el.innerHTML = html(t.tex, t.text);
      const sign = SIGN.test(t.tex ?? t.text);
      el.style.color = sign ? "#8b93a7" : colourOf(id);
      if (!sign && links.has(id)) el.dataset.linked = "";
      const l = links.get(id);
      if (l && !sign) {
        el.classList.add("lv-linked");
        const key = (t.tex ?? t.text).replace(/\s+/g, "");
        if (l.name && !named.current.has(key)) {
          named.current.add(key);
          const tag = document.createElement("span");
          tag.className = tagCount++ % 2 ? "lv-tag lv-tag-up" : "lv-tag";
          tag.textContent = l.name;
          el.append(tag);
          window.setTimeout(() => tag.classList.add("lv-settled"), animate ? 2600 : 0);
        }
      }
      if (steps[current].highlight.includes(id)) el.classList.add("lv-hi");
      return el;
    }));
    for (const id of now) seen.current.add((tokens.get(id)?.tex ?? tokens.get(id)?.text ?? "").replace(/\s+/g, ""));
    // Fit the line to its area on ONE line: smaller type before it would wrap, never under 22 (then it wraps).
    box.style.flexWrap = "nowrap";
    const w = box.scrollWidth, room = mark.rect.w * 0.9;
    const k = parseFloat(getComputedStyle(box.parentElement!).fontSize) || size;
    const fitted = w > room ? Math.max(22, Math.floor((k * room) / w)) : Math.min(k, Math.min(52, Math.max(26, mark.rect.w / 12)));
    if (fitted !== k) { box.parentElement!.style.fontSize = `${fitted}px`; setSize(fitted); }
    if (box.scrollWidth > room) box.style.flexWrap = "wrap";
    // IN STEP WITH THE DRAWING: every linked term that is new or highlighted in this state turns gold with
    // its part of the drawing, together, for a moment — then both go back to chalk.
    const litParts = labPartsFor(mark.drawing);
    const lit = [...box.children].filter((el) => {
      const id = (el as HTMLElement).dataset.id!;
      return links.has(id) && (!oldIds.has(id) || steps[current].highlight.includes(id));
    }) as HTMLElement[];
    if (lit.length && litParts) {
      const ids = lit.flatMap((el) => links.get(el.dataset.id!)!.objects);
      window.setTimeout(() => {
        lit.forEach((el) => el.classList.add("lv-now"));
        litParts.glow(ids, true);
        window.setTimeout(() => { lit.forEach((el) => el.classList.remove("lv-now")); litParts.glow(ids, false); }, animate ? 2400 : 0);
      }, animate ? 900 : 0);
    }
    if (!animate) return;

    const parts = labPartsFor(mark.drawing);
    const born: HTMLElement[] = [];
    const slide = (el: HTMLElement, was: DOMRect) => { const r = el.getBoundingClientRect(); el.animate([{ transform: `translate(${was.left - r.left}px, ${was.top - r.top}px)` }, { transform: "none" }], { duration: 750, easing: "cubic-bezier(.6,0,.2,1)" }); };
    const norm = (id: string) => (tokens.get(id)?.tex ?? tokens.get(id)?.text ?? "").replace(/\s+/g, "");
    for (const el of [...box.children] as HTMLElement[]) {
      const was = old.get(el.dataset.id!);
      if (was && oldIds.has(el.dataset.id!)) slide(el, was);
      else {
        // The same term under a new id (writers often number each step's copy): it slides, it is not new.
        const twin = ghosts.findIndex((g) => !g.used && g.key === norm(el.dataset.id!));
        if (twin >= 0) { ghosts[twin].used = true; slide(el, ghosts[twin].r); }
        else born.push(el);
      }
    }
    for (let i = ghosts.length - 1; i >= 0; i--) if (ghosts[i].used) ghosts.splice(i, 1);
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
        // From the drawing only the first time the term comes; later it just lights its part.
        const nodes = l && parts && firstTime.has(id) ? parts.nodes(l.objects) : [];
        const r = el.getBoundingClientRect();
        if (nodes.length) {
          // A copy of the part flies out of the drawing and becomes the term.
          el.style.opacity = "0";
          for (const n of nodes) {
            const nr = n.getBoundingClientRect();
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            const ownerSvg = n.ownerSVGElement;
            if (!ownerSvg) continue;
            const or = ownerSvg.getBoundingClientRect();
            Object.assign(svg.style, { position: "fixed", left: `${or.left}px`, top: `${or.top}px`, width: `${or.width}px`, height: `${or.height}px`, overflow: "visible", pointerEvents: "none", zIndex: "40" });
            svg.setAttribute("viewBox", ownerSvg.getAttribute("viewBox") ?? `0 0 ${or.width} ${or.height}`);
            // The copy that flies is gold: it is the part being talked about.
            const copy = n.cloneNode(true) as SVGElement;
            copy.style.stroke = GOLD;
            if (copy.getAttribute("fill") && copy.getAttribute("fill") !== "none") { copy.style.fill = GOLD; copy.style.fillOpacity = "0.25"; }
            svg.append(copy);
            document.body.append(svg);
            const k = Math.max(0.12, Math.min(0.7, r.height / Math.max(nr.height, 1)));
            svg.style.transformOrigin = `${nr.left - or.left + nr.width / 2}px ${nr.top - or.top + nr.height / 2}px`;
            svg.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${r.left + r.width / 2 - (nr.left + nr.width / 2)}px, ${r.top + r.height / 2 - (nr.top + nr.height / 2)}px) scale(${k})`, opacity: 0 }], { duration: 1050, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" }).onfinish = () => svg.remove();
          }
          await sleep(800);
          el.style.opacity = "";
          el.animate([{ opacity: 0, transform: "scale(1.5)" }, { opacity: 1, transform: "none" }], { duration: 420 });
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
  }, [current, reducedMotion, steps]);

  // Earlier steps, small above (the last three that differ from the current one).
  // Each earlier step's own equation (its first clause), shrunk to the column when it is long.
  // A line whose two sides are the same ("(a + b)² = (a + b)²") says nothing: it is left out.
  const saysNothing = (c: string[]) => { const txt = c.map((id) => (tokens.get(id)!.tex ?? tokens.get(id)!.text).replace(/\s+/g, "")).join(""); const [l, r, ...more] = txt.split("="); return !more.length && r !== undefined && l === r; };
  const history = Array.from({ length: Math.max(0, current) }, (_, k) => termsAt(k)).filter((c) => c.length && !saysNothing(c)).map((c) => c.map((id) => tokens.get(id)!)).slice(-3);
  const last = current === steps.length - 1;
  useEffect(() => () => { shown.current = -2; }, []);

  const [webkit, setWebkit] = useState(false);
  useLayoutEffect(() => { setWebkit(isWebKit()); }, []);
  const body = (
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
        <div style={{ minHeight: 34, fontSize: 18, color: "#aeb4c2" }}>{current >= 0 ? steps[current].caption ?? "" : ""}</div>
      </div>
  );
  if (webkit) return <WebKitHtml rect={mark.rect}>{body}</WebKitHtml>;
  return (
    <foreignObject x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} data-no-marker="" className="cv-in">
      {body}
    </foreignObject>
  );
}

const LIVING_CSS = `
.lv-line { font-family: KaTeX_Main, "Times New Roman", serif; }
.lv-line { position: relative; padding: 10px 22px; border-radius: 16px; border: 3px solid transparent; transition: border-color .6s, box-shadow .6s; }
.lv-final { border-color: rgba(245, 196, 81, .85); box-shadow: 0 0 18px rgba(245, 196, 81, .22); }
.lv-term { transition: color .35s, text-shadow .35s; }
.lv-now { color: ${GOLD} !important; text-shadow: 0 0 14px rgba(245, 196, 81, .45); }
.lv-terms { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; column-gap: .32em; row-gap: .2em; }
.lv-term { position: relative; display: inline-block; white-space: nowrap; }
.lv-term .katex { font-size: 1em; color: inherit; }
.lv-linked::after { content: ""; position: absolute; left: 6%; right: 6%; bottom: -0.18em; height: 3px; border-radius: 2px; background: currentColor; opacity: 0; transition: opacity .5s; }
.lv-term[data-linked]::after { background: rgba(233, 235, 240, .35); }
.lv-linked:has(.lv-settled)::after, .lv-linked:not(:has(.lv-tag))::after { opacity: .75; }
.lv-tag { position: absolute; left: 50%; top: 100%; transform: translate(-50%, .35em); font: 600 15px/1.1 "Aria Board", "Nunito", system-ui, sans-serif; white-space: nowrap; color: #c9ccd4; background: rgba(255,255,255,.05); border: 1px solid rgba(233,235,240,.35); border-radius: 999px; padding: 3px 9px; transition: opacity .5s, transform .5s; }
.lv-tag-up { top: auto; bottom: 100%; transform: translate(-50%, -.35em); }
.lv-tag.lv-settled { opacity: 0; transform: translate(-50%, 0); }
.lv-hi { color: ${GOLD} !important; }
.lv-side { font-size: 24px; color: #c3c7d2; white-space: normal; text-align: center; max-width: 94%; animation: lv-in .6s ease-out both; }
.lv-side .katex { font-size: 1em; }
@keyframes lv-in { from { opacity: 0; transform: translateY(.4em); } to { opacity: 1; transform: none; } }
.lv-history { font-size: 20px; color: #8b8d98; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.lv-history .katex { font-size: 1em; }
`;
