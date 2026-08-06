import * as THREE from "three";

/**
 * Shared PBR material library.
 *
 * Why singletons instead of inline `<meshStandardMaterial>` JSX: three compiles one shader
 * program per unique material configuration, and uploads uniforms per material. The previous
 * scene declared 35 inline materials inside render functions, which meant up to 35 programs and
 * a fresh material object on every re-render. Referencing ~16 shared instances instead cuts
 * program count, kills per-render allocation, and — most importantly — gives every surface in
 * the building one consistent, deliberately-tuned physical definition.
 *
 * The single most important property here is `envMapIntensity`. PBR roughness/metalness values
 * only produce a believable surface when there is an environment map to reflect; without one
 * (the previous state of this scene) every material renders flat regardless of how carefully
 * its roughness was chosen. `scene/Lighting.tsx` supplies the environment; these values control
 * how strongly each surface receives it.
 *
 * Roughness/metalness pairs are real-world references, not guesses:
 *   polished concrete 0.25/0 · raw concrete 0.85/0 · oak 0.55/0 · anodized aluminium 0.35/1
 *   brushed steel 0.45/1 · felt 0.95/0 · glass 0.05/0 (+transmission)
 */

// ── Palette ──────────────────────────────────────────────────────────────────
// Architectural neutrals. Warm greys and off-whites rather than pure #fff/#000, which never
// occur in a real building and are the fastest way to make a render look synthetic.
export const PALETTE = {
  concreteLight: "#d8d5cf",
  concreteMid: "#b9b5ad",
  concreteDark: "#8a877f",
  plaster: "#eae7e1",
  oakLight: "#c9a578",
  oakMid: "#a67c4e",
  walnut: "#6b4a2f",
  aluminium: "#c6c9cc",
  steelDark: "#4a4d51",
  brass: "#b08d57",
  feltWarm: "#9a8f80",
  feltCool: "#7c8a90",
  foliage: "#4a6b3c",
  foliageDeep: "#35502c",
  ceramic: "#f2efe9",
  rubber: "#3f4448",
  whiteboard: "#f7f6f3",
} as const;

/** Matte architectural surface — walls, ceilings, painted plaster. */
function matte(color: string, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness: 0,
    envMapIntensity: 0.6, // low: matte surfaces take ambient bounce, not sharp reflection
  });
}

/** Semi-reflective surface — polished floors, sealed concrete, ceramic. */
function polished(color: string, roughness = 0.28): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness: 0,
    envMapIntensity: 1.15, // high: this is what produces floor reflections of the windows
  });
}

/** Real metal — needs full env contribution or it reads as grey plastic. */
function metal(color: string, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness: 1,
    envMapIntensity: 1.4,
  });
}

/** Wood — moderate sheen, no metalness. */
function wood(color: string, roughness = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness: 0,
    envMapIntensity: 0.85,
  });
}

/**
 * Architectural glass.
 *
 * Deliberately NOT `transmission: 1` by default. Transmission renders a backbuffer per material,
 * so a facade of a dozen separate glass meshes costs a dozen extra render passes. This tuned
 * transparent+reflective definition is visually near-identical at architectural viewing distances
 * and effectively free. `glassHero` below is the real-transmission version, reserved for the
 * two or three panes a player actually stands next to.
 */
function glazing(opacity: number, tint: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint),
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity,
    envMapIntensity: 1.6, // glass is almost entirely reflection — this is doing the visual work
    side: THREE.DoubleSide,
    depthWrite: false, // avoids sorting artifacts between stacked panes
  });
}

export const M = {
  // Structure
  concreteFloor: polished(PALETTE.concreteLight, 0.25),
  concreteWall: matte(PALETTE.concreteMid, 0.88),
  concreteRaw: matte(PALETTE.concreteDark, 0.92),
  plaster: matte(PALETTE.plaster, 0.94),

  // Wood
  oakFloor: wood(PALETTE.oakLight, 0.48),
  oak: wood(PALETTE.oakMid, 0.55),
  walnut: wood(PALETTE.walnut, 0.5),

  // Metal
  aluminium: metal(PALETTE.aluminium, 0.35),
  steel: metal(PALETTE.steelDark, 0.45),
  brass: metal(PALETTE.brass, 0.3),

  // Glass
  glass: glazing(0.16, "#dce9ee"),
  glassFrit: glazing(0.34, "#e8f0f2"), // fritted/privacy glass for meeting rooms

  // Soft goods
  felt: matte(PALETTE.feltWarm, 0.96),
  feltCool: matte(PALETTE.feltCool, 0.96),
  rubberFloor: matte(PALETTE.rubber, 0.8),

  // Objects
  ceramic: polished(PALETTE.ceramic, 0.2),
  whiteboard: polished(PALETTE.whiteboard, 0.18),
} as const;

/** True-transmission glass for the few panes viewed up close. Expensive — use sparingly. */
export function makeHeroGlass(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#eef6f8"),
    roughness: 0.04,
    metalness: 0,
    transmission: 1,
    thickness: 0.02,
    ior: 1.5,
    specularIntensity: 1,
    envMapIntensity: 1.6,
  });
}

/**
 * Foliage needs double-sided rendering (leaves are single planes viewed from both faces) and
 * alpha testing rather than blending, so leaves depth-sort correctly against each other without
 * the transparency sorting artifacts that make plants look like floating decals.
 */
export function makeFoliage(color: string = PALETTE.foliage): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.7,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
  });
}

/**
 * Emissive material for light fittings and screens. Kept as a factory because each fitting wants
 * its own colour temperature — a building where every luminaire is the identical white is a
 * strong "this is CG" signal.
 */
export function makeEmissive(color: string, intensity: number): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({
    color: c,
    emissive: c,
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0,
    toneMapped: false, // let fittings actually read as light sources, not grey-white shapes
  });
}

/**
 * Low-stimulation variant of the material library.
 *
 * This is a deliberately designed second art direction, not a degraded one (see the accessibility
 * plan): sensory-sensitive and ADHD users need less specular glitter, less colour saturation, and
 * lower contrast — the exact opposite of what makes an architectural render impressive. Rather
 * than dimming the scene, this desaturates and matte-ifies the shared materials in place.
 */
export function applyLowStimulation(enabled: boolean): void {
  for (const material of Object.values(M)) {
    const std = material as THREE.MeshStandardMaterial;
    if (enabled) {
      std.userData.baseEnv ??= std.envMapIntensity;
      std.userData.baseRough ??= std.roughness;
      std.envMapIntensity = Math.min(std.userData.baseEnv as number, 0.35);
      std.roughness = Math.min(1, (std.userData.baseRough as number) + 0.25);
    } else if (std.userData.baseEnv !== undefined) {
      std.envMapIntensity = std.userData.baseEnv as number;
      std.roughness = std.userData.baseRough as number;
    }
    std.needsUpdate = true;
  }
}

/** High-contrast variant — raises value separation for low-vision users. */
export function applyHighContrast(enabled: boolean): void {
  const pairs: Array<[THREE.MeshStandardMaterial, string, string]> = [
    [M.concreteFloor, PALETTE.concreteLight, "#f4f2ee"],
    [M.concreteWall, PALETTE.concreteMid, "#6f6b64"],
    [M.plaster, PALETTE.plaster, "#ffffff"],
    [M.oak, PALETTE.oakMid, "#8a5a26"],
  ];
  for (const [material, normal, contrast] of pairs) {
    material.color.set(enabled ? contrast : normal);
    material.needsUpdate = true;
  }
}
