import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import type { AccessibilityProfile } from "../types";

/**
 * Post-processing.
 *
 * Uses the `postprocessing` library rather than three's built-in EffectComposer because it merges
 * every effect into a SINGLE fullscreen pass; three's composer runs one pass plus a framebuffer
 * copy per effect, which for this stack would be roughly five passes instead of one.
 *
 * ── Why ambient occlusion is the effect that matters ──
 * AO darkens the contact between surfaces: where a wall meets a floor, where a chair leg touches
 * carpet, inside a door reveal. Those gradients are what the eye reads as "these objects occupy
 * the same physical space". Without AO, correctly-lit geometry still floats. Bloom and vignette
 * are seasoning; AO is the meal.
 *
 * ── Restraint ──
 * Bloom is deliberately near-imperceptible (high threshold, low intensity). Visible bloom is the
 * fastest way to make architecture look like a game demo. Same for vignette — enough to hold the
 * eye centre-frame, not enough to notice.
 *
 * ── Accessibility ──
 * Low-stimulation mode disables AO and bloom entirely and keeps only anti-aliasing. This is not a
 * degraded fallback: reduced specular glitter and flatter contrast is genuinely what sensory
 * sensitive users need, and the flat look is a deliberate second art direction.
 */
export function Postprocessing({
  profile,
  enabled = true,
}: {
  profile: AccessibilityProfile;
  enabled?: boolean;
}) {
  const lowStim = profile.quietWorld;

  if (!enabled) return null;

  if (lowStim) {
    // Anti-aliasing only — no occlusion darkening, no glow, no vignette.
    return (
      <EffectComposer enableNormalPass={false} multisampling={0}>
        <SMAA />
      </EffectComposer>
    );
  }

  return (
    <EffectComposer enableNormalPass multisampling={0}>
      {/*
        N8AO rather than the classic SSAO: it samples in world units, so `aoRadius` is a real
        distance (0.9m here) rather than a screen-space guess that changes meaning with camera
        distance. That matters in a walkable interior where the camera moves constantly.
      */}
      <N8AO
        aoRadius={0.9}
        intensity={2.1}
        distanceFalloff={0.8}
        halfRes={false}
        color="#20211f"
      />
      <Bloom
        intensity={0.22}
        luminanceThreshold={0.92}
        luminanceSmoothing={0.16}
        mipmapBlur
        // Only genuine light sources (emissive fittings, screens) should bloom, never bright
        // white walls — hence the high threshold.
      />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.32} darkness={0.42} blendFunction={BlendFunction.NORMAL} />
      <SMAA />
    </EffectComposer>
  );
}
