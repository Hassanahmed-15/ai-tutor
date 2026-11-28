"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, ClipboardCheck, Gamepad2, GraduationCap, Loader2, Waypoints } from "lucide-react";
import { fetchReplay, SOURCE_ICONS, useLectureHistory, type ReplayPackage } from "@/components/lecture/LectureHistory";

/**
 * THE TWO DOORS under the composer, for someone who has never used Aria: the Library (your
 * lectures) and the Map (what you know), each with a live glimpse inside — the last three lectures
 * as rows, the map as a small constellation of the student's own concepts — and one line saying
 * what it is. A door is a card you can read at a glance, not an icon in a corner.
 */

type MapNode = { key: string; label?: string; subject: string; mastery?: number; status?: string; due?: boolean };

const TEAL = "#2BB6A8";
const SKY = "#38A9E0";

/** One frame for all four front-page cards (Courses, Library, Practice, Games), so the row reads as one set. */
// The size is set on the card, not the rows: globals.css gives buttons `font: inherit`, which beats a utility class on them.
const DOOR = "home-lift flex min-w-0 flex-col gap-4 rounded-[20px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 text-[0.875rem] shadow-[var(--elev-1)]";
const ROW = "flex min-h-11 items-center gap-2.5 rounded-[12px] border border-transparent bg-[var(--hud-surface-2)] px-3 py-2 text-[0.875rem] transition-colors hover:border-[var(--hud-line-strong)]";

function DoorTitle({ id, title, color, icon }: { id: string; title: string; color: string; icon: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[12px]" style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, color }}>{icon}</span>
      <span id={id} className="truncate font-display text-[1.25rem] leading-tight text-[var(--hud-text)]">{title}</span>
    </span>
  );
}

export function LibraryDoor({ onOpenAll, onReplay }: { onOpenAll: () => void; onReplay: (lecture: ReplayPackage) => void }) {
  const { items, total, loading } = useLectureHistory();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const recent = items.filter((i) => i.status !== "failed").slice(0, 3);
  return (
    <section aria-labelledby="door-library" className={DOOR}>
      <button type="button" onClick={onOpenAll} className="flex items-center justify-between gap-3 text-left">
        <DoorTitle id="door-library" title="Library" color={TEAL} icon={<BookOpen size={20} strokeWidth={1.9} />} />
        <span className="shrink-0 text-[0.8125rem] text-[var(--hud-text-dim)]">{total > 0 ? `${total} lecture${total === 1 ? "" : "s"}` : ""}</span>
      </button>
      <p className="text-[0.875rem] leading-relaxed text-[var(--hud-text-dim)]">{total > 0 ? "Pick up where you left off." : "Every lecture you take is kept here."}</p>
      <ul className="flex flex-col gap-2">
        {loading && [0, 1, 2].map((i) => <li key={i} className="h-11 animate-pulse rounded-[12px] bg-[var(--hud-surface-2)]" />)}
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
                className={`${ROW} w-full text-left disabled:opacity-60`}
              >
                <span aria-hidden="true" className="shrink-0" style={{ color: TEAL }}>{opening ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} strokeWidth={1.8} />}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--hud-text)]">{item.topic}</span>
                <span aria-hidden="true" className="shrink-0 text-[0.75rem] text-[var(--hud-text-faint)]">Replay</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onOpenAll} className="mt-auto inline-flex items-center gap-1.5 self-start text-[0.8125rem] font-medium transition-opacity hover:opacity-80" style={{ color: TEAL }}>
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

/** THE COURSES CARD — the four-card row's first card (front page option A, 2026-11-25): each level one tap away. */
export function CoursesCard() {
  return (
    <section aria-labelledby="door-courses-card" className={DOOR}>
      <a href="/courses" className="flex items-center justify-between gap-3">
        <DoorTitle id="door-courses-card" title="Courses" color="var(--accent-ink)" icon={<GraduationCap size={21} strokeWidth={1.9} />} />
        <ArrowRight aria-hidden="true" size={17} className="shrink-0 text-[var(--hud-text-dim)]" />
      </a>
      <p className="text-[0.875rem] leading-relaxed text-[var(--hud-text-dim)]">Every syllabus lesson, with exam practice.</p>
      <div className="grid grid-cols-2 gap-2">
        {COURSE_LEVELS.map((l) => (
          <a key={l.label} href={l.href} title={l.detail} className={`${ROW} text-[var(--hud-text)]`}>{l.label}</a>
        ))}
      </div>
    </section>
  );
}

type DoorItem = { name: string; what: string; tag: string; onClick?: () => void; href?: string };

function DoorRows({ items, tagColor }: { items: DoorItem[]; tagColor: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => {
        const inner = (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-medium text-[var(--hud-text)]">{it.name}</span>
              <span className="truncate text-[0.75rem] text-[var(--hud-text-faint)]">{it.what}</span>
            </span>
            <span className="shrink-0 text-[0.75rem]" style={{ color: it.onClick || it.href ? tagColor : "var(--hud-text-faint)" }}>{it.tag}</span>
          </>
        );
        return (
          <li key={it.name}>
            {it.href ? <a href={it.href} className={ROW}>{inner}</a>
              : it.onClick ? <button type="button" onClick={it.onClick} className={`${ROW} w-full text-left`}>{inner}</button>
              : <span aria-disabled="true" className={`${ROW} cursor-default opacity-60 hover:border-transparent`}>{inner}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * THE PRACTICE CARD: exam-style questions on any topic (the composer's Practice mode, /api/practice/topic), past
 * papers inside course lessons, and a timed mock (not built yet, so shown as "Soon").
 */
export function PracticeDoor({ young, onTopic }: { young: boolean; onTopic: () => void }) {
  const items: DoorItem[] = young
    ? [
        { name: "Quick questions", what: "on any topic", tag: "Type it above", onClick: onTopic },
        { name: "Daily ten", what: "10 questions a day", tag: "Soon" },
        { name: "Try again", what: "ones you missed", tag: "Soon" },
      ]
    : [
        { name: "By topic", what: "type any topic above", tag: "Start", onClick: onTopic },
        { name: "Past papers", what: "inside course lessons", tag: "Courses", href: "/courses" },
        { name: "Timed mock", what: "a full paper", tag: "Soon" },
      ];
  return (
    <section aria-labelledby="door-practice" className={DOOR}>
      <button type="button" onClick={onTopic} className="flex items-center justify-between gap-3 text-left">
        <DoorTitle id="door-practice" title="Practice" color={SKY} icon={<ClipboardCheck size={20} strokeWidth={1.9} />} />
        <span className="shrink-0 text-[0.8125rem] text-[var(--hud-text-dim)]">Marked by Aria</span>
      </button>
      <p className="text-[0.875rem] leading-relaxed text-[var(--hud-text-dim)]">{young ? "Short questions on what you learned." : "Exam-style questions, marked against the mark scheme."}</p>
      <DoorRows items={items} tagColor={SKY} />
    </section>
  );
}

/** THE GAMES CARD: practice games built from the student's lessons. None is built yet, so all say "Soon". */
export function GamesDoor({ young }: { young: boolean }) {
  // The only game for now (owner 2026-11-27): Math Quest, the owner's own pixel-art maths platformer.
  void young;
  const items: DoorItem[] = [{ name: "Math Quest", what: "pixel-art maths adventure", tag: "Play", href: "/games/math-quest" }];
  return (
    <section aria-labelledby="door-games" className={DOOR}>
      <a href="/games/math-quest" className="flex items-center justify-between gap-3">
        <DoorTitle id="door-games" title="Games" color="var(--warm)" icon={<Gamepad2 size={21} strokeWidth={1.9} />} />
        <span className="shrink-0 text-[0.8125rem] text-[var(--hud-text-dim)]">1 game</span>
      </a>
      <p className="text-[0.875rem] leading-relaxed text-[var(--hud-text-dim)]">Four worlds of maths: answer to cross bridges, free captives and beat each boss.</p>
      <DoorRows items={items} tagColor="var(--warm)" />
    </section>
  );
}
