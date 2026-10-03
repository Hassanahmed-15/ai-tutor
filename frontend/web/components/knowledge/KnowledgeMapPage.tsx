"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, Loader2, Sparkles } from "lucide-react";
import type { PageName } from "@/components/hud/HudKit";
import { layoutKnowledgeMap } from "@/lib/knowledge/layout";
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

/** The sky's base size; it grows with the number of stars so labels keep their room. */
const BASE_W = 1600;
const BASE_H = 1000;
const HUES = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#fb923c", "#22d3ee", "#a3e635"];

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
  const size = useMemo(() => {
    const k = Math.max(1, Math.sqrt((data?.nodes.length ?? 0) / 16));
    return { w: Math.round(BASE_W * k), h: Math.round(BASE_H * k) };
  }, [data]);
  const W = size.w;
  const H = size.h;
  /** Stars and labels grow with the sky, so they stay the same size on screen. */
  const k = W / BASE_W;
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
      size.w,
      size.h,
    );
  }, [data, size]);
  const byKey = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.key, n])), [data]);
  const learned = (data?.nodes ?? []).filter((n) => n.status === "learned");
  const due = learned.filter((n) => n.due).sort((a, b) => Date.parse(a.reviewDue ?? "") - Date.parse(b.reviewDue ?? ""));
  const solid = learned.filter((n) => (n.mastery ?? 0) >= 0.7).length;
  const chosen = selected ? byKey.get(selected) : undefined;
  const neighbours = useMemo(() => new Set((data?.links ?? []).flatMap((l) => (l.from === selected ? [l.to] : l.to === selected ? [l.from] : []))), [data, selected]);

  /* ── pan & zoom ─────────────────────────────────────────────────────────────────────────── */
  // null = the whole sky; set once the student pans or zooms.
  const [zoomed, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const view = zoomed ?? { x: 0, y: 0, w: W, h: H };
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: typeof view; moved: boolean } | null>(null);
  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * view.h };
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    const k = Math.exp(Math.max(-0.3, Math.min(0.3, e.deltaY * 0.0015)));
    const w = Math.max(300, Math.min(W * 1.6, view.w * k));
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
    <main className="relative flex h-screen flex-col overflow-hidden bg-[#05070d] text-white">
      {/* The night sky: two layers of fixed stars, painted once by CSS. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-70" style={{ backgroundImage: "radial-gradient(1px 1px at 12% 18%, #fff8 50%, transparent 51%), radial-gradient(1px 1px at 72% 34%, #fff6 50%, transparent 51%), radial-gradient(1.5px 1.5px at 41% 77%, #fff7 50%, transparent 51%), radial-gradient(1px 1px at 88% 82%, #fff5 50%, transparent 51%), radial-gradient(1px 1px at 27% 52%, #fff4 50%, transparent 51%)", backgroundSize: "340px 260px" }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(56,189,248,0.07), transparent 60%), radial-gradient(ellipse at 80% 90%, rgba(167,139,250,0.06), transparent 55%)" }} />

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => go("landing")} className="rounded-full border border-white/15 p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Your knowledge map</h1>
            <p className="text-xs text-white/55">
              {learned.length} concepts · {solid} solid · {due.length} due for review
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {subjects.map((s) => (
            <span key={s} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] capitalize text-white/75">
              <span className="h-2 w-2 rounded-full" style={{ background: hueFor(s, subjects) }} />
              {s}
            </span>
          ))}
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {!data && !error && (
            <div className="grid h-full place-items-center text-white/60">
              <Loader2 className="animate-spin" size={22} />
            </div>
          )}
          {error && <p className="grid h-full place-items-center text-sm text-white/70">{error}</p>}
          {data && learned.length === 0 && (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <Sparkles className="mx-auto text-amber-300" size={28} />
                <p className="mt-3 text-base font-semibold">Your sky is still dark.</p>
                <p className="mt-1 max-w-sm text-sm text-white/60">Every concept you learn becomes a star here, linked to what it builds on. Start a lesson and your first stars appear.</p>
                <button type="button" onClick={() => go("landing")} className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-bold text-black">Start a lesson</button>
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
                    <stop offset="0%" stopColor={hueFor(s, subjects)} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={hueFor(s, subjects)} stopOpacity={0} />
                  </radialGradient>
                ))}
                <marker id="km-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 1 L9 5 L0 9 Z" fill="#94a3b8" opacity={0.7} />
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
                    stroke={lit ? "#fbbf24" : "#94a3b8"}
                    strokeWidth={(lit ? 2.2 : 1.2) * k}
                    strokeOpacity={lit ? 0.9 : l.type === "related" ? 0.12 : 0.18 + 0.4 * l.confidence}
                    strokeDasharray={l.type === "part-of" ? "4 6" : undefined}
                    markerEnd={l.type === "needs" ? "url(#km-arrow)" : undefined}
                  />
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
                    {n.due && <circle r={r + 8 * k} fill="none" stroke="#fbbf24" strokeWidth={2 * k} className="km-due" />}
                    {selected === n.key && <circle r={r + 13 * k} fill="none" stroke="#fff" strokeWidth={1.5 * k} strokeDasharray={`${3 * k} ${4 * k}`} />}
                    <circle r={r} fill={isNext ? "transparent" : "#f8fafc"} stroke={hueFor(n.subject, subjects)} strokeWidth={(isNext ? 1.5 : 2) * k} strokeDasharray={isNext ? `${3 * k} ${3 * k}` : undefined} opacity={isNext ? 0.7 : 0.35 + 0.65 * m} />
                    <text y={r + 17 * k} textAnchor="middle" fontSize={13 * k} fontWeight={600} fill={isNext ? "#94a3b8" : "#e2e8f0"} opacity={isNext ? 0.75 : 0.6 + 0.4 * m}>
                      {n.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
          {data && learned.length > 0 && (
            <p className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-white/45">Brighter = better known · amber ring = due for review · hollow = what comes next · drag to move, scroll to zoom</p>
          )}
        </div>

        {data && learned.length > 0 && (
          <aside className="flex w-[330px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/10 bg-black/30 p-4 backdrop-blur">
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
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock size={14} className="text-amber-300" /> Due for review</h2>
                {due.length === 0 ? (
                  <p className="mt-2 text-xs text-white/55">Nothing due — everything you have learned is still fresh. Tap any star to see it.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {due.slice(0, 8).map((n) => (
                      <li key={n.key} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2">
                        <button type="button" onClick={() => setSelected(n.key)} className="min-w-0 truncate text-left text-sm text-white/90 hover:text-white">{n.label}</button>
                        <button type="button" onClick={() => review(n)} className="shrink-0 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-black hover:bg-amber-300">Review</button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-xs leading-relaxed text-white/50">Reviews come back further apart each time you remember — the spacing that makes learning stick.</p>
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
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{node.subject}</p>
      <h2 className="mt-0.5 text-lg font-semibold">{node.label}</h2>
      {node.summary && <p className="mt-1 text-xs leading-relaxed text-white/65">{node.summary}</p>}
      {node.status === "next" ? (
        <div className="mt-4">
          <p className="text-xs text-white/60">You haven&apos;t learned this yet — it connects to what you know.</p>
          <button type="button" onClick={onLearn} className="mt-3 w-full rounded-full bg-white py-2 text-sm font-bold text-black hover:bg-white/90">Learn it</button>
        </div>
      ) : (
        <>
          {/* Aria's estimate beside the student's own: the two side by side is the point. */}
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-white/60"><span>Aria thinks you know it</span><span>{Math.round(m * 100)}%</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${Math.round(m * 100)}%`, background: color }} /></div>
          </div>
          <div className="mt-3">
            <p className="text-[11px] text-white/60">How well do you think you know it?</p>
            <div className="mt-1.5 flex gap-1.5">
              {(["know", "unsure"] as const).map((r) => (
                <button key={r} type="button" onClick={() => onRate(node.selfRating === r ? null : r)} className={`flex-1 rounded-full border px-2 py-1.5 text-xs font-bold ${node.selfRating === r ? "border-white bg-white text-black" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
                  {r === "know" ? "I know this" : "Not sure"}
                </button>
              ))}
            </div>
            {node.selfRating === "know" && m < 0.5 && <p className="mt-1.5 text-[11px] text-amber-200/85">You rate it higher than your answers so far — a quick review will tell.</p>}
            {node.selfRating === "unsure" && m >= 0.7 && <p className="mt-1.5 text-[11px] text-emerald-200/85">Your answers say you know it better than you think.</p>}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
            <p className="text-xs text-white/70">{node.due ? "Due for review now" : dueIn !== null ? `Next review in ${Math.max(1, dueIn)} day${Math.max(1, dueIn) === 1 ? "" : "s"}` : "No review scheduled"}</p>
            {node.taught.length > 0 && (
              <button type="button" onClick={onReview} className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-black hover:bg-amber-300">Review</button>
            )}
          </div>
          {node.taught.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Where you learned it</p>
              <ul className="mt-1.5 space-y-1">
                {[...node.taught].reverse().map((t) => (
                  <li key={`${t.lectureId}:${t.sequence}`}>
                    <button type="button" onClick={() => onSee(t)} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-white/80 hover:bg-white/10">
                      <span className="font-semibold text-white">{t.title}</span> <span className="text-white/50">· {t.topic}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {(builds.length > 0 || leadsTo.length > 0) && (
        <div className="mt-4 space-y-1.5 text-xs text-white/65">
          {builds.length > 0 && <p><span className="text-white/45">Builds on:</span> {builds.join(", ")}</p>}
          {leadsTo.length > 0 && <p><span className="text-white/45">Leads to:</span> {leadsTo.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
