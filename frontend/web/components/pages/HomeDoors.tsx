"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, GraduationCap, Loader2, Waypoints } from "lucide-react";
import { fetchReplay, SOURCE_ICONS, useLectureHistory, type ReplayPackage } from "@/components/lecture/LectureHistory";

/**
 * THE TWO DOORS under the composer, for someone who has never used Aria: the Library (your
 * lectures) and the Map (what you know), each with a live glimpse inside — the last three lectures
 * as rows, the map as a small constellation of the student's own concepts — and one line saying
 * what it is. A door is a card you can read at a glance, not an icon in a corner.
 */

type MapNode = { key: string; label?: string; subject: string; mastery?: number; status?: string; due?: boolean };

const TEAL = "#2BB6A8";

export function LibraryDoor({ onOpenAll, onReplay }: { onOpenAll: () => void; onReplay: (lecture: ReplayPackage) => void }) {
  const { items, total, loading } = useLectureHistory();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const recent = items.filter((i) => i.status !== "failed").slice(0, 3);
  return (
    <section aria-labelledby="door-library" className="home-lift flex min-w-0 flex-col rounded-[16px] border p-5 shadow-[var(--elev-1)]" style={{ borderColor: `${TEAL}59`, background: `linear-gradient(160deg, color-mix(in srgb, ${TEAL} 13%, var(--hud-surface)) 0%, var(--hud-surface) 60%)` }}>
      <button type="button" onClick={onOpenAll} className="flex items-center gap-3 text-left">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[12px]" style={{ background: `${TEAL}33`, color: TEAL }}>
          <BookOpen size={22} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span id="door-library" className="block font-display text-[1.4rem] leading-tight text-[var(--hud-text)]">Library</span>
          <span className="block text-[0.8rem] text-[var(--hud-text-dim)]">{total > 0 ? `${total} lecture${total === 1 ? "" : "s"} · pick up where you left off` : "Every lecture you take is kept here"}</span>
        </span>
      </button>
      <p className="mt-4 text-[0.7rem] font-medium uppercase tracking-[0.08em] text-[var(--hud-text-faint)]">Recent</p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {loading && [0, 1, 2].map((i) => <li key={i} className="h-9 animate-pulse rounded-[10px] bg-[var(--hud-surface-2)]" />)}
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
                className="flex w-full items-center gap-2.5 rounded-[10px] border border-[var(--hud-line)] bg-[var(--hud-surface-2)] px-3 py-2 text-left transition-colors hover:border-[var(--hud-line-strong)] disabled:opacity-60"
              >
                <span aria-hidden="true" className="shrink-0" style={{ color: TEAL }}>{opening ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} strokeWidth={1.8} />}</span>
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-[var(--hud-text)]">{item.topic}</span>
                <span aria-hidden="true" className="shrink-0 text-[0.72rem] text-[var(--hud-text-faint)]">Replay</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onOpenAll} className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-opacity hover:opacity-80" style={{ borderColor: `${TEAL}88`, color: TEAL, fontSize: "0.8125rem", lineHeight: 1.25 }}>
        Open library <ArrowRight aria-hidden="true" size={14} />
      </button>
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
  const stats = nodes === null || learned.length === 0 ? null : [
    { n: learned.length, label: learned.length === 1 ? "concept" : "concepts", color: "var(--hud-text)" },
    { n: solid, label: "solid", color: TEAL },
    { n: due, label: "to review", color: "var(--warm)" },
  ];
  return (
    <button type="button" onClick={onOpen} aria-labelledby="door-map" className="home-lift flex min-w-0 flex-col rounded-[16px] border border-[var(--accent)]/35 bg-[linear-gradient(160deg,color-mix(in_srgb,var(--accent)_14%,var(--hud-surface))_0%,var(--hud-surface)_60%)] p-5 text-left shadow-[var(--elev-1)]">
      <span className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[color-mix(in_srgb,var(--accent)_26%,transparent)] text-[var(--hud-text)]">
          <Waypoints size={22} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span id="door-map" className="block font-display text-[1.4rem] leading-tight text-[var(--hud-text)]">Map</span>
          <span className="block text-[0.8rem] text-[var(--hud-text-dim)]">What you know, and what to review next</span>
        </span>
      </span>
      {stats && (
        <span className="mt-4 grid grid-cols-3 gap-2">
          {stats.map((st) => (
            <span key={st.label} className="rounded-[10px] border border-[var(--hud-line)] bg-[var(--hud-surface-2)] px-3 py-2">
              <span className="block font-display text-[1.3rem] leading-none" style={{ color: st.color }}>{st.n}</span>
              <span className="mt-1 block text-[0.72rem] text-[var(--hud-text-faint)]">{st.label}</span>
            </span>
          ))}
        </span>
      )}
      <Constellation nodes={shown} />
      <span className="mt-2 inline-flex items-center gap-1.5 self-start rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[0.8125rem] font-medium text-[var(--accent-on)]">
        {due ? `Review ${due} now` : "Open map"} <ArrowRight aria-hidden="true" size={14} />
      </span>
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
    <svg viewBox="0 0 100 44" className="mt-3 h-20 w-full" aria-hidden="true">
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

/**
 * THE COURSES DOOR — the first thing under the composer (owner, 2026-10-17: courses must be "so
 * visible that anyone could see it"). Full width, in the accent colour, with each level one tap away.
 */
const COURSE_LEVELS: Array<{ label: string; detail: string; href: string }> = [
  { label: "IGCSE", detail: "Cambridge, age 14–16", href: "/courses?r=INTL&l=igcse" },
  { label: "O Level", detail: "Cambridge, age 14–16", href: "/courses?r=INTL&l=olevel" },
  { label: "A Level", detail: "Cambridge, age 16–19", href: "/courses?r=INTL&l=alevel" },
  { label: "AP", detail: "College Board, USA", href: "/courses?r=US&l=ap" },
];

export function CoursesDoor() {
  return (
    <section aria-labelledby="door-courses" className="home-lift relative overflow-hidden rounded-[16px] border border-[var(--accent)]/50 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_22%,var(--hud-surface))_0%,var(--hud-surface)_70%)] p-5 shadow-[var(--elev-1)]">
      <a href="/courses" className="flex items-center gap-4">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-[var(--accent)] text-[var(--accent-on)]">
          <GraduationCap size={26} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span id="door-courses" className="block font-display text-[1.6rem] leading-tight text-[var(--hud-text)]">Courses</span>
          <span className="block text-[0.875rem] text-[var(--hud-text-dim)]">Every syllabus lesson taught by Aria, with exam practice — pick your level and subject.</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-[0.875rem] font-medium text-[var(--accent-on)] sm:inline-flex">
          Browse courses <ArrowRight aria-hidden="true" size={15} />
        </span>
      </a>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COURSE_LEVELS.map((l) => (
          <a key={l.label} href={l.href} className="rounded-[10px] border border-[var(--hud-line)] bg-[var(--hud-surface-2)] px-3 py-2.5 transition-colors hover:border-[var(--accent)]">
            <span className="block text-[0.95rem] font-medium text-[var(--hud-text)]">{l.label}</span>
            <span className="block text-[0.72rem] text-[var(--hud-text-faint)]">{l.detail}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
