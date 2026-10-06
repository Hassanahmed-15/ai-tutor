"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, Loader2, Sparkles } from "lucide-react";
import type { PageName } from "@/components/hud/HudKit";
import { layoutKnowledgeMap, mapBounds, shortLabel, visibleLabels } from "@/lib/knowledge/layout";
import { setPendingBrief } from "@/lib/pendingBrief";
import { BoardPeek, type PeekTarget } from "./BoardPeek";

/**
 * THE KNOWLEDGE MAP — everything the student has learned, as a sky of stars (lib/knowledge).
 *
 * A star is a concept: brighter the better Aria thinks they know it, ringed in amber when it is due
 * for review, faint and hollow for what comes next. Lines are the shared graph's links: what builds
 * on what. Tap a star to see Aria's estimate beside the student's own rating — an open learner model,
 * which research finds sharpens students' judgement of what they know — where it was taught, and to
 * review it or learn what comes next.
 */

type Taught = { lectureId: string; sequence: number; beatId: string; title: string; topic: string; at: string };
type MapNode = {
  key: string;
  label: string;
  subject: string;
  summary: string;
  status: "learned" | "next";
  mastery: number | null;
  selfRating: "know" | "unsure" | null;
  reviewDue: string | null;
  due: boolean;
  /** Days until the next review (server clock), or null when none is scheduled. */
  dueInDays: number | null;
  taught: Taught[];
};
type MapLink = { from: string; to: string; type: "needs" | "part-of" | "related"; confidence: number };

/** One quiet tone per subject, defined per theme in globals.css (--map-1 … --map-8). */
const HUES = ["var(--map-1)", "var(--map-2)", "var(--map-3)", "var(--map-4)", "var(--map-5)", "var(--map-6)", "var(--map-7)", "var(--map-8)"];

/** "machine-learning" → "Machine learning". */
function subjectName(subject: string): string {
  const text = subject.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function hueFor(subject: string, subjects: string[]): string {
  return HUES[Math.max(0, subjects.indexOf(subject)) % HUES.length];
}

export function KnowledgeMapPage({ go }: { go: (p: PageName) => void }) {
  const [data, setData] = useState<{ nodes: MapNode[]; links: MapLink[] } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/knowledge/map")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load your map.");
        if (alive) setData(body);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  const subjects = useMemo(() => [...new Set((data?.nodes ?? []).map((n) => n.subject))].sort(), [data]);
  const positions = useMemo(() => {
    if (!data) return {};
    const degree: Record<string, number> = {};
    for (const l of data.links) {
      degree[l.from] = (degree[l.from] ?? 0) + 1;
      degree[l.to] = (degree[l.to] ?? 0) + 1;
    }
    return layoutKnowledgeMap(
      data.nodes.map((n) => ({ key: n.key, subject: n.subject, weight: degree[n.key] ?? 0 })),
      data.links.map((l) => ({ from: l.from, to: l.to, strength: l.type === "related" ? 0.3 : 0.6 + 0.4 * l.confidence })),
    );
  }, [data]);
  /** The view fits whatever the stars cover. */
  const bounds = useMemo(() => mapBounds(positions), [positions]);
  const byKey = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.key, n])), [data]);
  // Which labels to write at this zoom: the most important first, none over another.
  const degreeOf = useMemo(() => {
    const d: Record<string, number> = {};
    for (const l of data?.links ?? []) {
      d[l.from] = (d[l.from] ?? 0) + 1;
      d[l.to] = (d[l.to] ?? 0) + 1;
    }
    return d;
  }, [data]);
  const learned = (data?.nodes ?? []).filter((n) => n.status === "learned");
  const due = learned.filter((n) => n.due).sort((a, b) => Date.parse(a.reviewDue ?? "") - Date.parse(b.reviewDue ?? ""));
  const solid = learned.filter((n) => (n.mastery ?? 0) >= 0.7).length;
  const chosen = selected ? byKey.get(selected) : undefined;
  const neighbours = useMemo(() => new Set((data?.links ?? []).flatMap((l) => (l.from === selected ? [l.to] : l.to === selected ? [l.from] : []))), [data, selected]);

  /* ── pan & zoom ─────────────────────────────────────────────────────────────────────────── */
  // null = the whole sky; set once the student pans or zooms.
  const [zoomed, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const view = zoomed ?? bounds;
  const svgRef = useRef<SVGSVGElement>(null);
  /** The map's size on screen, so stars and labels keep one size on screen at any zoom. */
  const [px, setPx] = useState({ w: 1100, h: 700 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setPx({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);
  /** Map units per screen pixel ("meet" fit: the tighter axis decides). */
  const k = Math.max(view.w / Math.max(200, px.w), view.h / Math.max(150, px.h));
  const labelled = useMemo(() => visibleLabels(
    (data?.nodes ?? []).filter((n) => positions[n.key]).map((n) => {
      const m = n.mastery ?? 0;
      return {
        key: n.key,
        x: positions[n.key].x,
        y: positions[n.key].y,
        r: (n.status === "next" ? 5 : 5 + 5 * m) * k,
        text: shortLabel(n.label),
        priority: (n.key === selected ? 1000 : 0) + (n.due ? 200 : 0) + (n.status === "learned" ? 100 : 0) + m * 50 + (degreeOf[n.key] ?? 0) * 8,
      };
    }),
    k,
  ), [data, positions, k, selected, degreeOf]);

  const drag = useRef<{ x: number; y: number; view: typeof view; moved: boolean } | null>(null);
  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * view.h };
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    const k = Math.exp(Math.max(-0.3, Math.min(0.3, e.deltaY * 0.0015)));
    const w = Math.max(bounds.w * 0.06, Math.min(bounds.w * 1.6, view.w * k));
    const h = (w / view.w) * view.h;
    setView({ x: p.x - ((p.x - view.x) * w) / view.w, y: p.y - ((p.y - view.y) * h) / view.h, w, h });
  };

  const review = useCallback((n: MapNode) => {
    // The board that INTRODUCED it in the latest lecture — where it is taught, often with its
    // question — rather than a recap that only mentions it.
    const latest = n.taught.at(-1)?.lectureId;
    const t = n.taught.filter((x) => x.lectureId === latest).sort((a, b) => a.sequence - b.sequence)[0];
    if (!t) return;
    setPeek({ ...t, review: { concepts: [{ key: n.key, label: n.label }] } });
  }, []);
  const rate = (key: string, rating: "know" | "unsure" | null) => {
    setData((d) => (d ? { ...d, nodes: d.nodes.map((n) => (n.key === key ? { ...n, selfRating: rating } : n)) } : d));
    void fetch("/api/knowledge/rate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, rating }) }).catch(() => {});
  };
  const learn = (label: string) => {
    setPendingBrief({ topic: label, file: null });
    go("learn");
  };

  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-[var(--hud-bg)] text-[var(--hud-text)]">

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => go("landing")} className="rounded-full border border-[var(--hud-line)] p-2 text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]" aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Your knowledge map</h1>
            <p className="text-xs text-[var(--hud-text-dim)]">
              {learned.length} concepts · {solid} solid · {due.length} due for review
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {subjects.map((s) => (
            <span key={s} className="flex items-center gap-1.5 rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] px-2.5 py-1 text-[11px] capitalize text-[var(--hud-text-dim)]">
              <span className="h-2 w-2 rounded-full" style={{ background: hueFor(s, subjects) }} />
              {subjectName(s)}
            </span>
          ))}
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {!data && !error && (
            <div className="grid h-full place-items-center text-[var(--hud-text-dim)]">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="animate-spin" size={22} />
                <p className="text-xs text-[var(--hud-text-dim)]">Organising what you&apos;ve learned…</p>
              </div>
            </div>
          )}
          {error && <p className="grid h-full place-items-center text-sm text-[var(--hud-text-dim)]">{error}</p>}
          {data && learned.length === 0 && (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <Sparkles className="mx-auto text-[var(--hud-cyan)]" size={28} />
                <p className="mt-3 text-base font-semibold">Your sky is still dark.</p>
                <p className="mt-1 max-w-sm text-sm text-[var(--hud-text-dim)]">Every concept you learn becomes a star here, linked to what it builds on. Start a lesson and your first stars appear.</p>
                <button type="button" onClick={() => go("landing")} className="mt-4 rounded-full bg-[var(--hud-cyan)] px-4 py-2 text-sm font-bold text-[var(--accent-on)]">Start a lesson</button>
              </div>
            </div>
          )}
          {data && learned.length > 0 && (
            <svg
              ref={svgRef}
              className="h-full w-full touch-none select-none"
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              preserveAspectRatio="xMidYMid meet"
              onWheel={onWheel}
              onPointerDown={(e) => {
                drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || !svgRef.current) return;
                const r = svgRef.current.getBoundingClientRect();
                const dx = ((e.clientX - d.x) / r.width) * d.view.w;
                const dy = ((e.clientY - d.y) / r.height) * d.view.h;
                if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
                if (d.moved) setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy });
              }}
              onPointerUp={(e) => {
                const d = drag.current;
                drag.current = null;
                if (d && !d.moved && e.target === e.currentTarget) setSelected(null);
              }}
            >
              <defs>
                {subjects.map((s) => (
                  <radialGradient key={s} id={`km-${subjects.indexOf(s)}`}>
                    <stop offset="0%" style={{ stopColor: hueFor(s, subjects) }} stopOpacity={0.9} />
                    <stop offset="100%" style={{ stopColor: hueFor(s, subjects) }} stopOpacity={0} />
                  </radialGradient>
                ))}
                <marker id="km-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 1 L9 5 L0 9 Z" style={{ fill: "var(--text-faint)" }} opacity={0.9} />
                </marker>
              </defs>
              <style>{`@keyframes km-due { 0%,100% { opacity: .35; } 50% { opacity: 1; } } .km-due { animation: km-due 2.4s ease-in-out infinite; } @media (prefers-reduced-motion: reduce) { .km-due { animation: none; } }`}</style>
              {/* Links: from what a concept builds on, toward it — the direction learning goes. */}
              {data.links.map((l) => {
                const a = positions[l.to];
                const b = positions[l.from];
                if (!a || !b) return null;
                const lit = selected && (l.from === selected || l.to === selected);
                const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08;
                const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
                return (
                  <path
                    key={`${l.from}|${l.type}|${l.to}`}
                    d={`M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`}
                    fill="none"
                    style={{ stroke: lit ? "var(--accent)" : "var(--border-strong)" }}
                    strokeWidth={(lit ? 2.2 : 1.2) * k}
                    strokeOpacity={lit ? 0.9 : l.type === "related" ? 0.12 : 0.18 + 0.4 * l.confidence}
                    strokeDasharray={l.type === "part-of" ? "4 6" : undefined}
                    markerEnd={l.type === "needs" ? "url(#km-arrow)" : undefined}
                  />
                );
              })}
              {/* Each subject's name above its cluster: the sky reads before any zooming. */}
              {subjects.map((sub) => {
                const pts = (data.nodes ?? []).filter((n) => n.subject === sub && positions[n.key]).map((n) => positions[n.key]);
                if (pts.length < 2) return null;
                const cx = pts.reduce((t, p) => t + p.x, 0) / pts.length;
                const top = Math.min(...pts.map((p) => p.y));
                return (
                  <text key={`subject-${sub}`} x={cx} y={top - 34 * k} textAnchor="middle" fontSize={15 * k} fontWeight={800} letterSpacing={2 * k} style={{ fill: hueFor(sub, subjects) }} opacity={0.8} pointerEvents="none">
                    {subjectName(sub).toUpperCase()}
                  </text>
                );
              })}
              {data.nodes.map((n) => {
                const p = positions[n.key];
                if (!p) return null;
                const m = n.mastery ?? 0;
                const isNext = n.status === "next";
                const dim = selected && selected !== n.key && !neighbours.has(n.key);
                const r = (isNext ? 5 : 5 + 5 * m) * k;
                return (
                  <g
                    key={n.key}
                    transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: "pointer", opacity: dim ? 0.3 : 1, transition: "opacity 300ms" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setSelected(n.key)}
                    role="button"
                    aria-label={`${n.label}${isNext ? ", not learned yet" : `, ${Math.round(m * 100)}% known`}`}
                  >
                    {!isNext && <circle r={r * 3.2} fill={`url(#km-${subjects.indexOf(n.subject)})`} opacity={0.25 + 0.6 * m} />}
                    {n.due && <circle r={r + 8 * k} fill="none" style={{ stroke: "var(--warning)" }} strokeWidth={2 * k} className="km-due" />}
                    {selected === n.key && <circle r={r + 13 * k} fill="none" style={{ stroke: "var(--text)" }} strokeWidth={1.5 * k} strokeDasharray={`${3 * k} ${4 * k}`} />}
                    <circle r={r} style={{ fill: isNext ? "transparent" : "var(--surface)", stroke: hueFor(n.subject, subjects) }} strokeWidth={(isNext ? 1.5 : 2) * k} strokeDasharray={isNext ? `${3 * k} ${3 * k}` : undefined} opacity={isNext ? 0.7 : 0.35 + 0.65 * m} />
                    {labelled.has(n.key) && (
                      <text y={r + 17 * k} textAnchor="middle" fontSize={13 * k} fontWeight={600} style={{ fill: isNext ? "var(--text-muted)" : "var(--text)" }} opacity={isNext ? 0.75 : 0.6 + 0.4 * m}>
                        {shortLabel(n.label)}
                      </text>
                    )}
                    <title>{n.label}</title>
                  </g>
                );
              })}
            </svg>
          )}
          {data && learned.length > 0 && (
            <p className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-[var(--hud-text-dim)]">Brighter = better known · amber ring = due for review · hollow = what comes next · drag to move, scroll to zoom</p>
          )}
        </div>

        {data && learned.length > 0 && (
          <aside className="flex w-[330px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 backdrop-blur">
            {chosen ? (
              <ConceptPanel
                node={chosen}
                color={hueFor(chosen.subject, subjects)}
                builds={(data.links ?? []).filter((l) => l.type === "needs" && l.from === chosen.key).map((l) => byKey.get(l.to)?.label ?? l.to)}
                leadsTo={(data.links ?? []).filter((l) => l.type === "needs" && l.to === chosen.key).map((l) => byKey.get(l.from)?.label ?? l.from)}
                onRate={(r) => rate(chosen.key, r)}
                onReview={() => review(chosen)}
                onSee={(t) => setPeek(t)}
                onLearn={() => learn(chosen.label)}
              />
            ) : (
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock size={14} className="text-[var(--hud-cyan)]" /> Due for review</h2>
                {due.length === 0 ? (
                  <p className="mt-2 text-xs text-[var(--hud-text-dim)]">Nothing due — everything you have learned is still fresh. Tap any star to see it.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {due.slice(0, 8).map((n) => (
                      <li key={n.key} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface)] px-2.5 py-2">
                        <button type="button" onClick={() => setSelected(n.key)} className="min-w-0 truncate text-left text-sm text-[var(--hud-text)] hover:text-[var(--hud-text)]">{n.label}</button>
                        <button type="button" onClick={() => review(n)} className="shrink-0 rounded-full bg-[var(--hud-cyan)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-on)] hover:bg-[var(--accent-hover)]">Review</button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-xs leading-relaxed text-[var(--hud-text-dim)]">Reviews come back further apart each time you remember — the spacing that makes learning stick.</p>
              </div>
            )}
          </aside>
        )}
      </div>
      {peek && (
        <BoardPeek
          target={peek}
          onClose={() => setPeek(null)}
          onReviewed={() => window.setTimeout(() => setNonce((n) => n + 1), 600)}
        />
      )}
    </main>
  );
}

function ConceptPanel({ node, color, builds, leadsTo, onRate, onReview, onSee, onLearn }: {
  node: MapNode;
  color: string;
  builds: string[];
  leadsTo: string[];
  onRate: (r: "know" | "unsure" | null) => void;
  onReview: () => void;
  onSee: (t: Taught) => void;
  onLearn: () => void;
}) {
  const m = node.mastery ?? 0;
  const dueIn = node.dueInDays;
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{subjectName(node.subject)}</p>
      <h2 className="mt-0.5 text-lg font-semibold">{node.label}</h2>
      {node.summary && <p className="mt-1 text-xs leading-relaxed text-[var(--hud-text-dim)]">{node.summary}</p>}
      {node.status === "next" ? (
        <div className="mt-4">
          <p className="text-xs text-[var(--hud-text-dim)]">You haven&apos;t learned this yet — it connects to what you know.</p>
          <button type="button" onClick={onLearn} className="mt-3 w-full rounded-full bg-[var(--hud-cyan)] py-2 text-sm font-bold text-[var(--accent-on)] hover:bg-[var(--accent-hover)]">Learn it</button>
        </div>
      ) : (
        <>
          {/* Aria's estimate beside the student's own: the two side by side is the point. */}
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-[var(--hud-text-dim)]"><span>Aria thinks you know it</span><span>{Math.round(m * 100)}%</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--hud-surface-2)]"><div className="h-full rounded-full" style={{ width: `${Math.round(m * 100)}%`, background: color }} /></div>
          </div>
          <div className="mt-3">
            <p className="text-[11px] text-[var(--hud-text-dim)]">How well do you think you know it?</p>
            <div className="mt-1.5 flex gap-1.5">
              {(["know", "unsure"] as const).map((r) => (
                <button key={r} type="button" onClick={() => onRate(node.selfRating === r ? null : r)} className={`flex-1 rounded-full border px-2 py-1.5 text-xs font-bold ${node.selfRating === r ? "border-[var(--hud-line-strong)] bg-[var(--hud-cyan)] text-[var(--accent-on)]" : "border-[var(--hud-line)] text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"}`}>
                  {r === "know" ? "I know this" : "Not sure"}
                </button>
              ))}
            </div>
            {node.selfRating === "know" && m < 0.5 && <p className="mt-1.5 text-[11px] text-[var(--hud-cyan)]">You rate it higher than your answers so far — a quick review will tell.</p>}
            {node.selfRating === "unsure" && m >= 0.7 && <p className="mt-1.5 text-[11px] text-[var(--ok)]">Your answers say you know it better than you think.</p>}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 py-2">
            <p className="text-xs text-[var(--hud-text-dim)]">{node.due ? "Due for review now" : dueIn !== null ? `Next review in ${Math.max(1, dueIn)} day${Math.max(1, dueIn) === 1 ? "" : "s"}` : "No review scheduled"}</p>
            {node.taught.length > 0 && (
              <button type="button" onClick={onReview} className="rounded-full bg-[var(--hud-cyan)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-on)] hover:bg-[var(--accent-hover)]">Review</button>
            )}
          </div>
          {node.taught.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--hud-text-dim)]">Where you learned it</p>
              <ul className="mt-1.5 space-y-1">
                {[...node.taught].reverse().map((t) => (
                  <li key={`${t.lectureId}:${t.sequence}`}>
                    <button type="button" onClick={() => onSee(t)} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]">
                      <span className="font-semibold text-[var(--hud-text)]">{t.title}</span> <span className="text-[var(--hud-text-dim)]">· {t.topic}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {(builds.length > 0 || leadsTo.length > 0) && (
        <div className="mt-4 space-y-1.5 text-xs text-[var(--hud-text-dim)]">
          {builds.length > 0 && <p><span className="text-[var(--hud-text-dim)]">Builds on:</span> {builds.join(", ")}</p>}
          {leadsTo.length > 0 && <p><span className="text-[var(--hud-text-dim)]">Leads to:</span> {leadsTo.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
