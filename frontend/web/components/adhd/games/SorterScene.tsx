"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { GameSpec } from "@/lib/adhd/games/spec";
import { applySorter, fallSpeed, initialSorter, type SorterState } from "@/lib/adhd/games/sorterRules";

/**
 * Sorting Run, rendered in real 3D.
 *
 * This is a RENDERER, not a game. Every rule — scoring, combo, lives, the speed ramp, when the run
 * ends — lives in `lib/adhd/games/sorterRules.ts` as a pure reducer, and none of it changed to get
 * here. Its tests were the regression guard through the whole rewrite, which is the entire reason
 * that split exists.
 *
 * WHY 3D AT ALL. The ask was Unreal Engine. UE5 has no web export — browser delivery means pixel
 * streaming from a GPU server at roughly $0.18-0.53 per user-hour, and a UE5 build is precompiled,
 * so nothing could author a level for a lecture generated ten seconds ago. WebGL in the page gets
 * perspective, real lighting, shadows and bloom at zero marginal cost, on lessons invented on demand.
 *
 * WHY THE LABELS ARE DOM, NOT 3D TEXT. The first version used drei's `<Text>`, which is SDF-rendered
 * and beautifully sharp — and it rendered "Light + water + CO₂" as "Light + water + CO☒", because
 * troika rasterises from a single font file and the default has no subscript glyphs. Lesson content
 * is full of ₂, →, Δ, ⁻ and µ, so that is not an edge case, it is Tuesday.
 *
 * `<Html>` labels are real DOM positioned by the scene: every glyph the page can render, the app's
 * own fonts, crisp at any zoom, and readable by a screen reader. They do not receive scene lighting,
 * which is a fair price for text that is the entire content of the game.
 */

const W = 12;           // world units across the play field
const FLOOR_Y = -4.2;   // where a tile lands
const SPAWN_Y = 7.5;
const BIN_COLOURS = ["#2dd4bf", "#a78bfa"] as const;

/** One falling term. Position is driven by the frame loop, not by React state. */
function Tile({
  text,
  tileRef,
}: {
  text: string;
  tileRef: React.RefObject<THREE.Group | null>;
}) {
  return (
    <group ref={tileRef} position={[0, SPAWN_Y, 0]}>
      <RoundedBox args={[3.4, 1.15, 0.42]} radius={0.16} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#f1f5f9" roughness={0.35} metalness={0.05} />
      </RoundedBox>
      {/* Just proud of the slab face so it never z-fights with it. */}
      <Html center position={[0, 0, 0.24]} distanceFactor={9} zIndexRange={[10, 0]} pointerEvents="none">
        <div className="w-[210px] select-none text-center text-[15px] font-semibold leading-tight text-slate-900">
          {text}
        </div>
      </Html>
    </group>
  );
}

/** A bin: a lit slab with an emissive rim that fills as it takes items. */
function Bin({ label, side, fill }: { label: string; side: 0 | 1; fill: number }) {
  const x = side === 0 ? -W / 4 : W / 4;
  const colour = BIN_COLOURS[side];
  return (
    <group position={[x, FLOOR_Y - 0.9, 0]}>
      <mesh receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[W / 2 - 0.3, 1.5, 3]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>
      {/* The rim carries the bin's identity — it is what you track while a tile is falling. */}
      <mesh position={[0, 0.78, 1.45]}>
        <boxGeometry args={[W / 2 - 0.3, 0.12, 0.12]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      {/*
        Fill level: the only running feedback that is not a number.

        Inset on every axis and pulled forward. The first version shared faces with the bin box
        above, and two coplanar surfaces at the same depth is textbook z-fighting — it showed up as
        stripes crawling across the right-hand bin.
      */}
      <mesh position={[0, -0.72 + fill * 0.68, 0.3]}>
        <boxGeometry args={[W / 2 - 0.9, Math.max(0.001, fill * 1.3), 2.3]} />
        <meshStandardMaterial
          color={colour}
          transparent
          opacity={0.45}
          emissive={colour}
          emissiveIntensity={0.6}
          depthWrite={false}
        />
      </mesh>
      <Html center position={[0, 0.25, 1.6]} distanceFactor={11} zIndexRange={[5, 0]} pointerEvents="none">
        <div className="w-[230px] select-none text-center text-[17px] font-bold leading-tight text-slate-100 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
          {label}
        </div>
      </Html>
    </group>
  );
}

/** The learner's stand-in. Tracks the tile so something on screen anticipates the landing. */
function Hero({ heroRef, mood }: { heroRef: React.RefObject<THREE.Group | null>; mood: number }) {
  const colour = mood > 0 ? "#34d399" : mood < 0 ? "#f87171" : "#94a3b8";
  return (
    <group ref={heroRef} position={[0, FLOOR_Y + 0.5, 1.8]}>
      <mesh castShadow>
        <capsuleGeometry args={[0.32, 0.5, 6, 12]} />
        <meshStandardMaterial color={colour} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.62, 0]} castShadow>
        <sphereGeometry args={[0.28, 20, 20]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.6} />
      </mesh>
    </group>
  );
}

/**
 * The play loop.
 *
 * Tile motion is mutated directly on the ref inside `useFrame` rather than held in React state:
 * this runs 60 times a second, and re-rendering the tree at that rate to move one mesh would be
 * the same mistake the mouth analyser avoids.
 */
function Play({
  spec,
  reduced,
  onState: rawOnState,
  onEnd: rawOnEnd,
}: {
  spec: GameSpec;
  reduced: boolean;
  onState: (s: SorterState) => void;
  onEnd: (s: SorterState) => void;
}) {
  /*
   * Parent updates are deferred out of the frame loop.
   *
   * `useFrame` runs inside R3F's own reconciler pass, so calling setState on a component in the DOM
   * tree from there is "update a component while rendering a different component" — React said so
   * out loud, and the browser suite caught it as a console error. A microtask puts the update after
   * the render that triggered it, which is where it belonged.
   */
  const onState = (s: SorterState) => queueMicrotask(() => rawOnState(s));
  const onEnd = (s: SorterState) => queueMicrotask(() => rawOnEnd(s));
  const tileRef = useRef<THREE.Group | null>(null);
  const heroRef = useRef<THREE.Group | null>(null);
  const run = useRef<SorterState>(initialSorter());
  // Sliced rather than shifted at init: pulling from a ref inside a useState initialiser is a ref
  // read during render, which React's compiler correctly rejects.
  const queue = useRef([...spec.items.slice(1)]);
  const aim = useRef(0);
  const cooldown = useRef(0);
  const ended = useRef(false);
  const kick = useRef(0);

  const [current, setCurrent] = useState<{ text: string; bin: 0 | 1 } | null>(spec.items[0] ?? null);
  const [fills, setFills] = useState<[number, number]>([0, 0]);
  const [mood, setMood] = useState(0);
  const moodUntil = useRef(0);
  const pointer = useThree((s) => s.pointer);

  const perItem = 1 / Math.max(1, spec.items.length / 2);

  useFrame((_, rawDelta) => {
    if (ended.current) return;
    // Clamped: a backgrounded tab returns a delta of several seconds, which would teleport the tile
    // through the floor and resolve it against whichever bin it happened to be over.
    const dt = Math.min(rawDelta, 0.05);
    const tile = tileRef.current;

    if (cooldown.current > 0) {
      cooldown.current -= dt;
      if (cooldown.current <= 0) {
        const next = queue.current.shift() ?? null;
        if (!next) {
          ended.current = true;
          const final = applySorter(run.current, { type: "cleared" });
          run.current = final;
          onEnd(final);
          return;
        }
        setCurrent(next);
      }
      return;
    }

    if (!tile || !current) return;

    // Pointer is -1..1 across the canvas; map it to the play field.
    aim.current = THREE.MathUtils.clamp(pointer.x * (W / 2), -W / 2 + 1.8, W / 2 - 1.8);
    tile.position.y -= (fallSpeed(run.current) / 26) * dt * 6;
    tile.position.x += (aim.current - tile.position.x) * Math.min(1, dt * 7);
    // Bank into the turn, and drift the far edge back — the depth cue that sells the perspective.
    tile.rotation.z = THREE.MathUtils.clamp((aim.current - tile.position.x) * 0.08, -0.28, 0.28);
    tile.rotation.x = -0.18;

    if (heroRef.current) {
      heroRef.current.position.x += (tile.position.x - heroRef.current.position.x) * Math.min(1, dt * 5);
    }

    if (tile.position.y <= FLOOR_Y) {
      const landedIn: 0 | 1 = tile.position.x < 0 ? 0 : 1;
      const right = landedIn === current.bin;

      const next = applySorter(run.current, { type: "catch", right });
      run.current = next;
      onState(next);
      setMood(right ? 1 : -1);
      moodUntil.current = performance.now() + 700;
      setFills((f) => {
        const copy: [number, number] = [...f];
        copy[landedIn] = Math.min(1, copy[landedIn] + perItem);
        return copy;
      });
      if (!reduced) kick.current += right ? -0.12 : 0.3;

      tile.position.set(0, SPAWN_Y, 0);
      tile.rotation.set(0, 0, 0);

      if (next.over) {
        ended.current = true;
        onEnd(next);
        return;
      }
      setCurrent(null);
      cooldown.current = reduced ? 0.15 : 0.32;
    }
  });

  /**
   * The landing kick, eased back to rest.
   *
   * The camera is reached through the per-frame `state` rather than a `useThree()` binding: mutating
   * a hook's return value is what React's compiler flags, and this is the same object by a route it
   * does not treat as component state. The kick itself accumulates in a ref so `resolve` above never
   * has to touch the camera at all.
   */
  useFrame((state, d) => {
    // Let the hero's reaction lapse on a timer rather than a random chance per frame, which made
    // how long a face lasted depend on the frame rate.
    if (moodUntil.current && performance.now() > moodUntil.current) {
      moodUntil.current = 0;
      setMood(0);
    }
    kick.current += (0 - kick.current) * Math.min(1, d * 3);
    state.camera.position.set(0, 2.2, 13 + kick.current);
    state.camera.lookAt(0, -1, 0);
  });

  return (
    <>
      <fog attach="fog" args={["#070b16", 14, 34]} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 10, 6]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-W / 4, FLOOR_Y + 2, 3]} color={BIN_COLOURS[0]} intensity={18} distance={9} />
      <pointLight position={[W / 4, FLOOR_Y + 2, 3]} color={BIN_COLOURS[1]} intensity={18} distance={9} />

      {/*
        A lane the tiles fall down, receding into the fog.

        Without it the upper two-thirds of the frame was pure black and the 3D read as flatter than
        the 2D version it replaced — perspective needs something with parallax to be perspective OF.
      */}
      <gridHelper
        args={[40, 28, "#1e3a5f", "#132239"]}
        position={[0, FLOOR_Y - 1.6, -4]}
        rotation={[0, 0, 0]}
      />
      <mesh position={[0, 1.5, -8]} rotation={[0, 0, 0]}>
        <planeGeometry args={[W + 6, 22]} />
        <meshBasicMaterial color="#0a1224" transparent opacity={0.55} />
      </mesh>

      {/* Floor, so the tiles and hero have something to cast a shadow onto. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 1.65, 0]} receiveShadow>
        <planeGeometry args={[40, 26]} />
        <meshStandardMaterial color="#0b1220" roughness={0.95} />
      </mesh>

      {spec.bins.map((label, i) => (
        <Bin key={label + i} label={label} side={i as 0 | 1} fill={fills[i as 0 | 1]} />
      ))}
      <Hero heroRef={heroRef} mood={mood} />
      {current && <Tile key={current.text} text={current.text} tileRef={tileRef} />}
    </>
  );
}

/** Mounts the canvas. Kept separate so the caller can fall back without importing three at all. */
export function SorterScene({
  spec,
  reduced,
  onState,
  onEnd,
}: {
  spec: GameSpec;
  reduced: boolean;
  onState: (s: SorterState) => void;
  onEnd: (s: SorterState) => void;
}) {
  // Clamped device pixel ratio: an uncapped DPR on a 3x phone screen renders nine times the pixels
  // for no visible gain and turns a smooth round into a slideshow.
  const dpr = useMemo<[number, number]>(() => [1, 1.75], []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas
        className="relative"
        shadows={!reduced}
        dpr={dpr}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 2.2, 13], fov: 42 }}
        data-sorter-canvas
      >
        <Play spec={spec} reduced={reduced} onState={onState} onEnd={onEnd} />
      </Canvas>
    </div>
  );
}

export type { ThreeElements };
