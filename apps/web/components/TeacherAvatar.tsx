"use client";

/**
 * Aria — an illustrated teacher character (pure SVG, no external assets). The mouth
 * animates open/closed while speaking so it reads as "someone is teaching me"; eyes blink
 * on idle. Tuned for the dark premium theme with a soft glow halo when active.
 */
export function TeacherAvatar({ speaking, size = 120 }: { speaking: boolean; size?: number }) {
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* glow halo when speaking */}
      <div
        className={`absolute inset-0 rounded-full blur-xl transition-opacity duration-500 ${speaking ? "opacity-90" : "opacity-30"}`}
        style={{ background: "radial-gradient(circle, rgba(129,140,248,0.7), transparent 70%)" }}
      />
      {speaking && (
        <span className="absolute inset-[-6px] rounded-full ring-2 ring-indigo-400/50 av-ring" />
      )}
      <svg viewBox="0 0 120 120" width={size} height={size} className="relative">
        <defs>
          <radialGradient id="av-face" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#fce7d4" />
            <stop offset="100%" stopColor="#f3c9a6" />
          </radialGradient>
          <linearGradient id="av-hair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4338ca" />
            <stop offset="100%" stopColor="#312e81" />
          </linearGradient>
        </defs>

        {/* shoulders / collar */}
        <path d="M18 120 Q60 86 102 120 Z" fill="#1e1b4b" />
        <path d="M52 96 L60 108 L68 96 Z" fill="#6366f1" />

        {/* neck */}
        <rect x="52" y="78" width="16" height="16" rx="7" fill="#f0bd97" />

        {/* head */}
        <circle cx="60" cy="52" r="30" fill="url(#av-face)" />

        {/* hair */}
        <path d="M30 50 Q32 20 60 20 Q88 20 90 50 Q86 36 60 34 Q34 36 30 50 Z" fill="url(#av-hair)" />
        <path d="M30 50 Q28 64 33 70 Q31 54 38 46 Z" fill="url(#av-hair)" />
        <path d="M90 50 Q92 64 87 70 Q89 54 82 46 Z" fill="url(#av-hair)" />

        {/* eyes (blink on idle via CSS) */}
        <g className={speaking ? "" : "av-blink"}>
          <ellipse cx="50" cy="50" rx="3.4" ry="4.2" fill="#1f2937" />
          <ellipse cx="70" cy="50" rx="3.4" ry="4.2" fill="#1f2937" />
          <circle cx="51.1" cy="48.6" r="1.1" fill="#fff" />
          <circle cx="71.1" cy="48.6" r="1.1" fill="#fff" />
        </g>

        {/* brows */}
        <path d="M45 42 Q50 39 55 42" stroke="#6b4b3a" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M65 42 Q70 39 75 42" stroke="#6b4b3a" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* cheeks */}
        <circle cx="44" cy="60" r="4" fill="#f4a98a" opacity="0.5" />
        <circle cx="76" cy="60" r="4" fill="#f4a98a" opacity="0.5" />

        {/* mouth: animates while speaking, gentle smile when idle */}
        {speaking ? (
          <ellipse cx="60" cy="64" rx="6" ry="3" fill="#7c2d12" className="av-talk" />
        ) : (
          <path d="M53 63 Q60 69 67 63" stroke="#7c2d12" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </div>
  );
}
