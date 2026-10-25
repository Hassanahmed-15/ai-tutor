"use client";

import type { Mark } from "@/lib/canvas/layout";

/**
 * The operating-systems pictures (lib/canvas/osDiagrams.ts): a lifecycle, an address space and a CPU
 * schedule. Everything was placed by code; this only draws it, each part on the sentence that says it.
 * The colours are the renderer's own, so the chalk board lifts them (lib/canvas/theme.ts).
 */
const INK = "#1f2937";
const MUTED = "#64748b";
const ACCENT = "#c2410c";

type Props<T extends Mark["type"]> = { mark: Extract<Mark, { type: T }>; shownThrough: number; focusId?: string };

/** States as ovals, curved labelled transitions, and the process chip gliding from state to state. */
export function OsStatesView({ mark, shownThrough, focusId }: Props<"os-states">) {
  const g = mark.geometry;
  // Where each process is now, and the arrow it has just taken (lit on the sentence it moves).
  const now = g.tokens.map((tk) => {
    const stops = tk.stops.filter((st) => st.s <= shownThrough);
    return { tk, stop: stops.at(-1) };
  });
  const lit = new Set(now.flatMap(({ stop }) => (stop?.via && stop.s === shownThrough ? [stop.via] : [])));
  const holding = new Set(now.flatMap(({ stop }) => (stop ? [stop.state] : [])));
  return (
    <g>
      {g.transitions.filter((t) => t.s <= shownThrough).map((t) => {
        const on = lit.has(t.id) || focusId === `tr-${t.id}`;
        return (
          <g key={t.id} data-target={`tr-${t.id}`}>
            <path d={t.d} fill="none" stroke={on ? ACCENT : INK} strokeWidth={on ? 3.4 : 2.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="cv-stroke" />
            {t.label && t.labelAt && (
              <text x={t.labelAt.x} y={t.labelAt.y} textAnchor="middle" dominantBaseline="central" fontSize={t.labelSize} fontWeight={700} fill={on ? ACCENT : INK} data-halo="1">
                {t.label}
              </text>
            )}
          </g>
        );
      })}
      {g.states.filter((st) => st.s <= shownThrough).map((st) => {
        const strong = holding.has(st.id) || focusId === `state-${st.id}`;
        return (
          <g key={st.id} data-target={`state-${st.id}`} className="cv-in">
            <ellipse cx={st.cx} cy={st.cy} rx={st.rx} ry={st.ry} fill={st.color} fillOpacity={strong ? 0.3 : 0.16} stroke={st.color} strokeWidth={strong ? 3.6 : 2.4} />
            <text x={st.cx} y={st.labelY} textAnchor="middle" dominantBaseline="central" fontSize={st.size} fontWeight={800} fill={INK}>
              {st.label}
            </text>
          </g>
        );
      })}
      {now.map(({ tk, stop }) => stop && (
        <g key={tk.id} data-target={`token-${tk.id}`} style={{ transform: `translate(${stop.x}px, ${stop.y}px)`, transition: "transform 900ms cubic-bezier(.45,0,.25,1)" }}>
          <rect x={-tk.w / 2} y={-tk.h / 2} width={tk.w} height={tk.h} rx={tk.h / 2} fill={tk.color} stroke={tk.color} strokeWidth={1.5} />
          <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={tk.size} fontWeight={800} fill="#ffffff">
            {tk.label}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Blocks of memory stacked top to bottom, a shared row over each thread's own, growth arrows into the gap. */
export function OsMemoryView({ mark, shownThrough, focusId }: Props<"os-memory">) {
  const g = mark.geometry;
  const first = Math.min(...g.blocks.map((b) => b.s));
  return (
    <g>
      {g.outline && first <= shownThrough && (
        <rect x={g.outline.x} y={g.outline.y} width={g.outline.w} height={g.outline.h} rx={14} fill="none" stroke={MUTED} strokeWidth={1.6} strokeDasharray="7 6" className="cv-in" />
      )}
      {g.sharedLabel && g.sharedLabel.s <= shownThrough && (
        <text x={g.sharedLabel.at.x} y={g.sharedLabel.at.y - 8} fontSize={14} fontWeight={700} fill={MUTED}>
          {g.sharedLabel.text}
        </text>
      )}
      {g.blocks.filter((b) => b.s <= shownThrough).map((b) => {
        const focused = focusId === `seg-${b.id}`;
        const hasNoteInside = b.note && b.noteAt === "inside";
        const labelY = b.rect.y + b.rect.h / 2 - (hasNoteInside ? b.noteSize * 0.62 : 0);
        return (
          <g key={b.id} data-target={`seg-${b.id}`} className="cv-in">
            <rect x={b.rect.x} y={b.rect.y} width={b.rect.w} height={b.rect.h} fill={b.free ? "none" : b.color} fillOpacity={b.free ? 0 : focused ? 0.32 : 0.16} stroke={b.free ? MUTED : b.color} strokeWidth={focused ? 3.4 : 2.2} strokeDasharray={b.free ? "6 6" : undefined} />
            {b.label && (
              <text x={b.rect.x + b.rect.w / 2} y={labelY} textAnchor="middle" dominantBaseline="central" fontSize={b.size} fontWeight={800} fill={b.free ? MUTED : INK}>
                {b.label}
              </text>
            )}
            {hasNoteInside && (
              <text x={b.rect.x + b.rect.w / 2} y={labelY + b.size * 0.62 + b.noteSize * 0.7} textAnchor="middle" dominantBaseline="central" fontSize={b.noteSize} fontWeight={600} fill={MUTED}>
                {b.note}
              </text>
            )}
            {b.note && b.noteAt === "right" && (
              <g>
                <line x1={b.rect.x + b.rect.w + 4} y1={b.rect.y + b.rect.h / 2} x2={b.rect.x + b.rect.w + 18} y2={b.rect.y + b.rect.h / 2} stroke={MUTED} strokeWidth={1.4} />
                <text x={b.rect.x + b.rect.w + 24} y={b.rect.y + b.rect.h / 2} dominantBaseline="central" fontSize={b.noteSize} fontWeight={600} fill={MUTED}>
                  {b.note}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {g.growth.filter((a) => a.s <= shownThrough).map((a) => {
        const up = a.p1.y < a.p0.y;
        const head = `M${a.p1.x - 7} ${a.p1.y + (up ? 9 : -9)} L${a.p1.x} ${a.p1.y} L${a.p1.x + 7} ${a.p1.y + (up ? 9 : -9)}`;
        return (
          <g key={a.segment}>
            <path d={`M${a.p0.x} ${a.p0.y} L${a.p1.x} ${a.p1.y} ${head.replace(/^M/, "M")}`} fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="cv-stroke" />
            {a.label && (
              <text x={a.labelAt.x} y={a.labelAt.y} dominantBaseline="central" fontSize={13} fontWeight={700} fill={MUTED}>
                {a.label}
              </text>
            )}
          </g>
        );
      })}
      {g.columns.filter((c) => c.label && c.s <= shownThrough).map((c) => (
        <text key={c.id} x={c.labelAt.x} y={c.labelAt.y} textAnchor="middle" dominantBaseline="central" fontSize={c.size} fontWeight={800} fill={INK}>
          {c.label}
        </text>
      ))}
      {g.addresses && g.addresses.s <= shownThrough && (
        <g>
          <text x={g.addresses.x} y={g.addresses.topY} textAnchor="end" dominantBaseline="central" fontSize={13} fontWeight={700} fill={MUTED}>{g.addresses.top}</text>
          <text x={g.addresses.x} y={g.addresses.bottomY} textAnchor="end" dominantBaseline="central" fontSize={13} fontWeight={700} fill={MUTED}>{g.addresses.bottom}</text>
        </g>
      )}
    </g>
  );
}

/** The CPU bar, each slot drawn on its sentence, times under the boundaries, arrivals above, the ready queue below. */
export function OsGanttView({ mark, shownThrough, focusId }: Props<"os-gantt">) {
  const g = mark.geometry;
  const first = Math.min(...g.slots.map((sl) => sl.s));
  const queue = g.queue?.states.filter((q) => q.s <= shownThrough).at(-1);
  return (
    <g>
      {g.bars.filter((b) => b.s <= shownThrough).map((b) => (
        <g key={b.label} className="cv-in">
          <rect x={b.rect.x} y={b.rect.y} width={b.rect.w} height={b.rect.h} fill="none" stroke={MUTED} strokeWidth={1.4} strokeDasharray="5 6" />
          <text x={b.labelAt.x} y={b.labelAt.y} textAnchor="middle" dominantBaseline="central" fontSize={b.size} fontWeight={800} fill={INK}>{b.label}</text>
        </g>
      ))}
      {g.unit && first <= shownThrough && <text x={g.unit.at.x} y={g.unit.at.y} textAnchor="end" fontSize={13} fontWeight={700} fill={MUTED}>{g.unit.text}</text>}
      {g.arrivals.filter((a) => a.s <= shownThrough).map((a, i) => (
        <g key={`${a.label}-${i}`}>
          <path d={`M${a.x} ${a.top} L${a.x} ${a.bottom} M${a.x - 6} ${a.bottom - 8} L${a.x} ${a.bottom} L${a.x + 6} ${a.bottom - 8}`} fill="none" stroke={MUTED} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="cv-stroke" />
          <text x={a.x} y={a.top - 10} textAnchor="middle" fontSize={13} fontWeight={700} fill={MUTED}>{a.label}</text>
        </g>
      ))}
      {g.slots.filter((sl) => sl.s <= shownThrough).map((sl) => {
        const focused = focusId === sl.id;
        return (
          <g key={sl.id} data-target={sl.id} className="cv-in">
            <rect x={sl.rect.x} y={sl.rect.y} width={sl.rect.w} height={sl.rect.h} fill={sl.idle ? "none" : sl.color} fillOpacity={sl.idle ? 0 : focused ? 0.4 : 0.24} stroke={sl.color} strokeWidth={focused ? 3.4 : 2.2} strokeDasharray={sl.idle ? "5 5" : undefined} />
            <text x={sl.rect.x + sl.rect.w / 2} y={sl.rect.y + sl.rect.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={sl.size} fontWeight={800} fill={sl.idle ? MUTED : INK}>
              {sl.label}
            </text>
          </g>
        );
      })}
      {g.ticks.filter((t) => t.s <= shownThrough).map((t) => (
        <g key={`${t.top}-${t.value}`}>
          <line x1={t.x} y1={t.top} x2={t.x} y2={t.top + 7} stroke={INK} strokeWidth={1.6} />
          <text x={t.x} y={t.y} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>{t.value}</text>
        </g>
      ))}
      {g.queue && queue && (
        <g>
          <text x={g.queue.caption.x} y={g.queue.caption.y} dominantBaseline="central" fontSize={15} fontWeight={800} fill={MUTED}>Ready queue</text>
          {queue.chips.length === 0 && <text x={g.queue.x0} y={g.queue.y + g.queue.chipH / 2} dominantBaseline="central" fontSize={14} fontWeight={600} fill={MUTED}>empty</text>}
          {queue.chips.map((c) => (
            // Keyed by the process, so a process that moves up the queue glides there.
            <g key={c.label} style={{ transform: `translate(${c.x}px, ${g.queue!.y}px)`, transition: "transform 700ms cubic-bezier(.45,0,.25,1)" }}>
              <rect x={0} y={0} width={c.w} height={g.queue!.chipH} rx={8} fill={c.color} fillOpacity={0.24} stroke={c.color} strokeWidth={2} className="cv-in" />
              <text x={c.w / 2} y={g.queue!.chipH / 2} textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={800} fill={INK}>{c.label}</text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
}

/** Each group's top row mapped by arrows onto its bottom row (threading models, a page table). */
export function OsMappingView({ mark, shownThrough, focusId }: Props<"os-mapping">) {
  const g = mark.geometry;
  return (
    <g>
      {g.groups.filter((gr) => gr.s <= shownThrough).map((gr) => (
        <g key={gr.id} data-target={`map-${gr.id}`} className="cv-in">
          {g.groups.length > 1 && <rect x={gr.frame.x} y={gr.frame.y} width={gr.frame.w} height={gr.frame.h} rx={12} fill="none" stroke={focusId === `map-${gr.id}` ? ACCENT : MUTED} strokeWidth={1.4} strokeDasharray="6 6" />}
          {gr.label && <text x={gr.labelAt.x} y={gr.labelAt.y} textAnchor="middle" dominantBaseline="central" fontSize={16} fontWeight={800} fill={INK}>{gr.label}</text>}
        </g>
      ))}
      {g.rowLabels.filter((l) => l.s <= shownThrough).map((l) => (
        <text key={l.text} x={l.at.x} y={l.at.y} dominantBaseline="central" fontSize={14} fontWeight={700} fill={MUTED}>{l.text}</text>
      ))}
      {g.links.filter((l) => l.s <= shownThrough).map((l) => (
        <path key={l.id} d={l.d} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="cv-stroke" />
      ))}
      {g.items.filter((it) => it.s <= shownThrough).map((it) => {
        const focused = focusId === `item-${it.id}`;
        return (
          <g key={it.id} data-target={`item-${it.id}`} className="cv-in">
            <rect x={it.rect.x} y={it.rect.y} width={it.rect.w} height={it.rect.h} rx={it.row === "top" ? it.rect.h / 2 : 8} fill={it.color} fillOpacity={focused ? 0.34 : 0.18} stroke={it.color} strokeWidth={focused ? 3.2 : 2.2} />
            <text x={it.rect.x + it.rect.w / 2} y={it.rect.y + it.rect.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={it.size} fontWeight={800} fill={INK}>{it.label}</text>
          </g>
        );
      })}
    </g>
  );
}
