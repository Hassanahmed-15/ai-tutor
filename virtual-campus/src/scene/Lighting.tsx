import { AccumulativeShadows, ContactShadows, Environment, Lightformer, RandomizedLight, SoftShadows } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import type { AccessibilityProfile } from "../types";

/**
 * The lighting rig — the single highest-impact change in the visual revamp.
 *
 * The previous scene had one directional light, one ambient, one hemisphere, and no environment
 * map. That combination cannot produce a believable interior: PBR materials derive most of their
 * appearance from reflected environment, so without an env map every surface renders as flat
 * shaded colour no matter how well its roughness/metalness are tuned.
 *
 * ── Why a procedural environment instead of an HDRI file ──
 * `<Environment>` also accepts children, which are rendered once into a cube map. Building the
 * environment from `<Lightformer>` emissive planes rather than downloading a 3-6MB .hdr means:
 *   · zero network payload and no offline/CDN dependency (drei's `preset=` fetches from GitHub
 *     at runtime, which fails offline and adds unpredictable latency)
 *   · the reflections match THIS building — a bright window wall on one side, warm bounce from
 *     the floor, a soft ceiling wash — instead of a generic studio or someone else's room
 *   · `frames={1}` bakes it exactly once, so it costs one render total, not one per frame
 * A file-based HDRI remains a drop-in upgrade later: pass `files="/hdri/interior.hdr"`.
 *
 * ── Shadow strategy ──
 * One directional "sun" casts real-time shadows with a frustum tightened to the actual building
 * footprint (a loose frustum wastes shadow-map resolution and is a common cause of soft, muddy
 * shadow edges). `shadow-bias`/`shadow-normalBias` are set explicitly — their absence in the
 * previous scene caused shadow acne and the dirty look on large flat surfaces.
 * `<ContactShadows>` adds the short-range occlusion directly under objects that makes them read
 * as resting on the floor rather than floating, which was one of the strongest "fake" signals.
 */

type LightingProps = {
  profile: AccessibilityProfile;
  /** Footprint half-extents [x, z] used to fit the sun's shadow frustum tightly. */
  bounds?: [number, number];
};

export function Lighting({ profile, bounds = [34, 30] }: LightingProps) {
  const gl = useThree((state) => state.gl);
  const quiet = profile.quietWorld;
  const lowStim = profile.quietWorld || profile.reducedMotion;

  // Colour management + tone mapping.
  //
  // NeutralToneMapping (Khronos PBR Neutral) is chosen over R3F's ACESFilmic default
  // deliberately: ACES desaturates and warms mid-tones, which fights the white-concrete-and-glass
  // palette this building is built from — whites drift cream and the accent colours lose
  // identity. PBR Neutral preserves albedo hue while still rolling off highlights cleanly, which
  // is what an architectural interior needs.
  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = profile.highContrast ? 1.15 : 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl, profile.highContrast]);

  return (
    <>
      {/*
        Environment: baked once (frames={1}) from emissive planes describing this building's
        light story. resolution={256} is ample — this map is only ever seen as blurred reflection
        in matte concrete and soft gradients in glass; higher resolution costs memory for detail
        nobody can perceive at architectural viewing distances.
      */}
      <Environment resolution={256} frames={1} environmentIntensity={quiet ? 0.75 : 1}>
        {/* Sky dome — cool daylight from above, the dominant ambient source. */}
        <Lightformer
          form="rect"
          intensity={quiet ? 1.6 : 2.4}
          color="#eaf2ff"
          position={[0, 18, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[40, 40, 1]}
        />
        {/* Primary window wall (west) — the big cool key that defines the glass facade look. */}
        <Lightformer
          form="rect"
          intensity={quiet ? 2 : 3.4}
          color="#dceaff"
          position={[-22, 5, 0]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[34, 12, 1]}
        />
        {/* Opposite wall — warm, dimmer fill so the interior isn't flatly lit from both sides. */}
        <Lightformer
          form="rect"
          intensity={quiet ? 0.8 : 1.2}
          color="#ffeeda"
          position={[22, 5, 0]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[34, 12, 1]}
        />
        {/* Floor bounce — warm light returning off the polished concrete. Subtle but it's what
            stops undersides of desks and shelves from going dead black. */}
        <Lightformer
          form="rect"
          intensity={0.6}
          color="#f6ead8"
          position={[0, -2, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[40, 40, 1]}
        />
      </Environment>

      {/*
        Soft PCSS shadows. This patches the shadow shader globally, so it must sit above the
        scene. samples={16} is the honest ceiling for a scene this size; the PerformanceMonitor
        degradation ladder drops this first on weak hardware.
        Skipped entirely in quiet/low-stim mode — soft moving shadow noise is exactly the kind of
        visual churn sensory-sensitive users need less of.
      */}
      {!lowStim && <SoftShadows size={22} samples={12} focus={0.7} />}

      {/* Ambient floor — very low. With a real environment map this exists only to stop fully
          unlit crevices reading as pure black, not to light the scene. */}
      <ambientLight intensity={quiet ? 0.35 : 0.18} color="#e6eef2" />

      {/*
        The sun. Frustum fitted to the building footprint: at 2048² over a 68×60 area that's
        ~3cm per texel, which holds up for architectural shadows. Widening this frustum is the
        usual reason shadows go soft and blocky, so it is derived from bounds rather than guessed.
      */}
      <directionalLight
        position={[-24, 30, 18]}
        intensity={quiet ? 1.6 : 2.6}
        color="#fff4e2"
        castShadow={!quiet}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-bounds[0]}
        shadow-camera-right={bounds[0]}
        shadow-camera-top={bounds[1]}
        shadow-camera-bottom={-bounds[1]}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
    </>
  );
}

/**
 * Short-range grounding shadow, placed under furniture clusters and hero objects.
 *
 * This is separate from the sun's shadow map: a directional shadow at building scale cannot
 * resolve the tight dark contact where a chair leg meets the floor, and that contact is precisely
 * what the eye uses to judge whether an object is really resting on a surface. Cheap and one of
 * the highest realism-per-cost elements in the whole rig.
 */
export function GroundingShadow({
  position,
  scale = 6,
  opacity = 0.45,
  disabled = false,
}: {
  position: [number, number, number];
  scale?: number;
  opacity?: number;
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <ContactShadows
      position={position}
      scale={scale}
      opacity={opacity}
      blur={2.4}
      far={3.2}
      resolution={512}
      color="#2b2620"
      frames={1} /* static geometry — render once, then freeze */
    />
  );
}

/**
 * Progressive soft shadowing for a static hero area (an atrium, a classroom).
 *
 * Accumulates many randomized light samples over ~40 frames into a single soft shadow, then
 * freezes. This is drei's answer to baked interior lighting without a Blender pipeline, and it
 * produces the diffuse wraparound occlusion that a single directional light cannot.
 * Not used in reduced-motion/quiet mode: the progressive accumulation visibly converges on
 * screen, which reads as flickering to motion-sensitive users.
 */
export function BakedAreaShadow({
  position,
  scale = 14,
  disabled = false,
}: {
  position: [number, number, number];
  scale?: number;
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <AccumulativeShadows
      position={position}
      scale={scale}
      frames={44}
      alphaTest={0.82}
      opacity={0.7}
      color="#2f2a24"
      temporal
    >
      <RandomizedLight amount={6} radius={7} ambient={0.5} intensity={1.6} position={[-16, 18, 12]} bias={0.001} />
    </AccumulativeShadows>
  );
}
