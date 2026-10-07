"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { fetchReplay, SOURCE_ICONS, useLectureHistory, type ReplayPackage } from "@/components/lecture/LectureHistory";

/**
 * THE TWO DOORS under the composer, for someone who has never used Aria: the Library (your
 * lectures) and the Map (what you know), each with a live glimpse inside — the last three lectures
 * as rows, the map as a small constellation of the student's own concepts — and one line saying
 * what it is. A door is a card you can read at a glance, not an icon in a corner.
 */

type MapNode = { key: string; label?: string; subject: string; mastery?: number; status?: string; due?: boolean };

export function LibraryDoor({ onOpenAll, onReplay }: { onOpenAll: () => void; onReplay: (lecture: ReplayPackage) => void }) {
  const { items, total, loading } = useLectureHistory();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const recent = items.filter((i) => i.status !== "failed").slice(0, 3);
  return (
    <section aria-labelledby="door-library" className="home-lift flex min-w-0 flex-col rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 shadow-[var(--elev-1)]">
      <button type="button" onClick={onOpenAll} className="flex items-baseline justify-between gap-3 text-left">
        <span>
          <span id="door-library" className="block font-display text-[1.35rem] text-[var(--hud-text)]">Library</span>
          <span className="block text-[0.75rem] text-[var(--hud-text-faint)]">{total > 0 ? `${total} lecture${total === 1 ? "" : "s"}` : "Your lectures"}</span>
        </span>
        <ArrowRight aria-hidden="true" size={15} className="text-[var(--hud-text-faint)]" />
      </button>
      <ul className="mt-3 flex flex-col gap-0.5">
        {loading && [0, 1, 2].map((i) => <li key={i} className="h-8 animate-pulse rounded-[var(--radius)] bg-[var(--hud-surface-2)]" />)}
        {!loading && recent.length === 0 && <li className="py-2 text-[0.8125rem] text-[var(--hud-text-faint)]">Your lessons will appear here.</li>}
        {recent.map((item) => {
          const Icon = SOURCE_ICONS[item.sourceType];
          const opening = openingId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={openingId !== null}
                onClick={async () => {
                  setOpeningId(item.id);
                  try { onReplay(await fetchReplay(item.id)); } catch { setOpeningId(null); }
                }}
                className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--hud-surface-2)] disabled:opacity-60"
              >
                <span aria-hidden="true" className="shrink-0 text-[var(--hud-text-faint)]">{opening ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} strokeWidth={1.8} />}</span>
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-[var(--hud-text)]">{item.topic}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function MapDoor({ onOpen }: { onOpen: () => void }) {
  const [nodes, setNodes] = useState<MapNode[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/knowledge/map", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setNodes(Array.isArray(data?.nodes) ? (data.nodes as MapNode[]) : []))
      .catch(() => setNodes([]));
    return () => controller.abort();
  }, []);
  const learned = useMemo(() => (nodes ?? []).filter((n) => n.status === "learned"), [nodes]);
  const solid = learned.filter((n) => (n.mastery ?? 0) >= 0.7).length;
  const due = learned.filter((n) => n.due).length;
  const shown = learned.slice(0, 14);
  const line = nodes === null ? "" : learned.length === 0 ? "What you know, as a map" : `${learned.length} concept${learned.length === 1 ? "" : "s"} · ${solid} solid${due ? ` · ${due} to review` : ""}`;
  return (
    <button type="button" onClick={onOpen} aria-labelledby="door-map" className="home-lift flex min-w-0 flex-col rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 text-left shadow-[var(--elev-1)]">
      <span className="flex items-baseline justify-between gap-3">
        <span>
          <span id="door-map" className="block font-display text-[1.35rem] text-[var(--hud-text)]">Map</span>
          <span className="block text-[0.75rem] text-[var(--hud-text-faint)]">{line || " "}</span>
        </span>
        <ArrowRight aria-hidden="true" size={15} className="text-[var(--hud-text-faint)]" />
      </span>
      <Constellation nodes={shown} />
    </button>
  );
}

/** The student's own concepts as stars: brighter the better known, amber when due. A map in a stamp. */
function Constellation({ nodes }: { nodes: MapNode[] }) {
  const stars = useMemo(() => {
    const seeded = (i: number, salt: number) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };
    const list: MapNode[] = nodes.length ? nodes : Array.from({ length: 7 }, (_, i) => ({ key: `ghost-${i}`, subject: "", mastery: 0, status: "ghost", due: false }));
    return list.map((n, i) => ({ ...n, x: 12 + seeded(i, 1) * 76, y: 14 + seeded(i, 2) * 64, ghost: n.status === "ghost" }));
  }, [nodes]);
  return (
    <svg viewBox="0 0 100 44" className="mt-3 h-24 w-full" aria-hidden="true">
      {stars.slice(1).map((s, i) => (
        <line key={`l${i}`} x1={stars[i].x} y1={stars[i].y * 0.55} x2={s.x} y2={s.y * 0.55} stroke="var(--hud-line-strong)" strokeWidth="0.35" opacity={s.ghost ? 0.5 : 0.8} />
      ))}
      {stars.map((s) => {
        const m = s.mastery ?? 0;
        const fill = s.ghost ? "var(--hud-line-strong)" : s.due ? "var(--warm)" : m >= 0.7 ? "var(--hud-cyan)" : "var(--accent-ink)";
        return (
          <g key={s.key}>
            {!s.ghost && m >= 0.7 && <circle cx={s.x} cy={s.y * 0.55} r={2.6} fill={fill} opacity={0.25} />}
            <circle cx={s.x} cy={s.y * 0.55} r={s.ghost ? 0.9 : 1 + m * 1.1} fill={fill} />
          </g>
        );
      })}
    </svg>
  );
}
