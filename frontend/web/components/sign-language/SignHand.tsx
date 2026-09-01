"use client";

import type { SignFrame } from "./types";

const FINGER_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
] as const;

const PALM = [0, 1, 5, 9, 13, 17] as const;
const TIPS = new Set([4, 8, 12, 16, 20]);

function screenPoint(point: SignFrame[number]) {
  return {
    x: 42 + point[0] * 236,
    y: 26 + point[1] * 252,
    z: point[2],
  };
}

export function SignHand({ frame, active }: { frame: SignFrame | null; active: boolean }) {
  const points = frame?.length === 21 ? frame.map(screenPoint) : [];
  const palm = PALM.map((index) => points[index]).filter(Boolean);
  const wrist = points[0];

  return (
    <svg
      viewBox="0 0 320 340"
      role="img"
      aria-label={active ? "Animated hand performing ASL fingerspelling" : "Signing hand paused"}
      className="h-full w-full"
    >
      <defs>
        <linearGradient id="sign-skin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4c8a7" />
          <stop offset="0.5" stopColor="#d99a73" />
          <stop offset="1" stopColor="#a96044" />
        </linearGradient>
        <filter id="sign-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#000" floodOpacity="0.42" />
        </filter>
      </defs>

      <g
        filter="url(#sign-shadow)"
        className={active ? "opacity-100" : "opacity-75"}
        style={{ transition: "opacity 180ms ease" }}
      >
        {wrist && (
          <path
            d={`M ${wrist.x - 21} ${wrist.y + 5} C ${wrist.x - 30} 298, ${wrist.x - 36} 322, ${wrist.x - 36} 350 L ${wrist.x + 38} 350 C ${wrist.x + 36} 322, ${wrist.x + 28} 296, ${wrist.x + 21} ${wrist.y + 5} Z`}
            fill="url(#sign-skin)"
            stroke="#7d3f30"
            strokeWidth="2"
          />
        )}

        {FINGER_EDGES.map(([from, to]) => {
          const a = points[from];
          const b = points[to];
          if (!a || !b) return null;
          const width = from === 0 ? 25 : from % 4 === 0 ? 16 : 20;
          return (
            <g key={`${from}-${to}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#6f382c" strokeWidth={width + 4} strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="url(#sign-skin)" strokeWidth={width} strokeLinecap="round" />
              <line x1={a.x - 1.5} y1={a.y - 2} x2={b.x - 1.5} y2={b.y - 2} stroke="#ffe4cf" strokeOpacity="0.3" strokeWidth={Math.max(3, width * 0.18)} strokeLinecap="round" />
            </g>
          );
        })}

        {palm.length > 2 && (
          <polygon
            points={palm.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="url(#sign-skin)"
            stroke="#743b2e"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        )}

        {points.map((point, index) =>
          TIPS.has(index) ? (
            <circle key={index} cx={point.x} cy={point.y} r="7.5" fill="#f1b993" stroke="#743b2e" strokeWidth="2" />
          ) : null,
        )}
      </g>
    </svg>
  );
}
