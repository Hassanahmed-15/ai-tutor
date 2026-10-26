"use client";

import type { Mark } from "@/lib/canvas/layout";

/**
 * A message sequence board (lib/canvas/sequence.ts): each party's name and lifeline, then each message
 * as a downward arrow, its name above and what it carries below, drawn on the sentence that sends it.
 * Everything was placed by code (sequenceGeometry); this only draws it. The colours are the renderer's
 * own, so the chalk board lifts them (lib/canvas/theme.ts).
 */
const INK = "#1f2937";
const MUTED = "#64748b";
const RIGHT = "#2563eb";
const LEFT = "#c2410c";
const LOST = "#be123c";

export function SequenceView({ mark, shownThrough, focusId }: { mark: Extract<Mark, { type: "sequence" }>; shownThrough: number; focusId?: string }) {
  const g = mark.geometry;
  return (
    <g>
      {g.lanes.filter((l) => l.s <= shownThrough).map((l) => (
        <g key={l.id} data-target={`lane-${l.id}`}>
          <line x1={l.x} y1={l.head.y + l.head.h} x2={l.x} y2={g.lifeline.bottom} stroke={MUTED} strokeWidth={1.8} strokeDasharray="6 7" className="cv-in" />
          <rect x={l.head.x} y={l.head.y} width={l.head.w} height={l.head.h} rx={10} fill="#fff" stroke={INK} strokeWidth={focusId === `lane-${l.id}` ? 2.8 : 2} className="cv-in" />
          <text x={l.x} y={l.head.y + l.head.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={l.size} fontWeight={800} fill={INK}>
            {l.label}
          </text>
        </g>
      ))}
      {g.states.filter((st) => st.s <= shownThrough).map((st, i) => (
        <g key={`${st.lane}-${i}`}>
          <rect x={st.box.x} y={st.box.y} width={st.box.w} height={st.box.h} rx={7} fill="#fef3c7" stroke={MUTED} strokeWidth={1.4} className="cv-in" />
          <text x={st.box.x + st.box.w / 2} y={st.box.y + st.box.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={st.size} fontWeight={700} fill={INK}>
            {st.label}
          </text>
        </g>
      ))}
      {g.messages.filter((m) => m.s <= shownThrough).map((m) => {
        const color = m.lost ? LOST : m.rightward ? RIGHT : LEFT;
        const focused = focusId === `msg-${m.id}`;
        const ang = Math.atan2(m.p1.y - m.p0.y, m.p1.x - m.p0.x);
        const arm = (t: number) => `${m.p1.x - Math.cos(ang + t) * 14} ${m.p1.y - Math.sin(ang + t) * 14}`;
        return (
          <g key={m.id} data-target={`msg-${m.id}`}>
            {/* The arrow and its head (or a lost message's cross) are one stroke, so the pen draws the head last, not first. */}
            <path
              d={m.lost
                ? `M${m.p0.x} ${m.p0.y} L${m.p1.x} ${m.p1.y} M${m.p1.x - 9} ${m.p1.y - 9} L${m.p1.x + 9} ${m.p1.y + 9} M${m.p1.x + 9} ${m.p1.y - 9} L${m.p1.x - 9} ${m.p1.y + 9}`
                : `M${m.p0.x} ${m.p0.y} L${m.p1.x} ${m.p1.y} L${arm(0.42)} M${m.p1.x} ${m.p1.y} L${arm(-0.42)}`}
              fill="none" stroke={color} strokeWidth={focused ? 3.6 : 2.8} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="cv-stroke"
            />
            <text x={m.labelAt.x} y={m.labelAt.y} transform={`rotate(${m.angle.toFixed(2)} ${m.labelAt.x} ${m.labelAt.y})`} textAnchor="middle" dominantBaseline="central" fontSize={m.labelSize} fontWeight={800} fill={color}>
              {m.label}
            </text>
            {m.detail && m.detailAt && (
              <text x={m.detailAt.x} y={m.detailAt.y} transform={`rotate(${m.angle.toFixed(2)} ${m.detailAt.x} ${m.detailAt.y})`} textAnchor="middle" dominantBaseline="central" fontSize={m.detailSize} fontWeight={600} fill={INK}>
                {m.detail}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
