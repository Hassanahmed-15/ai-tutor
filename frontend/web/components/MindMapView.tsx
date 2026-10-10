"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, Download, Loader2, Maximize2, Minus, Play, Plus, X } from "lucide-react";
import { branchIds, layoutMindMap, type MeasuredLabel, type MindMap } from "@/lib/mindMap";

/**
 * THE LECTURE AS A MIND MAP (lib/mindMap.ts): the topic on the left, the ideas it taught branching
 * to the right with curved connectors, each branch opened and closed with its chevron — as Google
 * NotebookLM draws one. Drag to move, scroll or the buttons to zoom, expand or collapse all, fit,
 * and download as a picture.
 *
 * Every box below the root knows the slide(s) that taught it: clicking one (or Enter on it) opens a
 * card with that slide's title and points, and "Replay from this slide" plays the lecture from there.
 *
 * The colours are read from the theme tokens and written into the SVG as literal values, so the
 * downloaded PNG looks exactly like the screen. Motion is short transform transitions, none when
 * less motion is asked for.
 */
type Palette = { page: string; node: string; root: string; line: string; text: string; dim: string; accent: string; accentOn: string; warn: string; font: string };
type View = { x: number; y: number; w: number; h: number };
/** What the preview card shows of a slide — the lecture's own beat. */
export type MindMapSlide = { title: string; points?: string[]; script?: string };

const PAD = 48;
const MAX_W = 260;

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    page: v("--page", "#0A0A14"),
    node: v("--surface-2", "#1E1E38"),
    root: v("--accent-soft", "#23203F"),
    line: v("--border", "#2E2E2B"),
    text: v("--text", "#F2F2F0"),
    dim: v("--text-muted", "#A3A29D"),
    accent: v("--accent", "#9F6BFF"),
    accentOn: v("--accent-on", "#0A0A14"),
    warn: v("--warning", "#F0C05A"),
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
  };
}

/** Real text measurement, so boxes fit their words. */
function makeMeasure(font: string): (label: string, depth: number, note?: string) => MeasuredLabel {
  const ctx = document.createElement("canvas").getContext("2d");
  const wrap = (text: string, size: number, weight: number, max: number) => {
    if (!ctx) return [text];
    ctx.font = `${weight} ${size}px ${font}`;
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const width = (lines: string[], size: number, weight: number) => {
    if (!ctx) return lines.reduce((m, l) => Math.max(m, l.length * size * 0.55), 0);
    ctx.font = `${weight} ${size}px ${font}`;
    return lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  };
  return (label, depth, note) => {
    const size = depth === 0 ? 17 : 15;
    const lines = wrap(label, size, 500, MAX_W - 32);
    const noteLines = note ? wrap(note, 12.5, 400, MAX_W - 32) : [];
    const w = Math.ceil(Math.max(width(lines, size, 500), width(noteLines, 12.5, 400)) + 32);
    const h = lines.length * (size + 6) + noteLines.length * 17 + (noteLines.length ? 6 : 0) + 26;
    return { lines, noteLines, w: Math.min(MAX_W, Math.max(w, 72)), h };
  };
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reducedMotion === "1");
}

export function MindMapView({
  mindMap,
  loading,
  error,
  onRetry,
  onClose,
  slides = [],
  onReplayFrom,
  missedSlides = [],
}: {
  mindMap: MindMap | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  /** The lecture's slides, in order — what a box's slide numbers point into. */
  slides?: MindMapSlide[];
  /** Plays the lecture from this slide (0-based); without it the card only previews. */
  onReplayFrom?: (index: number) => void;
  /** Slides (0-based) the student got a test question wrong on: their boxes get an amber ring. */
  missedSlides?: number[];
}) {
  const [palette, setPalette] = useState<Palette | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["0"]));
  const [view, setView] = useState<View | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const movedRef = useRef(false);
  const drag = useRef<{ x: number; y: number; view: View; nodeId: string | null; dragging: boolean } | null>(null);
  /** The box whose slide is being previewed, and which of its slides. */
  const [selected, setSelected] = useState<{ id: string; slide: number } | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const replayRef = useRef<HTMLButtonElement>(null);
  const cardCloseRef = useRef<HTMLButtonElement>(null);

  // Theme colours, re-read when the app switches light/dark.
  useEffect(() => {
    setPalette(readPalette());
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Escape closes the slide card first, then the map; focus starts inside the dialog.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedRef.current) closePreview();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const measure = useMemo(() => (palette ? makeMeasure(palette.font) : null), [palette]);
  const layout = useMemo(() => (mindMap && measure ? layoutMindMap(mindMap.root, expanded, measure) : null), [mindMap, expanded, measure]);

  const fitView = useCallback((): View | null => {
    if (!layout || !svgRef.current) return null;
    const box = svgRef.current.getBoundingClientRect();
    const w = layout.width + PAD * 2;
    const h = layout.height + PAD * 2;
    // Keep the screen's aspect so the map is centred, never stretched — and never blown up past its
    // natural size, so a small map reads at normal size instead of filling the screen with huge text.
    const aspect = box.width / Math.max(1, box.height);
    const vw = Math.max(w, h * aspect, box.width);
    const vh = vw / aspect;
    return { x: -PAD - (vw - w) / 2, y: -PAD - (vh - h) / 2, w: vw, h: vh };
  }, [layout]);

  // Refit whenever the tree changes shape, until the student moves the view themselves.
  useEffect(() => {
    if (!movedRef.current || !view) setView(fitView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView]);

  const zoom = (factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      if (!v) return v;
      const px = cx ?? v.x + v.w / 2;
      const py = cy ?? v.y + v.h / 2;
      const w = Math.min(8000, Math.max(200, v.w * factor));
      const h = (w / v.w) * v.h;
      return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
    });
    movedRef.current = true;
  };

  const toPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || !view) return { x: 0, y: 0 };
    const box = svg.getBoundingClientRect();
    const scale = Math.max(view.w / box.width, view.h / box.height);
    const offX = (box.width * scale - view.w) / 2;
    const offY = (box.height * scale - view.h) / 2;
    return { x: view.x - offX + (clientX - box.left) * scale, y: view.y - offY + (clientY - box.top) * scale };
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const openNode = (id: string) => {
    const node = layout?.nodes.find((n) => n.id === id);
    const first = node?.slides?.find((i) => i < slides.length);
    if (first === undefined) return;
    setSelected({ id, slide: first });
    // Focus moves into the card, so a keyboard user lands on what just opened.
    requestAnimationFrame(() => (replayRef.current ?? cardCloseRef.current)?.focus());
  };
  function closePreview() {
    const id = selectedRef.current?.id;
    setSelected(null);
    if (id) requestAnimationFrame(() => svgRef.current?.querySelector<SVGGElement>(`[data-mm-node="${id}"]`)?.focus());
  }
  const missed = useMemo(() => new Set(missedSlides), [missedSlides]);
  const isMissed = (nodeSlides?: number[]) => Boolean(nodeSlides?.some((i) => missed.has(i)));
  const anyMissed = Boolean(layout?.nodes.some((n) => isMissed(n.slides)));
  const allIds = useMemo(() => (mindMap ? branchIds(mindMap.root) : []), [mindMap]);
  const allOpen = allIds.length > 0 && allIds.every((id) => expanded.has(id));
  const expandOrCollapseAll = () => {
    movedRef.current = false;
    setExpanded(allOpen ? new Set(["0"]) : new Set(allIds));
  };
  const fit = () => {
    movedRef.current = false;
    setView(fitView());
  };

  const download = async () => {
    const svg = svgRef.current;
    if (!svg || !layout || !palette) return;
    const w = layout.width + PAD * 2;
    const h = layout.height + PAD * 2;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("viewBox", `${-PAD} ${-PAD} ${w} ${h}`);
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.querySelectorAll("[data-no-export]").forEach((el) => el.remove());
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", String(-PAD));
    bg.setAttribute("y", String(-PAD));
    bg.setAttribute("width", String(w));
    bg.setAttribute("height", String(h));
    bg.setAttribute("fill", palette.page);
    clone.insertBefore(bg, clone.firstChild);
    const data = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image"));
        img.src = url;
      });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * scale);
      canvas.height = Math.ceil(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(mindMap?.title || "Mind map").replace(/[^\w\s-]+/g, "").trim() || "Mind map"} - mind map.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const still = reducedMotion();
  const nodeTransition = still ? "none" : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";

  return (
    <div
      data-mind-map-view
      role="dialog"
      aria-modal="true"
      aria-labelledby="mind-map-title"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--hud-bg)] text-[var(--hud-text)]"
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--hud-line)] px-5 py-3">
        <div className="min-w-0">
          <h2 id="mind-map-title" className="truncate text-[1.0625rem] font-semibold">{mindMap?.title ? `${mindMap.title} — mind map` : "Mind map"}</h2>
          <p className="text-[0.75rem] text-[var(--hud-text-dim)]">{slides.length > 0 ? "Click a box to see the slide that taught it · " : ""}{anyMissed ? "Amber = a test question you missed · " : ""}Open a branch with its arrow · drag to move · scroll to zoom</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close mind map"
          className="grid size-9 shrink-0 place-items-center rounded-[var(--radius)] text-[var(--hud-text-dim)] transition-colors hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-3 text-[0.9rem] text-[var(--hud-text-dim)]">
              <Loader2 aria-hidden="true" size={22} className="animate-spin text-[var(--hud-cyan)]" />
              Mapping your lecture…
            </div>
          </div>
        )}
        {!loading && error && (
          <div role="alert" className="absolute inset-0 grid place-items-center px-6">
            <div className="flex max-w-md flex-col items-center gap-4 text-center">
              <p className="text-[0.95rem] text-[var(--hud-text)]">{error}</p>
              <button type="button" onClick={onRetry} className="hud-btn-primary h-10 px-5 text-[0.875rem]">Try again</button>
            </div>
          </div>
        )}
        {!loading && !error && layout && palette && (
          <svg
            ref={svgRef}
            className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
            viewBox={view ? `${view.x} ${view.y} ${view.w} ${view.h}` : `${-PAD} ${-PAD} ${layout.width + PAD * 2} ${layout.height + PAD * 2}`}
            preserveAspectRatio="xMidYMid meet"
            role="tree"
            aria-label={mindMap?.title ?? "Mind map"}
            onWheel={(e) => {
              const p = toPoint(e.clientX, e.clientY);
              zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
            }}
            onPointerDown={(e) => {
              if ((e.target as Element).closest("[data-mm-toggle]") || !view) return;
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              const nodeId = (e.target as Element).closest("[data-mm-node]")?.getAttribute("data-mm-node") ?? null;
              drag.current = { x: e.clientX, y: e.clientY, view, nodeId, dragging: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              const svg = svgRef.current;
              if (!d || !svg) return;
              // A press that barely moves is a click (on a box: open its slide), not a drag.
              if (!d.dragging && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
              d.dragging = true;
              const box = svg.getBoundingClientRect();
              const scale = Math.max(d.view.w / box.width, d.view.h / box.height);
              setView({ ...d.view, x: d.view.x - (e.clientX - d.x) * scale, y: d.view.y - (e.clientY - d.y) * scale });
              movedRef.current = true;
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (!d || d.dragging) return;
              if (d.nodeId) openNode(d.nodeId);
              else if (selectedRef.current) closePreview();
            }}
            style={{ fontFamily: palette.font }}
          >
            <g fill="none" stroke={palette.accent} strokeWidth={1.8} strokeOpacity={0.75}>
              {layout.links.map((l) => (
                <path key={`${l.from}>${l.to}`} d={l.d} className={still ? undefined : "mm-fade-in"} />
              ))}
            </g>
            {layout.nodes.map((n) => {
              const root = n.depth === 0;
              const size = root ? 17 : 15;
              const lineH = size + 6;
              const slide = n.slides?.find((i) => i < slides.length);
              const opens = slide !== undefined;
              const isSelected = selected?.id === n.id;
              const missedHere = isMissed(n.slides);
              const described = `${n.note ? `${n.label}: ${n.note}` : n.label}${missedHere ? ". You missed a test question here" : ""}`;
              return (
                <g
                  key={n.id}
                  role="treeitem"
                  aria-level={n.depth + 1}
                  aria-expanded={n.hasChildren ? n.expanded : undefined}
                  aria-label={opens ? `${described}. Taught on slide ${slide + 1} — press Enter to see it` : described}
                  data-mm-node={opens ? n.id : undefined}
                  tabIndex={opens ? 0 : undefined}
                  onKeyDown={opens ? (e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    openNode(n.id);
                  } : undefined}
                  style={{ transform: `translate(${n.x}px, ${n.y}px)`, transition: nodeTransition }}
                  className={`${still ? "" : "mm-fade-in"} ${opens ? "mm-opens cursor-pointer outline-none" : ""}`}
                >
                  {opens && <title>{`See slide ${slide + 1}`}</title>}
                  {missedHere && <rect data-mm-missed="" x={-5} y={-5} width={n.w + 10} height={n.h + 10} rx={14} fill="none" stroke={palette.warn} strokeWidth={2.5} />}
                  <rect
                    width={n.w}
                    height={n.h}
                    rx={10}
                    fill={root ? palette.root : palette.node}
                    stroke={root || isSelected ? palette.accent : palette.line}
                    strokeWidth={isSelected ? 2.5 : root ? 1.5 : 1}
                  />
                  <text x={16} y={13 + size} fill={palette.text} fontSize={size} fontWeight={500}>
                    {n.lines.map((line, i) => (
                      <tspan key={i} x={16} dy={i === 0 ? 0 : lineH}>{line}</tspan>
                    ))}
                  </text>
                  {n.noteLines.length > 0 && (
                    <text x={16} y={13 + size + (n.lines.length - 1) * lineH + 22} fill={palette.dim} fontSize={12.5}>
                      {n.noteLines.map((line, i) => (
                        <tspan key={i} x={16} dy={i === 0 ? 0 : 17}>{line}</tspan>
                      ))}
                    </text>
                  )}
                  {n.hasChildren && (
                    <g
                      data-mm-toggle
                      data-no-export
                      role="button"
                      tabIndex={0}
                      aria-label={`${n.expanded ? "Collapse" : "Expand"} ${n.label}`}
                      aria-expanded={n.expanded}
                      className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[3]"
                      onClick={() => toggle(n.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(n.id);
                        }
                      }}
                      transform={`translate(${n.w + 14}, ${n.h / 2})`}
                    >
                      <circle r={12} fill={palette.node} stroke={palette.accent} strokeWidth={1.2} />
                      <path
                        d={n.expanded ? "M2.5 -5 L-2.5 0 L2.5 5" : "M-2.5 -5 L2.5 0 L-2.5 5"}
                        fill="none"
                        stroke={palette.text}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {!loading && !error && selected && slides[selected.slide] && (
          <SlideCard
            slides={slides}
            index={selected.slide}
            others={(layout?.nodes.find((n) => n.id === selected.id)?.slides ?? []).filter((i) => i < slides.length)}
            onPick={(slide) => setSelected({ ...selected, slide })}
            onClose={closePreview}
            onReplay={onReplayFrom ? () => onReplayFrom(selected.slide) : undefined}
            missed={missed.has(selected.slide)}
            replayRef={replayRef}
            closeRef={cardCloseRef}
          />
        )}

        {!loading && !error && layout && (
          <div className="absolute bottom-5 right-5 flex flex-col items-center gap-2">
            <ControlButton label={allOpen ? "Collapse all" : "Expand all"} onClick={expandOrCollapseAll}>
              {allOpen ? <ChevronsDownUp size={17} aria-hidden="true" /> : <ChevronsUpDown size={17} aria-hidden="true" />}
            </ControlButton>
            <div className="flex flex-col overflow-hidden rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] shadow-[var(--elev-1)]">
              <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1 / 1.25)} className="grid size-10 place-items-center text-[var(--hud-text)] hover:bg-[var(--hud-surface-2)]">
                <Plus size={17} aria-hidden="true" />
              </button>
              <span aria-hidden="true" className="mx-2 h-px bg-[var(--hud-line)]" />
              <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.25)} className="grid size-10 place-items-center text-[var(--hud-text)] hover:bg-[var(--hud-surface-2)]">
                <Minus size={17} aria-hidden="true" />
              </button>
            </div>
            <ControlButton label="Fit to screen" onClick={fit}>
              <Maximize2 size={16} aria-hidden="true" />
            </ControlButton>
            <ControlButton label="Download as a picture" onClick={() => void download()}>
              <Download size={16} aria-hidden="true" />
            </ControlButton>
          </div>
        )}
      </div>
      <style>{`.mm-fade-in { animation: mm-fade-in 220ms ease-out both; } @keyframes mm-fade-in { from { opacity: 0; } to { opacity: 1; } } @media (prefers-reduced-motion: reduce) { .mm-fade-in { animation: none; } } .mm-opens:hover > rect, .mm-opens:focus-visible > rect { stroke: ${palette?.accent ?? "currentColor"}; } .mm-opens:focus-visible > rect { stroke-width: 2.5px; }`}</style>
    </div>
  );
}

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-10 place-items-center rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] text-[var(--hud-text)] shadow-[var(--elev-1)] transition-colors hover:bg-[var(--hud-surface-2)]"
    >
      {children}
    </button>
  );
}

/**
 * The slide a box was taught on: its title and points (or the start of what Aria said), the other
 * slides that also taught it, and the way back into the lecture at that slide.
 */
function SlideCard({ slides, index, others, onPick, onClose, onReplay, missed, replayRef, closeRef }: {
  slides: MindMapSlide[];
  index: number;
  others: number[];
  onPick: (index: number) => void;
  onClose: () => void;
  onReplay?: () => void;
  /** The student got a test question from this slide wrong. */
  missed?: boolean;
  replayRef: React.RefObject<HTMLButtonElement | null>;
  closeRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const slide = slides[index];
  const points = (slide.points ?? []).filter((p) => p.trim()).slice(0, 5);
  const script = slide.script?.replace(/\s+/g, " ").trim() ?? "";
  const excerpt = script.length > 280 ? `${script.slice(0, 280).replace(/\s+\S*$/, "")}…` : script;
  return (
    <section
      data-mm-slide-card
      aria-labelledby="mm-slide-title"
      className="absolute bottom-5 left-5 z-10 flex max-h-[min(60vh,440px)] w-[min(380px,calc(100%-6.5rem))] flex-col rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)] shadow-[var(--elev-2)]"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--hud-cyan)]">Slide {index + 1} of {slides.length}</p>
          <h3 id="mm-slide-title" className="mt-0.5 text-[1rem] font-semibold leading-snug text-[var(--hud-text)]">{slide.title?.trim() || `Slide ${index + 1}`}</h3>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close the slide preview"
          className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--hud-text-dim)] transition-colors hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </div>
      {missed && (
        <p data-mm-card-missed="" className="mx-4 mt-2 rounded-[var(--radius)] border border-[var(--warning)] px-2.5 py-1.5 text-[0.75rem] font-medium text-[var(--warning)]">
          You missed a test question from this slide
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-1 pt-2 text-[0.8125rem] leading-relaxed text-[var(--hud-text-dim)]">
        {points.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4">
            {points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        ) : excerpt ? (
          <p>{excerpt}</p>
        ) : null}
      </div>
      {others.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2 text-[0.75rem] text-[var(--hud-text-dim)]">
          <span>Taught on</span>
          {others.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick(i)}
              aria-pressed={i === index}
              className={`rounded-full border px-2 py-0.5 font-medium transition-colors ${i === index ? "border-[var(--hud-cyan)] text-[var(--hud-text)]" : "border-[var(--hud-line)] hover:text-[var(--hud-text)]"}`}
            >
              Slide {i + 1}
            </button>
          ))}
        </div>
      )}
      {onReplay ? (
        <div className="px-4 pb-4 pt-3">
          <button ref={replayRef} type="button" onClick={onReplay} data-mm-replay="" className="hud-btn-primary inline-flex h-9 w-full items-center justify-center gap-2 rounded-full px-4 text-[0.8125rem] font-semibold">
            <Play aria-hidden="true" size={14} /> Replay from this slide
          </button>
        </div>
      ) : (
        <div className="pb-3" />
      )}
    </section>
  );
}
