"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { mouthShape, visemeWeights } from "@/lib/adhd/mouth";
import { DOT_REST, dotMuscles, easeMuscles, type DotMuscles } from "@/lib/avatar/dotFace";
import type { VisemeWeights } from "@/lib/avatar/visemes";
import type { AvatarState } from "@/lib/avatar/face";

/**
 * DOT — the cartoon Aria: a glowing violet orb with a gold ring, capsule eyes and a drawn mouth.
 * Flat 2D on purpose (2D agents beat 3D ones in the meta-analyses; Castro-Alonso et al. 2021), and
 * drawn, so it costs nothing to load and runs on any phone.
 *
 * HOW SHE TALKS. The same mouth bus as the photoreal head (lib/adhd/mouth.ts): the live viseme
 * weights from the lip track say WHICH sound, the voice says how loud. lib/avatar/dotFace.ts turns
 * both into seven mouth muscles (jaw, spread, round, seal, f/v, tongue, teeth); this draws them every
 * frame without React (one rAF loop writing SVG attributes).
 *
 * WHAT ELSE MOVES, AND WHY ONLY THIS. A blink every few seconds, a breath while she is quiet, a small
 * nod when her voice lands on a stressed syllable, and her eyes on what she is pointing at (`gaze`).
 * Nothing drifts or bobs while she talks: motion that carries no meaning next to the lesson is a
 * distraction (seductive-details research), and the start of a motion is what pulls the eye.
 */
export type DotGaze = { x: number; y: number } | null;
/** A mouth from somewhere other than the voice bus (the home page greeting, typed letter by letter). */
export type DotMouthInput = { weights: VisemeWeights; open: number } | null;

export function DotAvatar({
  state,
  gaze,
  mouth,
  still = false,
  className = "",
}: {
  state: AvatarState;
  /** Where to look, as a direction (-1..1 each axis); null = at the student. Read every frame. */
  gaze?: RefObject<DotGaze>;
  /** Overrides the voice bus while it holds a value. Read every frame. */
  mouth?: RefObject<DotMouthInput>;
  /** Parked beside something she points at: no breath bob, no nod travel. */
  still?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const stateRef = useRef(state);
  const stillRef = useRef(still);
  useEffect(() => {
    stateRef.current = state;
    stillRef.current = still;
  }, [state, still]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const q = (k: string) => svg.querySelector(`[data-k="${k}"]`) as SVGElement;
    const P = {
      fig: q("fig"), irisL: q("irisL"), irisR: q("irisR"), eyeL: q("eyeL"), eyeR: q("eyeR"), cheekL: q("cheekL"), cheekR: q("cheekR"),
      mouth: q("mouth"), clip: q("clip"), teeth: q("teeth"), tongue: q("tongue"), lowerlip: q("lowerlip"), line: q("line"), fteeth: q("fteeth"), glow: q("glow"),
    };
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let m: DotMuscles = { ...DOT_REST };
    let nod = 0, nodV = 0, lift = 0, blink = -1, nextBlink = 2.5, clock = 0, breath = 0;
    let look = { x: 0, y: 0 }, idleLook = { x: 0, y: 0 }, nextLook = 1.5;
    let prevOpen = 0, lastBeat = -1;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      const s = stateRef.current;
      const ext = mouth?.current ?? null;
      const voice = ext ? { open: ext.open, width: 0.5 } : mouthShape();
      const talking = s === "speaking";
      m = easeMuscles(m, talking ? dotMuscles(ext ? ext.weights : (visemeWeights() as VisemeWeights), voice) : DOT_REST, dt);

      // A nod on a stressed syllable: the voice rising through a loud level, at most every 0.45 s.
      if (talking && !reduced && voice.open > 0.62 && prevOpen <= 0.62 && clock - lastBeat > 0.45) {
        lastBeat = clock;
        nodV += 22 * voice.open;
        if (voice.open > 0.85) lift = 1;
      }
      prevOpen = voice.open;
      nodV += (-180 * nod - 18 * nodV) * dt;
      nod += nodV * dt;
      lift *= Math.pow(0.04, dt);
      if (stillRef.current) nod *= 0.5;

      if (clock > nextBlink) { blink = 0; nextBlink = clock + (talking ? 2.2 : 3) + Math.random() * 2.4; }
      let lid = 1;
      if (blink >= 0) {
        blink += dt;
        const bt = blink / 0.17;
        if (bt >= 1) blink = -1;
        else lid = 1 - 0.92 * Math.sin(bt * Math.PI);
      }
      // Thinking: eyes up and to the side; listening: a little wider.
      if (s === "thinking") lid *= 0.85;
      if (s === "listening") lid *= 1.06;
      lid *= 1 + 0.08 * lift;

      // Eyes: on the target when pointing, else small glances (as people make), else at the student.
      const g = gaze?.current ?? null;
      if (!g && clock > nextLook) {
        idleLook = s === "thinking" ? { x: 0.5, y: -0.6 } : { x: (Math.random() * 2 - 1) * 0.5, y: (Math.random() * 2 - 1) * 0.3 };
        nextLook = clock + 1.2 + Math.random() * 2;
      }
      const want = g ?? idleLook;
      const k = 1 - Math.pow(0.7, dt * 60);
      look = { x: look.x + (want.x - look.x) * k, y: look.y + (want.y - look.y) * k };

      breath = !talking && !stillRef.current && !reduced ? 0.5 + 0.5 * Math.sin(clock * 1.6) : breath * 0.9;
      const sq = 1 - 0.03 * m.jaw + 0.012 * breath;
      P.fig.setAttribute("transform", `translate(0 ${(nod * 0.55).toFixed(2)}) rotate(${(nod * 0.35).toFixed(2)} 120 222) translate(120 222) scale(${(1 + 0.02 * m.jaw).toFixed(3)} ${sq.toFixed(3)}) translate(-120 -222)`);
      // Her irises look; the eyes and glasses stay on her face.
      const iris = `translate(${(look.x * 4).toFixed(2)} ${(look.y * 3).toFixed(2)})`;
      P.irisL.setAttribute("transform", iris);
      P.irisR.setAttribute("transform", iris);
      P.eyeL.setAttribute("transform", `translate(88.5 141) scale(1 ${lid.toFixed(3)}) translate(-88.5 -141)`);
      P.eyeR.setAttribute("transform", `translate(151.5 141) scale(1 ${lid.toFixed(3)}) translate(-151.5 -141)`);
      const smile = talking ? 0.3 : 0.5;
      const cheek = (0.36 + 0.25 * smile + 0.18 * m.spread).toFixed(2);
      P.cheekL.setAttribute("opacity", cheek);
      P.cheekR.setAttribute("opacity", cheek);
      P.glow.setAttribute("opacity", (s === "speaking" ? 0.5 : s === "listening" ? 0.4 : 0.28).toFixed(2));
      drawMouth(P, m, smile * (1 - m.round));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [gaze, mouth]);

  return (
    <svg
      ref={svgRef}
      viewBox="-12 -8 264 272"
      className={`overflow-visible ${className}`}
      role="img"
      aria-label="Aria"
      // A face needs a face's mouth: the theme's mouth and lip tokens are for the orb's violet or
      // orange skin, so on her skin the mouth is a warm rose, whatever the theme.
      style={{ ["--dot-mouth" as string]: "#6A2232", ["--dot-lip" as string]: "#D9787F", ["--dot-cheek" as string]: "#FF9D96" }}
    >
      <defs>
        <filter id={`${uid}b`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <clipPath id={`${uid}mc`}>
          <path data-k="clip" />
        </clipPath>
        {/* Her shirt, in the theme's colour (violet at night, orange by day). */}
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--dot-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--dot-body)" }} />
        </linearGradient>
        <radialGradient id={`${uid}k`} cx="42%" cy="36%" r="72%">
          <stop offset="0" stopColor="#FFE9DC" />
          <stop offset=".7" stopColor="#F7CDB4" />
          <stop offset="1" stopColor="#EBB394" />
        </radialGradient>
        <linearGradient id={`${uid}h`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#6B4A5E" />
          <stop offset="1" stopColor="#3A2534" />
        </linearGradient>
        <radialGradient id={`${uid}i`} cx="45%" cy="40%" r="60%">
          <stop offset="0" style={{ stopColor: "var(--dot-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--dot-edge)" }} />
        </radialGradient>
        <clipPath id={`${uid}el`}>
          <ellipse cx="88.5" cy="141" rx="14" ry="15" />
        </clipPath>
        <clipPath id={`${uid}er`}>
          <ellipse cx="151.5" cy="141" rx="14" ry="15" />
        </clipPath>
      </defs>
      {/*
        ARIA AS A PERSON (owner's direction, 2026-10-16: "aria should look like this … but in my colour
        scheme" — a friendly teacher with her hair tied back, big glasses and a collared shirt). Her
        shirt, glasses and eyes take the theme's colours; her skin and hair are a person's. The eyes,
        mouth and cheeks keep the coordinates the animation loop above drives.
      */}
      <g data-k="fig">
        <circle data-k="glow" cx="120" cy="140" r="96" style={{ fill: "var(--dot-body)" }} opacity=".42" filter={`url(#${uid}b)`} />
        {/* The ponytail, tied at the back and falling behind her right shoulder. */}
        <path d="M168 86 C206 82 222 116 216 156 C212 186 204 210 190 232 C196 202 198 176 192 150 C188 128 178 112 160 104 Z" fill={`url(#${uid}h)`} />
        <path d="M188 104 C206 122 208 156 200 196" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity=".14" />
        {/* Hair behind her head and ears. */}
        <path d="M46 150 C38 90 72 52 120 52 C168 52 202 90 194 150 C190 176 180 186 172 190 L68 190 C60 186 50 176 46 150 Z" fill={`url(#${uid}h)`} />
        {/* The hair tie, gold, where the ponytail is gathered. */}
        <rect x="184" y="96" width="20" height="13" rx="6" transform="rotate(32 194 102)" fill="#F5C86B" />
        <path d="M190 97 L187 106 M196 99 L193 108" stroke="#C99A3D" strokeWidth="1.6" strokeLinecap="round" />
        {/* Shoulders and shirt, with a collar and two gold buttons. */}
        <path d="M106 196 L106 228 Q120 240 134 228 L134 196 Z" fill="#E7AE8E" />
        <path d="M10 264 C12 244 34 232 70 228 L106 222 Q120 238 134 222 L170 228 C206 232 228 244 230 264 Z" fill={`url(#${uid}s)`} />
        <path d="M106 222 L94 242 L116 248 L120 234 Z M134 222 L146 242 L124 248 L120 234 Z" style={{ fill: "var(--dot-hi)", stroke: "var(--dot-edge)" }} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="120" cy="254" r="3" fill="#F5C86B" />
        {/* Ears, then her face. */}
        <ellipse cx="53" cy="148" rx="9" ry="14" fill="#F2BFA2" />
        <ellipse cx="187" cy="148" rx="9" ry="14" fill="#F2BFA2" />
        <path d="M120 66 C162 66 187 96 187 140 C187 182 158 212 120 212 C82 212 53 182 53 140 C53 96 78 66 120 66 Z" fill={`url(#${uid}k)`} />
        <ellipse data-k="cheekL" cx="78" cy="170" rx="13" ry="8" style={{ fill: "var(--dot-cheek)" }} opacity=".4" />
        <ellipse data-k="cheekR" cx="162" cy="170" rx="13" ry="8" style={{ fill: "var(--dot-cheek)" }} opacity=".4" />
        {/* Her hair over the top of her head: parted on her right and swept across, behind her ears. */}
        <path d="M44 152 C36 92 70 50 120 50 C172 50 206 90 196 152 C190 124 180 104 162 92 C140 80 116 80 98 74 C92 96 74 108 62 120 C54 130 48 140 44 152 Z" fill={`url(#${uid}h)`} />
        <path d="M100 76 C128 84 158 86 180 112 M84 74 C76 92 66 102 56 116 M118 58 C142 58 166 68 182 86" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity=".16" />
        {/* Eyebrows. */}
        <path d="M71 111 Q88 101 105 108" fill="none" stroke="#4A3040" strokeWidth="4" strokeLinecap="round" />
        <path d="M135 108 Q152 101 169 111" fill="none" stroke="#4A3040" strokeWidth="4" strokeLinecap="round" />
        {/* Eyes: each blinks as a whole (eyeL / eyeR); the irises look where she looks (irisL / irisR). */}
        <g data-k="eyes">
          <g data-k="eyeL">
            <ellipse cx="88.5" cy="141" rx="14" ry="15" fill="#FFFFFF" />
            <g clipPath={`url(#${uid}el)`}>
              <g data-k="irisL">
                <circle cx="88.5" cy="142" r="10.5" fill={`url(#${uid}i)`} />
                <circle cx="88.5" cy="142" r="5.2" style={{ fill: "var(--dot-eye)" }} />
                <circle cx="84.5" cy="137.5" r="3.2" fill="#FFFFFF" />
                <circle cx="92" cy="146" r="1.5" fill="#FFFFFF" opacity=".8" />
              </g>
            </g>
            <path d="M73.5 139 Q88.5 121 103.5 139" fill="none" stroke="#2B1A22" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M75 133 L70 129.5" stroke="#2B1A22" strokeWidth="2.4" strokeLinecap="round" />
          </g>
          <g data-k="eyeR">
            <ellipse cx="151.5" cy="141" rx="14" ry="15" fill="#FFFFFF" />
            <g clipPath={`url(#${uid}er)`}>
              <g data-k="irisR">
                <circle cx="151.5" cy="142" r="10.5" fill={`url(#${uid}i)`} />
                <circle cx="151.5" cy="142" r="5.2" style={{ fill: "var(--dot-eye)" }} />
                <circle cx="147.5" cy="137.5" r="3.2" fill="#FFFFFF" />
                <circle cx="155" cy="146" r="1.5" fill="#FFFFFF" opacity=".8" />
              </g>
            </g>
            <path d="M136.5 139 Q151.5 121 166.5 139" fill="none" stroke="#2B1A22" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M165 133 L170 129.5" stroke="#2B1A22" strokeWidth="2.4" strokeLinecap="round" />
          </g>
        </g>
        {/* Her nose. */}
        <path d="M116 159 Q120 163 124 159" fill="none" stroke="#D99A7C" strokeWidth="2.4" strokeLinecap="round" />
        {/* Her glasses: big squared lenses with soft corners, frames in the theme's colour, an arm to
            each ear. They sit on her face, so they nod with her and stay put as she looks. */}
        <g aria-hidden="true" style={{ stroke: "var(--dot-edge)" }} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="64" y="118" width="49" height="46" rx="12" fill="#FFFFFF" fillOpacity=".1" strokeWidth="4.5" />
          <rect x="127" y="118" width="49" height="46" rx="12" fill="#FFFFFF" fillOpacity=".1" strokeWidth="4.5" />
          <path d="M113 134 Q120 129 127 134" strokeWidth="4" />
          <path d="M64 132 Q56 131 50 134" strokeWidth="4.5" />
          <path d="M176 132 Q184 131 190 134" strokeWidth="4.5" />
          <path d="M70 132 V128 Q70 124 74 124 H82" stroke="#FFFFFF" strokeWidth="2.4" opacity=".6" />
          <path d="M133 132 V128 Q133 124 137 124 H145" stroke="#FFFFFF" strokeWidth="2.4" opacity=".6" />
        </g>
        <g transform="translate(120 170) scale(1.42) translate(-120 -170)">
          <path data-k="mouth" style={{ fill: "var(--dot-mouth)", stroke: "var(--dot-mouth)" }} strokeWidth="2.4" strokeLinejoin="round" />
          <g clipPath={`url(#${uid}mc)`}>
            <rect data-k="teeth" x="100" y="150" width="40" height="6" rx="2" fill="#FFFFFF" />
            <ellipse data-k="tongue" cx="120" cy="190" rx="9" ry="5" fill="#F28AB8" />
          </g>
          <path data-k="lowerlip" fill="none" style={{ stroke: "var(--dot-lip)" }} strokeWidth="2" strokeLinecap="round" opacity=".6" />
          <path data-k="line" fill="none" style={{ stroke: "var(--dot-mouth)" }} strokeWidth="3.4" strokeLinecap="round" />
          <rect data-k="fteeth" width="10" height="4.5" rx="1.6" fill="#FFFFFF" strokeWidth="1.2" style={{ display: "none", stroke: "var(--dot-mouth)" }} />
        </g>
      </g>
    </svg>
  );
}

const f1 = (v: number) => v.toFixed(1);
type Parts = Record<"mouth" | "clip" | "teeth" | "tongue" | "lowerlip" | "line" | "fteeth", SVGElement>;

/** The mouth: one shape from the seven muscles (cubic lips, teeth and tongue clipped inside). */
function drawMouth(P: Parts, m: DotMuscles, smile: number) {
  const x = 120, my = 172;
  const hw = 13 * (1 + 0.7 * m.spread - 0.58 * m.round) * (1 - 0.1 * m.seal) * (1 + 0.15 * smile);
  const open = 30 * m.jaw + 6 * m.round * Math.min(1, m.jaw * 3);
  const cy = my - 1.8 * smile + 1.2 * m.round;
  const L = x - hw, R = x + hw;
  if (open < 1.6 || m.fv > 0.5) {
    const bulge = (3 + 4 * smile - 2 * m.seal - 1.5 * m.round) * (1 - 0.7 * Math.min(1, m.fv));
    P.line.setAttribute("d", `M${f1(L)} ${f1(cy)} Q${x} ${f1(cy + bulge)} ${f1(R)} ${f1(cy)}`);
    P.line.setAttribute("stroke-width", f1(3.4 + 1.8 * m.seal + 1.2 * m.fv + 1.5 * m.round));
    P.line.style.display = "";
    P.mouth.style.display = "none";
    P.lowerlip.style.display = "none";
    P.teeth.style.display = "none";
    P.tongue.style.display = "none";
    if (m.fv > 0.25) {
      // f / v: the upper teeth rest on a tucked-in lower lip.
      const tw = hw * 0.95, th = 4.6;
      P.fteeth.setAttribute("x", f1(x - tw / 2));
      P.fteeth.setAttribute("width", f1(tw));
      P.fteeth.setAttribute("y", f1(cy + bulge * 0.5 - th - 0.6));
      P.fteeth.setAttribute("height", f1(th));
      P.fteeth.style.opacity = f1(Math.min(1, (m.fv - 0.25) * 3));
      P.fteeth.style.display = "";
    } else P.fteeth.style.display = "none";
    return;
  }
  P.line.style.display = "none";
  P.mouth.style.display = "";
  P.lowerlip.style.display = "";
  P.fteeth.style.display = "none";
  P.mouth.setAttribute("stroke-width", f1(2.4 + 2.6 * m.round));
  const top = cy - open * 0.34, bot = cy + open * 0.66;
  const c1 = (0.1 + 0.42 * (1 - m.round)) * hw;
  const ty = cy - (cy - top) / 0.75, by = cy + (bot - cy) / 0.75;
  const d = `M${f1(L)} ${f1(cy)} C${f1(L + c1)} ${f1(ty)} ${f1(R - c1)} ${f1(ty)} ${f1(R)} ${f1(cy)} C${f1(R - c1)} ${f1(by)} ${f1(L + c1)} ${f1(by)} ${f1(L)} ${f1(cy)} Z`;
  P.mouth.setAttribute("d", d);
  P.clip.setAttribute("d", d);
  P.lowerlip.setAttribute("d", `M${f1(L + hw * 0.35)} ${f1(bot + 4 + 1.5 * m.round)} Q${x} ${f1(bot + 6.5 + 2 * m.round)} ${f1(R - hw * 0.35)} ${f1(bot + 4 + 1.5 * m.round)}`);
  P.teeth.style.display = m.teeth > 0.25 || m.fv > 0.3 ? "" : "none";
  P.teeth.setAttribute("x", f1(L));
  P.teeth.setAttribute("width", f1(hw * 2));
  P.teeth.setAttribute("y", f1(top - 1));
  P.teeth.setAttribute("height", f1(Math.min(6, open * (0.25 + 0.2 * m.teeth))));
  P.tongue.style.display = open > 9 || m.tongue > 0.3 ? "" : "none";
  P.tongue.setAttribute("cx", String(x));
  P.tongue.setAttribute("rx", f1(hw * (0.62 - 0.12 * m.tongue)));
  P.tongue.setAttribute("ry", f1(Math.max(3, open * 0.28)));
  P.tongue.setAttribute("cy", f1(bot - open * 0.12 - m.tongue * open * 0.5));
}
