"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Mark } from "@/lib/canvas/layout";
import { registerLabParts } from "@/lib/canvas/labParts";
import { ACCENT } from "@/lib/mathsEngine/style.js";

/**
 * THE LAB ENGINES' DRAWING ON ARIA'S BOARD (lib/canvas/labDrawing.ts): the pencil scene (lib/mathsEngine,
 * JSXGraph) traced step by step as Aria reaches each step's sentence, or the 3-D model (lib/visual3d,
 * Three.js) stepping with her sentences. Both live in the board's drawing area through a foreignObject,
 * so the camera moves them with the board; both load only when such a board is shown.
 */
type LabMark = Extract<Mark, { type: "lab" }>;

const JSXGRAPH = "https://cdn.jsdelivr.net/npm/jsxgraph@1.14.0/distrib";
let jsxgraph: Promise<void> | null = null;
function loadJsxGraph(): Promise<void> {
  if ((window as unknown as { JXG?: unknown }).JXG) return Promise.resolve();
  jsxgraph ??= new Promise<void>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${JSXGRAPH}/jsxgraph.css`;
    document.head.append(css);
    const js = document.createElement("script");
    js.src = `${JSXGRAPH}/jsxgraphcore.js`;
    js.onload = () => resolve();
    js.onerror = () => { jsxgraph = null; reject(new Error("JSXGraph did not load")); };
    document.head.append(js);
  });
  return jsxgraph;
}

const PENCIL = (
  <svg viewBox="0 0 48 48" aria-hidden="true" style={{ position: "absolute", left: -2, top: -46, width: 48, height: 48, overflow: "visible", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.6))" }}>
    <g transform="rotate(-45 2 46)"><rect x="9" y="41" width="34" height="10" rx="1.5" fill="#ffcf48" stroke="#a27a12" strokeWidth="1" /><rect x="40" y="41" width="7" height="10" rx="2" fill="#ff8fb1" /><rect x="37" y="41" width="3" height="10" fill="#c9c9c9" /><path d="M9 41 L2 46 L9 51 Z" fill="#f1d6a8" /><path d="M4.2 44.4 L2 46 L4.2 47.6 Z" fill="#3a3a3a" /></g>
  </svg>
);

type JxgEl = { rendNode: SVGGraphicsElement; visProp: { strokecolor?: string; fillcolor?: string } };
type Pencil = { load(spec: unknown): { errors: string[]; warnings: string[] }; stepTo(s: number, msFor: (s: number) => number, animate: boolean): Promise<void>; destroy(): void; elementsOf(ids: string[]): JxgEl[]; state: { errors: string[]; warnings: string[] } };

function PencilScene({ mark, shownThrough, reducedMotion }: { mark: LabMark; shownThrough: number; reducedMotion: boolean }) {
  const lab = mark.lab as Extract<LabMark["lab"], { kind: "pencil" }>;
  // The board hands down a fresh copy of its spec on every update: the scene is keyed by its content, so
  // the drawing is built once and only ever moves on (a new object each sentence restarted it).
  const sceneKey = useMemo(() => JSON.stringify(lab.scene), [lab.scene]);
  const msKey = lab.sentenceMs.join(",");
  const id = `lab-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const wrap = useRef<HTMLDivElement>(null);
  const pen = useRef<HTMLDivElement>(null);
  const player = useRef<Pencil | null>(null);
  const last = useRef(-1);
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let unregister = () => {};
    (async () => {
      try {
        await loadJsxGraph();
        const { AriaPencil } = await import("@/lib/mathsEngine/aria.js");
        if (dead || !wrap.current || !pen.current) return;
        const p = new AriaPencil({ boxId: id, wrap: wrap.current, pencil: pen.current }) as unknown as Pencil;
        const st = p.load(JSON.parse(sceneKey));
        if (st.errors.length) { setFailed(st.errors[0]); return; }
        player.current = p;
        last.current = -1;
        // The living equation beside it finds its parts here (lib/canvas/labParts.ts).
        unregister = registerLabParts(mark.key, {
          nodes: (ids) => p.elementsOf(ids).map((el) => el.rendNode),
          colour: () => null,
          // The part being talked about turns gold with its term (the board's one accent), then back to chalk.
          glow: (ids, on) => {
            for (const el of p.elementsOf(ids)) {
              const st = el.rendNode.style, filled = el.visProp.fillcolor && el.visProp.fillcolor !== "none";
              st.transition = "stroke .35s, fill .35s, fill-opacity .35s, filter .35s";
              st.stroke = on ? ACCENT : "";
              st.fill = on && filled ? ACCENT : "";
              st.fillOpacity = on && filled ? "0.22" : "";
              st.filter = on ? `drop-shadow(0 0 6px ${ACCENT}aa)` : "";
            }
          },
        });
        setReady((r) => r + 1);
      } catch (error) {
        setFailed((error as Error).message);
      }
    })();
    return () => {
      dead = true;
      unregister();
      player.current?.destroy();
      player.current = null;
    };
  }, [id, sceneKey, mark.key]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const s = Number.isFinite(shownThrough) ? shownThrough : 1e6;
    // Going back (a replay, a jump to an earlier sentence): the scene is built again and drawn up to there.
    if (s === last.current) return;
    if (s < last.current) p.load(JSON.parse(sceneKey));
    last.current = s;
    const ms = msKey.split(",").map(Number);
    void p.stepTo(s, (k) => ms[k] || 3000, !reducedMotion);
  }, [shownThrough, ready, reducedMotion, sceneKey, msKey]);

  return (
    <div ref={wrap} style={{ position: "relative", width: mark.rect.w, height: mark.rect.h }} data-lab="pencil" data-lab-ready={ready > 0 ? "" : undefined} data-lab-error={failed ?? undefined}>
      <div id={id} className="jxgbox" style={{ width: mark.rect.w, height: mark.rect.h, background: "transparent", border: "none", borderRadius: 0 }} />
      <div ref={pen} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, pointerEvents: "none", zIndex: 20, transition: "opacity 0.25s", opacity: 0 }}>{PENCIL}</div>
    </div>
  );
}

type Three = { destroy(): void; reducedMotion: boolean };
type Player3 = { load(steps: unknown[], rebuild: () => Promise<void>): void; seek(n: number): Promise<void>; next(animate?: boolean): Promise<boolean>; index: number; total: number };

function View3D({ mark, shownThrough, reducedMotion }: { mark: LabMark; shownThrough: number; reducedMotion: boolean }) {
  const lab = mark.lab as Extract<LabMark["lab"], { kind: "view3d" }>;
  const labKey = useMemo(() => JSON.stringify(lab), [lab]);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player3 | null>(null);
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let board: Three | null = null;
    (async () => {
      try {
        const [{ ThreeBoard }, { StepPlayer }, { getTemplate }] = await Promise.all([import("@/lib/visual3d/board3d/three"), import("@/lib/visual3d/board3d/player"), import("@/lib/visual3d/registry")]);
        if (dead || !host.current) return;
        if (!ThreeBoard.supported()) { setFailed("WebGL is not available"); return; }
        const lab = JSON.parse(labKey) as Extract<LabMark["lab"], { kind: "view3d" }>;
        const t = getTemplate(lab.template);
        if (!t) { setFailed(`no template ${lab.template}`); return; }
        const b = new ThreeBoard(host.current, { reducedMotion });
        board = b as unknown as Three;
        const args = t.schema.parse(lab.args);
        const run = () => t.run(b, args as never);
        const result = await run();
        const p = new StepPlayer(b) as unknown as Player3;
        p.load(result.steps, async () => { run(); });
        player.current = p;
        setReady((r) => r + 1);
      } catch (error) {
        setFailed((error as Error).message);
      }
    })();
    return () => {
      dead = true;
      player.current = null;
      board?.destroy();
    };
  }, [labKey, reducedMotion]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const s = Number.isFinite(shownThrough) ? shownThrough : 1e6;
    // Every step whose sentence has come; the newest one animated, the rest at once.
    const due = (JSON.parse(labKey) as typeof lab).stepSentence.filter((at) => at <= s).length;
    (async () => {
      if (due < p.index) await p.seek(due);
      else if (due > p.index + 1 || reducedMotion) await p.seek(due);
      else if (due === p.index + 1) await p.next(true);
    })();
  }, [shownThrough, ready, reducedMotion, labKey]);

  return <div ref={host} role="img" aria-label={lab.alt} data-lab="view3d" data-lab-ready={ready > 0 ? "" : undefined} data-lab-error={failed ?? undefined} style={{ position: "relative", width: mark.rect.w, height: mark.rect.h, borderRadius: 12, overflow: "hidden" }} />;
}

export function LabDrawingView({ mark, shownThrough, reducedMotion }: { mark: LabMark; shownThrough: number; reducedMotion: boolean }) {
  return (
    <foreignObject x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} className="cv-in" data-no-marker="">
      {mark.lab.kind === "pencil" ? <PencilScene mark={mark} shownThrough={shownThrough} reducedMotion={reducedMotion} /> : <View3D mark={mark} shownThrough={shownThrough} reducedMotion={reducedMotion} />}
    </foreignObject>
  );
}
