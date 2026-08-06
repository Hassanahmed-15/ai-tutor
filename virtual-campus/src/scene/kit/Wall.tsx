import { useMemo } from "react";
import * as THREE from "three";
import { M } from "../materials";

/**
 * A wall with real openings punched through it.
 *
 * The previous scene built "walls with doorways" by arranging three separate boxes around a gap.
 * That approach cannot produce a correct reveal (the visible thickness of the wall inside the
 * opening), so openings read as slots between floating slabs rather than holes in a solid wall.
 *
 * Here the wall is a single extruded shape with holes, so the opening has genuine depth and
 * self-shadows correctly — which is most of what makes a doorway look built. Extrusion happens
 * once per geometry signature and is memoised.
 *
 * Also includes the base reveal: the ~90mm recessed shadow gap at floor level that is standard
 * detailing in modern architecture. It reads as a crisp dark line and is one of the cheapest,
 * strongest realism cues available.
 */

export type Opening = {
  /** Horizontal centre of the opening, measured from the wall's own centre. */
  x: number;
  /** Sill height above floor. 0 for a doorway. */
  y: number;
  width: number;
  height: number;
};

type WallProps = {
  position: [number, number, number];
  /** Wall runs along local X. Rotate the group to orient it. */
  length: number;
  height: number;
  thickness?: number;
  openings?: Opening[];
  rotation?: [number, number, number];
  material?: THREE.Material;
  /** Adds the recessed skirting reveal at the base. */
  reveal?: boolean;
  castShadow?: boolean;
};

export function Wall({
  position,
  length,
  height,
  thickness = 0.22,
  openings = [],
  rotation = [0, 0, 0],
  material = M.plaster,
  reveal = true,
  castShadow = true,
}: WallProps) {
  const geometry = useMemo(() => {
    // Build the wall face as a 2D shape in local X/Y, then extrude along Z by `thickness`.
    const shape = new THREE.Shape();
    const halfL = length / 2;
    const base = reveal ? 0.09 : 0; // leave room for the reveal strip below
    shape.moveTo(-halfL, base);
    shape.lineTo(halfL, base);
    shape.lineTo(halfL, height);
    shape.lineTo(-halfL, height);
    shape.closePath();

    for (const opening of openings) {
      const hole = new THREE.Path();
      const x0 = opening.x - opening.width / 2;
      const x1 = opening.x + opening.width / 2;
      const y0 = Math.max(base, opening.y);
      const y1 = opening.y + opening.height;
      hole.moveTo(x0, y0);
      hole.lineTo(x1, y0);
      hole.lineTo(x1, y1);
      hole.lineTo(x0, y1);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: true,
      // A tiny bevel on every edge. Perfectly sharp 90° corners never catch a highlight, which
      // is a large part of why untreated boxes read as CG.
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 1,
    });
    geo.translate(0, 0, -thickness / 2);
    geo.computeVertexNormals();
    return geo;
  }, [length, height, thickness, openings, reveal]);

  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={geometry} material={material} castShadow={castShadow} receiveShadow />
      {reveal && (
        <mesh
          position={[0, 0.045, 0]}
          material={M.concreteRaw}
          receiveShadow
        >
          {/* Inset on both faces so it sits in shadow rather than flush with the wall. */}
          <boxGeometry args={[length, 0.09, thickness * 0.7]} />
        </mesh>
      )}
    </group>
  );
}

/**
 * Door frame/lining that sits inside a wall opening. Separated from the door leaf so the frame
 * stays static while the leaf swings.
 */
export function DoorFrame({
  width,
  height,
  thickness = 0.24,
}: {
  width: number;
  height: number;
  thickness?: number;
}) {
  const jamb = 0.06;
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 2 + jamb / 2), height / 2, 0]} castShadow receiveShadow material={M.oak}>
          <boxGeometry args={[jamb, height + jamb, thickness]} />
        </mesh>
      ))}
      <mesh position={[0, height + jamb / 2, 0]} castShadow receiveShadow material={M.oak}>
        <boxGeometry args={[width + jamb * 2, jamb, thickness]} />
      </mesh>
      {/* Threshold strip — floor material changes at a door in every real building. */}
      <mesh position={[0, 0.004, 0]} receiveShadow material={M.aluminium}>
        <boxGeometry args={[width, 0.008, thickness]} />
      </mesh>
    </group>
  );
}
