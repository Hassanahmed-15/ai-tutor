import type { MoleculeStage } from "./types";

/**
 * MOLECULE SHAPES, CHECKED BY CODE. A molecule board states a geometry and a bond angle; both follow
 * from the central atom's bonded neighbours and lone pairs (VSEPR), so a board that says NH₃ is
 * "trigonal planar, 120°" can be caught without a model. Only star-shaped molecules (one central
 * atom bonded to every other atom) whose central atom states its lone pairs are judged.
 */
type Shape = { names: RegExp; angle: number; name: string };
const SHAPES: Record<string, Shape> = {
  "2,0": { names: /linear/, angle: 180, name: "linear" },
  "3,0": { names: /trigonal planar|triangular planar/, angle: 120, name: "trigonal planar" },
  "2,1": { names: /bent|v[- ]?shaped|angular/, angle: 120, name: "bent" },
  "4,0": { names: /tetrahedral/, angle: 109.5, name: "tetrahedral" },
  "3,1": { names: /pyramid/, angle: 109.5, name: "trigonal pyramidal" },
  "2,2": { names: /bent|v[- ]?shaped|angular/, angle: 109.5, name: "bent" },
  "5,0": { names: /trigonal bipyramid/, angle: 120, name: "trigonal bipyramidal" },
  "4,1": { names: /see[- ]?saw|sawhorse/, angle: 120, name: "seesaw" },
  "3,2": { names: /t[- ]?shaped/, angle: 90, name: "T-shaped" },
  "2,3": { names: /linear/, angle: 180, name: "linear" },
  "6,0": { names: /octahedral/, angle: 90, name: "octahedral" },
  "5,1": { names: /square pyramid/, angle: 90, name: "square pyramidal" },
  "4,2": { names: /square planar/, angle: 90, name: "square planar" },
};

export function vseprIssues(stage: MoleculeStage): string[] {
  const issues: string[] = [];
  for (const m of stage.molecules) {
    const neighbours = new Map<string, Set<string>>();
    for (const b of m.bonds) {
      neighbours.set(b.from, (neighbours.get(b.from) ?? new Set()).add(b.to));
      neighbours.set(b.to, (neighbours.get(b.to) ?? new Set()).add(b.from));
    }
    const central = m.atoms.reduce<typeof m.atoms[number] | undefined>((best, a) => ((neighbours.get(a.id)?.size ?? 0) > (neighbours.get(best?.id ?? "")?.size ?? 0) ? a : best), undefined);
    if (!central || central.lonePairs === undefined) continue;
    const bonded = neighbours.get(central.id)?.size ?? 0;
    if (bonded < 2 || bonded !== m.atoms.length - 1) continue;
    const shape = SHAPES[`${bonded},${central.lonePairs}`];
    if (!shape) continue;
    const label = `${m.label || m.id}`;
    if (m.geometry && !shape.names.test(m.geometry.toLowerCase())) {
      issues.push(`${label}: ${bonded} bonded atoms and ${central.lonePairs} lone pair(s) on ${central.element} make it ${shape.name}, not "${m.geometry}"`);
    }
    // Lone pairs squeeze the angle below the parent shape's (H₂O 104.5°, H₂S 92°), never above it.
    const stated = Number(/(\d+(?:\.\d+)?)/.exec(m.bondAngle ?? "")?.[1]);
    if (Number.isFinite(stated)) {
      const exact = central.lonePairs === 0 || shape.angle === 180;
      if (exact ? Math.abs(stated - shape.angle) > 1.5 : stated > shape.angle - 0.4) {
        issues.push(`${label}: its bond angle cannot be ${m.bondAngle} — ${exact ? `a ${shape.name} shape is ${shape.angle}°` : `lone pairs make it less than ${shape.angle}°`}`);
      }
    }
  }
  return issues;
}
