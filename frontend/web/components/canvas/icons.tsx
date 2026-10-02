import type { CanvasIcon } from "@/lib/canvas/types";

/**
 * The canvas's own icon set: flat, soft-shaded glyphs in a 100 x 100 box centred on (0, 0), drawn
 * once by hand so every flow and scene board shares one visual language. The model only NAMES an
 * icon (lib/canvas/types.ts CANVAS_ICONS); an unknown name never reaches here.
 */
export function IconGlyph({ name, color }: { name: CanvasIcon; color: string }) {
  const ink = "#1f2937";
  switch (name) {
    case "sun":
      return (
        <g>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return <line key={i} x1={Math.cos(a) * 30} y1={Math.sin(a) * 30} x2={Math.cos(a) * 44} y2={Math.sin(a) * 44} stroke="#f59e0b" strokeWidth={5} strokeLinecap="round" />;
          })}
          <circle r={24} fill="#fbbf24" stroke="#d97706" strokeWidth={3} />
          <circle cx={-7} cy={-8} r={7} fill="#fde68a" opacity={0.8} />
        </g>
      );
    case "water":
      return (
        <g>
          <path d="M0 -40 C 14 -20 28 -4 28 12 A 28 28 0 0 1 -28 12 C -28 -4 -14 -20 0 -40 Z" fill="#60a5fa" stroke="#2563eb" strokeWidth={3} />
          <path d="M-12 8 A 13 13 0 0 0 -2 24" stroke="#dbeafe" strokeWidth={5} fill="none" strokeLinecap="round" />
        </g>
      );
    case "gas":
      return (
        <g>
          <path d="M-34 14 A 16 16 0 0 1 -26 -14 A 22 22 0 0 1 12 -24 A 18 18 0 0 1 36 -2 A 14 14 0 0 1 28 22 L -26 22 A 12 12 0 0 1 -34 14 Z" fill="#e2e8f0" stroke="#64748b" strokeWidth={3} />
          <circle cx={-10} cy={2} r={7} fill="#475569" />
          <circle cx={4} cy={2} r={9} fill="#1f2937" />
          <circle cx={18} cy={2} r={7} fill="#475569" />
        </g>
      );
    case "leaf":
      return (
        <g transform="rotate(-30)">
          <path d="M0 -44 C 30 -26 30 22 0 44 C -30 22 -30 -26 0 -44 Z" fill="#4ade80" stroke="#15803d" strokeWidth={3} />
          <path d="M0 -40 L0 44" stroke="#15803d" strokeWidth={3} />
          {[-22, -6, 10].map((y) => (
            <g key={y}>
              <path d={`M0 ${y} Q 12 ${y - 8} 18 ${y - 16}`} stroke="#15803d" strokeWidth={2} fill="none" />
              <path d={`M0 ${y} Q -12 ${y - 8} -18 ${y - 16}`} stroke="#15803d" strokeWidth={2} fill="none" />
            </g>
          ))}
        </g>
      );
    case "chloroplast":
      return (
        <g>
          <ellipse rx={44} ry={28} fill="#86efac" stroke="#15803d" strokeWidth={3} />
          <ellipse rx={38} ry={22} fill="none" stroke="#16a34a" strokeWidth={1.5} opacity={0.7} />
          {[-24, -6, 12, 28].map((x, k) => (
            <g key={x}>
              {[-9, -3, 3, 9].map((y) => (
                <rect key={y} x={x - 7} y={y - 2.5 + (k % 2 ? 4 : -2)} width={14} height={5} rx={2.5} fill="#15803d" />
              ))}
            </g>
          ))}
        </g>
      );
    case "sugar":
      return (
        <g>
          <polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" fill="#fdba74" stroke="#c2410c" strokeWidth={3.5} />
          <polygon points="0,-20 17,-10 17,10 0,20 -17,10 -17,-10" fill="none" stroke="#ea580c" strokeWidth={2} opacity={0.6} />
          <circle cx={29} cy={-17} r={5} fill="#c2410c" />
          <circle cx={-29} cy={17} r={5} fill="#c2410c" />
        </g>
      );
    case "oxygen":
      return (
        <g>
          <circle cx={-10} cy={6} r={20} fill="#bae6fd" stroke="#0284c7" strokeWidth={3} />
          <circle cx={16} cy={-12} r={13} fill="#bae6fd" stroke="#0284c7" strokeWidth={3} />
          <circle cx={20} cy={22} r={8} fill="#bae6fd" stroke="#0284c7" strokeWidth={2.5} />
          <circle cx={-16} cy={-1} r={5} fill="#f0f9ff" />
        </g>
      );
    case "energy":
      return <path d="M8 -42 L -22 6 L 0 6 L -8 42 L 24 -8 L 2 -8 Z" fill="#facc15" stroke="#ca8a04" strokeWidth={3} strokeLinejoin="round" />;
    case "cell":
      return (
        <g>
          <rect x={-42} y={-32} width={84} height={64} rx={22} fill="#dcfce7" stroke="#16a34a" strokeWidth={3} />
          <circle cx={-10} cy={-2} r={13} fill="#a78bfa" stroke="#6d28d9" strokeWidth={2.5} />
          <ellipse cx={20} cy={14} rx={10} ry={6} fill="#4ade80" stroke="#15803d" strokeWidth={2} />
          <ellipse cx={22} cy={-16} rx={9} ry={5} fill="#4ade80" stroke="#15803d" strokeWidth={2} />
        </g>
      );
    case "plant":
      return (
        <g>
          <path d="M-22 44 L 22 44 L 16 22 L -16 22 Z" fill="#fb923c" stroke="#c2410c" strokeWidth={3} />
          <path d="M0 22 L0 -18" stroke="#15803d" strokeWidth={4} />
          <path d="M0 -4 C -26 -8 -30 -30 -30 -30 C -8 -32 0 -18 0 -4 Z" fill="#4ade80" stroke="#15803d" strokeWidth={2.5} />
          <path d="M0 -14 C 24 -18 30 -40 30 -40 C 8 -42 0 -28 0 -14 Z" fill="#4ade80" stroke="#15803d" strokeWidth={2.5} />
        </g>
      );
    case "root":
      return (
        <g stroke="#92400e" strokeWidth={4} fill="none" strokeLinecap="round">
          <path d="M0 -40 L0 0 C 0 16 -14 24 -24 40" />
          <path d="M0 0 C 2 18 14 26 26 38" />
          <path d="M0 -12 C -10 -4 -22 -2 -32 6" />
          <path d="M0 -20 C 10 -12 22 -10 32 -4" />
        </g>
      );
    case "cloud":
      return <path d="M-36 18 A 16 16 0 0 1 -28 -10 A 22 22 0 0 1 12 -22 A 18 18 0 0 1 38 0 A 14 14 0 0 1 30 24 L -28 24 A 12 12 0 0 1 -36 18 Z" fill="#f1f5f9" stroke="#94a3b8" strokeWidth={3} />;
    case "flame":
      return (
        <g>
          <path d="M0 -44 C 18 -20 32 -6 26 18 A 26 26 0 0 1 -26 18 C -30 -2 -12 -12 0 -44 Z" fill="#fb923c" stroke="#c2410c" strokeWidth={3} />
          <path d="M0 -8 C 10 4 14 12 10 24 A 11 11 0 0 1 -10 24 C -12 14 -6 6 0 -8 Z" fill="#fde047" />
        </g>
      );
    case "atom":
      return (
        <g fill="none" stroke={color} strokeWidth={3}>
          <ellipse rx={42} ry={15} />
          <ellipse rx={42} ry={15} transform="rotate(60)" />
          <ellipse rx={42} ry={15} transform="rotate(-60)" />
          <circle r={8} fill={color} stroke="none" />
        </g>
      );
    case "battery":
      return (
        <g>
          <rect x={-36} y={-20} width={66} height={40} rx={6} fill="#ecfccb" stroke="#4d7c0f" strokeWidth={3} />
          <rect x={30} y={-8} width={8} height={16} rx={2} fill="#4d7c0f" />
          <rect x={-30} y={-14} width={36} height={28} rx={3} fill="#84cc16" />
        </g>
      );
    case "person":
      return (
        <g>
          <circle cy={-22} r={16} fill="#fcd34d" stroke={ink} strokeWidth={2.5} />
          <path d="M-30 42 C -30 8 -16 0 0 0 C 16 0 30 8 30 42 Z" fill={color} stroke={ink} strokeWidth={2.5} />
        </g>
      );
    case "earth":
      return (
        <g>
          <circle r={40} fill="#60a5fa" stroke="#1d4ed8" strokeWidth={3} />
          <path d="M-26 -22 C -10 -30 4 -18 -4 -6 C -12 6 -30 2 -32 -8 Z M8 6 C 22 0 34 10 26 24 C 18 34 4 28 8 6 Z M10 -34 C 20 -32 28 -24 24 -18 C 16 -20 10 -26 10 -34 Z" fill="#4ade80" stroke="#15803d" strokeWidth={2} />
        </g>
      );
    case "gear":
      return (
        <g>
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={-7} y={-44} width={14} height={16} rx={3} fill="#94a3b8" stroke="#475569" strokeWidth={2} transform={`rotate(${i * 45})`} />
          ))}
          <circle r={32} fill="#cbd5e1" stroke="#475569" strokeWidth={3} />
          <circle r={11} fill="#f8fafc" stroke="#475569" strokeWidth={3} />
        </g>
      );
    case "heart":
      return <path d="M0 36 C -44 8 -40 -30 -18 -32 C -8 -33 -2 -26 0 -20 C 2 -26 8 -33 18 -32 C 40 -30 44 8 0 36 Z" fill="#fb7185" stroke="#be123c" strokeWidth={3} />;
    case "lungs":
      return (
        <g>
          <path d="M-6 -36 L -6 -8 C -14 -14 -36 -12 -38 14 C -40 34 -26 40 -10 34 C -6 32 -6 20 -6 -8" fill="#fda4af" stroke="#be123c" strokeWidth={3} />
          <path d="M6 -36 L 6 -8 C 14 -14 36 -12 38 14 C 40 34 26 40 10 34 C 6 32 6 20 6 -8" fill="#fda4af" stroke="#be123c" strokeWidth={3} />
        </g>
      );
    case "stomata":
      return (
        <g>
          <path d="M0 -36 C 30 -30 30 30 0 36 C 10 20 10 -20 0 -36 Z" fill="#86efac" stroke="#15803d" strokeWidth={3} />
          <path d="M0 -36 C -30 -30 -30 30 0 36 C -10 20 -10 -20 0 -36 Z" fill="#86efac" stroke="#15803d" strokeWidth={3} />
          <ellipse rx={5} ry={26} fill="#1f2937" opacity={0.75} />
        </g>
      );
    case "animal":
      return (
        <g>
          <ellipse cx={0} cy={6} rx={34} ry={20} fill="#fcd34d" stroke={ink} strokeWidth={2.5} />
          <circle cx={30} cy={-14} r={14} fill="#fcd34d" stroke={ink} strokeWidth={2.5} />
          <path d="M-20 22 L -22 40 M -4 24 L -4 40 M 12 24 L 12 40 M 24 20 L 26 38" stroke={ink} strokeWidth={4} strokeLinecap="round" />
          <circle cx={34} cy={-17} r={2.5} fill={ink} />
        </g>
      );
    case "factory":
      return (
        <g>
          <path d="M-40 40 L -40 -4 L -16 -18 L -16 -4 L 8 -18 L 8 -4 L 40 -22 L 40 40 Z" fill="#e2e8f0" stroke="#475569" strokeWidth={3} strokeLinejoin="round" />
          <rect x={22} y={-42} width={10} height={24} fill="#94a3b8" stroke="#475569" strokeWidth={2.5} />
          <rect x={-28} y={12} width={12} height={12} fill="#fbbf24" />
          <rect x={0} y={12} width={12} height={12} fill="#fbbf24" />
        </g>
      );
    case "airplane":
      return (
        <g transform="rotate(-20)">
          <path d="M-40 4 C -40 -4 -30 -8 -16 -8 L 30 -8 C 40 -8 44 -2 44 2 C 44 6 40 8 30 8 L -16 8 C -30 8 -40 10 -40 4 Z" fill="#e2e8f0" stroke="#334155" strokeWidth={2.5} />
          <path d="M-4 -6 L 10 -38 L 20 -38 L 14 -6 Z" fill="#60a5fa" stroke="#1d4ed8" strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M-4 6 L 10 36 L 20 36 L 14 6 Z" fill="#60a5fa" stroke="#1d4ed8" strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M-34 -6 L -40 -24 L -32 -24 L -24 -7 Z" fill="#60a5fa" stroke="#1d4ed8" strokeWidth={2.5} strokeLinejoin="round" />
          <circle cx={34} cy={0} r={3} fill="#1e3a8a" />
        </g>
      );
    case "wing":
      return (
        <g>
          <path d="M-42 6 C -40 -14 -14 -24 14 -20 C 30 -18 42 -8 44 4 C 20 2 -10 6 -42 6 Z" fill="#93c5fd" stroke="#1d4ed8" strokeWidth={3} strokeLinejoin="round" />
          {[-24, -6, 12].map((y) => (
            <path key={y} d={`M-46 ${y + 22} C -20 ${y + 18} 10 ${y + 18} 44 ${y + 26}`} stroke="#94a3b8" strokeWidth={2} fill="none" strokeDasharray="5 5" />
          ))}
        </g>
      );
    case "force":
      return (
        <g>
          <path d="M-38 0 L 18 0" stroke={color} strokeWidth={11} strokeLinecap="round" />
          <path d="M14 -20 L 42 0 L 14 20 Z" fill={color} stroke={color} strokeWidth={3} strokeLinejoin="round" />
          <text x={-18} y={-16} fontSize={20} fontWeight={800} fill={color}>F</text>
        </g>
      );
    case "magnet":
      return (
        <g>
          <path d="M-30 -30 L -30 6 A 30 30 0 0 0 30 6 L 30 -30 L 14 -30 L 14 6 A 14 14 0 0 1 -14 6 L -14 -30 Z" fill="#ef4444" stroke="#991b1b" strokeWidth={3} strokeLinejoin="round" />
          <rect x={-30} y={-40} width={16} height={12} fill="#e5e7eb" stroke="#475569" strokeWidth={2.5} />
          <rect x={14} y={-40} width={16} height={12} fill="#e5e7eb" stroke="#475569" strokeWidth={2.5} />
        </g>
      );
    case "bulb":
      return (
        <g>
          <path d="M0 -40 A 26 26 0 0 1 16 6 C 12 10 10 14 10 20 L -10 20 C -10 14 -12 10 -16 6 A 26 26 0 0 1 0 -40 Z" fill="#fde047" stroke="#ca8a04" strokeWidth={3} />
          <rect x={-10} y={20} width={20} height={14} rx={3} fill="#94a3b8" stroke="#475569" strokeWidth={2.5} />
          <path d="M-6 0 L -2 -12 L 2 0 L 6 -12" stroke="#a16207" strokeWidth={2.5} fill="none" />
        </g>
      );
    case "wave":
      return <path d="M-44 0 C -34 -26 -22 -26 -12 0 C -2 26 10 26 20 0 C 30 -26 40 -26 46 -10" stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" />;
    case "car":
      return (
        <g>
          <path d="M-42 12 L -42 -2 C -42 -8 -36 -10 -30 -10 L -18 -26 L 18 -26 L 30 -10 C 38 -10 42 -6 42 0 L 42 12 Z" fill={color} stroke="#1f2937" strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M-14 -22 L -8 -12 L 22 -12 L 14 -22 Z" fill="#e0f2fe" stroke="#1f2937" strokeWidth={2} />
          <circle cx={-24} cy={14} r={10} fill="#1f2937" />
          <circle cx={24} cy={14} r={10} fill="#1f2937" />
        </g>
      );
    case "ice":
      return (
        <g>
          <path d="M-30 -14 L 0 -32 L 30 -14 L 30 22 L 0 40 L -30 22 Z" fill="#e0f2fe" stroke="#0284c7" strokeWidth={3} strokeLinejoin="round" />
          <path d="M-30 -14 L 0 4 L 30 -14 M 0 4 L 0 40" fill="none" stroke="#0284c7" strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M-20 -12 L -6 -20" stroke="#fff" strokeWidth={4} strokeLinecap="round" />
        </g>
      );
    case "steam":
      return (
        <g fill="none" stroke="#94a3b8" strokeWidth={5} strokeLinecap="round">
          <path d="M-18 36 C -30 20 -6 10 -18 -6 C -28 -20 -10 -30 -16 -42" />
          <path d="M2 36 C -10 20 14 10 2 -6 C -8 -20 10 -30 4 -42" />
          <path d="M22 36 C 10 20 34 10 22 -6 C 12 -20 30 -30 24 -42" />
        </g>
      );
    case "book":
      return (
        <g>
          <path d="M0 -26 C -14 -34 -32 -34 -40 -30 L -40 30 C -32 26 -14 26 0 34 Z" fill="#bfdbfe" stroke="#1d4ed8" strokeWidth={3} />
          <path d="M0 -26 C 14 -34 32 -34 40 -30 L 40 30 C 32 26 14 26 0 34 Z" fill="#dbeafe" stroke="#1d4ed8" strokeWidth={3} />
        </g>
      );
  }
}
