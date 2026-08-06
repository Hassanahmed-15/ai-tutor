import { RoundedBox } from "@react-three/drei";
import { CuboidCollider } from "@react-three/rapier";
import { useMemo } from "react";
import * as THREE from "three";
import { M, makeEmissive } from "../materials";
import { type DoorSpec, type RoomShell, type WallSide, type WindowSpec, wallRun } from "../floorplan";
import { Door } from "./Door";
import { Wall, type Opening } from "./Wall";

/**
 * Builds one complete room from its floorplan description: walls with punched openings, doors,
 * glazing, floor, ceiling, lighting, and matching physics colliders.
 *
 * Everything derives from the same `RoomShell`, so geometry and collision cannot drift apart —
 * the previous scene maintained hand-written collider coordinates separately from the visible
 * walls, which is how you end up walking through a wall that is clearly there.
 */

const FLOOR_MATERIALS = {
  concrete: M.concreteFloor,
  oak: M.oakFloor,
  carpet: M.felt,
  rubber: M.rubberFloor,
} as const;

export function Room({
  shell,
  playerPosition,
  reducedMotion = false,
  quiet = false,
  children,
}: {
  shell: RoomShell;
  playerPosition?: THREE.Vector3 | null;
  reducedMotion?: boolean;
  quiet?: boolean;
  children?: React.ReactNode;
}) {
  const [cx, cz] = shell.center;
  const [w, d] = shell.size;
  const sides: WallSide[] = ["north", "south", "east", "west"];

  return (
    <group>
      {/* Floor slab. Sits marginally above the ground plane so there is no z-fighting. */}
      <mesh
        position={[cx, 0.002, cz]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        material={FLOOR_MATERIALS[shell.floor]}
      >
        <planeGeometry args={[w, d]} />
      </mesh>

      {sides.map((side) => (
        <RoomWall
          key={side}
          shell={shell}
          side={side}
          playerPosition={playerPosition}
          reducedMotion={reducedMotion}
        />
      ))}

      <Ceiling shell={shell} quiet={quiet} />

      {/* Floor collider — a thin sensor-free slab so the player stands on the room floor even
          where it differs in height from the surrounding ground. */}
      <CuboidCollider position={[cx, -0.1, cz]} args={[w / 2, 0.1, d / 2]} friction={0.9} />

      {children}
    </group>
  );
}

/**
 * One wall of a room: computes the openings for its doors and windows, extrudes the wall around
 * them, then places the door leaves, glazing, and collider segments.
 */
function RoomWall({
  shell,
  side,
  playerPosition,
  reducedMotion,
}: {
  shell: RoomShell;
  side: WallSide;
  playerPosition?: THREE.Vector3 | null;
  reducedMotion: boolean;
}) {
  const run = wallRun(shell, side);
  const doors = shell.doors.filter((door) => door.side === side);
  const windows = (shell.windows ?? []).filter((window) => window.side === side);

  const openings: Opening[] = useMemo(() => {
    const list: Opening[] = [];
    for (const door of doors) {
      list.push({ x: door.offset, y: 0, width: (door.width ?? 1.0) + 0.06, height: 2.1 + 0.03 });
    }
    for (const window of windows) {
      list.push({ x: window.offset, y: window.sill, width: window.width, height: window.height });
    }
    return list;
  }, [doors, windows]);

  // Collider segments: the solid stretches of wall between openings. Doors get their own moving
  // collider (on the leaf), and windows are blocked by a full-height collider since you cannot
  // walk through glass either.
  const colliderSegments = useMemo(() => {
    const blocked = doors.map((door) => ({
      from: door.offset - (door.width ?? 1.0) / 2,
      to: door.offset + (door.width ?? 1.0) / 2,
    }));
    blocked.sort((a, b) => a.from - b.from);
    const segments: Array<{ center: number; length: number }> = [];
    let cursor = -run.length / 2;
    for (const gap of blocked) {
      if (gap.from > cursor) segments.push({ center: (cursor + gap.from) / 2, length: gap.from - cursor });
      cursor = Math.max(cursor, gap.to);
    }
    if (cursor < run.length / 2) {
      segments.push({ center: (cursor + run.length / 2) / 2, length: run.length / 2 - cursor });
    }
    return segments;
  }, [doors, run.length]);

  const isEastWest = side === "east" || side === "west";

  return (
    <group>
      <Wall
        position={[run.position[0], 0, run.position[2]]}
        rotation={[0, run.rotation, 0]}
        length={run.length}
        height={shell.height}
        openings={openings}
      />

      {/* Glazing filling the window openings. */}
      {windows.map((window, index) => (
        <Glazing
          key={index}
          spec={window}
          wallPosition={run.position}
          wallRotation={run.rotation}
        />
      ))}

      {/* Door leaves. */}
      {doors.map((door, index) => (
        <DoorInWall
          key={index}
          door={door}
          wallPosition={run.position}
          wallRotation={run.rotation}
          playerPosition={playerPosition}
          reducedMotion={reducedMotion}
        />
      ))}

      {/* Solid-wall colliders. */}
      {colliderSegments.map((segment, index) => {
        const offsetX = isEastWest ? 0 : segment.center;
        const offsetZ = isEastWest ? segment.center : 0;
        return (
          <CuboidCollider
            key={index}
            position={[run.position[0] + offsetX, shell.height / 2, run.position[2] + offsetZ]}
            args={isEastWest ? [0.12, shell.height / 2, segment.length / 2] : [segment.length / 2, shell.height / 2, 0.12]}
          />
        );
      })}
    </group>
  );
}

function Glazing({
  spec,
  wallPosition,
  wallRotation,
}: {
  spec: WindowSpec;
  wallPosition: [number, number, number];
  wallRotation: number;
}) {
  const isEastWest = Math.abs(wallRotation) > 0.1;
  const offsetX = isEastWest ? 0 : spec.offset;
  const offsetZ = isEastWest ? spec.offset : 0;
  const x = wallPosition[0] + offsetX;
  const z = wallPosition[2] + offsetZ;
  const y = spec.sill + spec.height / 2;

  // A mullion every ~1.8m, aligned to the structural grid.
  const bays = Math.max(1, Math.round(spec.width / 1.8));
  const bayWidth = spec.width / bays;

  return (
    <group position={[x, y, z]} rotation={[0, wallRotation, 0]}>
      <mesh material={M.glass}>
        <boxGeometry args={[spec.width, spec.height, 0.03]} />
      </mesh>
      {/* Vertical mullions between bays. */}
      {Array.from({ length: bays + 1 }, (_, index) => (
        <mesh
          key={index}
          position={[-spec.width / 2 + index * bayWidth, 0, 0]}
          castShadow
          material={M.aluminium}
        >
          <boxGeometry args={[0.07, spec.height + 0.05, 0.1]} />
        </mesh>
      ))}
      {/* Head and sill transoms. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, (side * spec.height) / 2, 0]} castShadow material={M.aluminium}>
          <boxGeometry args={[spec.width + 0.06, 0.08, 0.11]} />
        </mesh>
      ))}
      {/* Interior sill/shelf — a real window has depth at the bottom. */}
      {spec.sill > 0.3 && (
        <mesh position={[0, -spec.height / 2 - 0.05, 0.1]} receiveShadow material={M.oak}>
          <boxGeometry args={[spec.width + 0.06, 0.05, 0.22]} />
        </mesh>
      )}
    </group>
  );
}

function DoorInWall({
  door,
  wallPosition,
  wallRotation,
  playerPosition,
  reducedMotion,
}: {
  door: DoorSpec;
  wallPosition: [number, number, number];
  wallRotation: number;
  playerPosition?: THREE.Vector3 | null;
  reducedMotion: boolean;
}) {
  const isEastWest = Math.abs(wallRotation) > 0.1;
  const offsetX = isEastWest ? 0 : door.offset;
  const offsetZ = isEastWest ? door.offset : 0;
  const width = door.width ?? 1.0;

  // Wide openings (atrium/library thresholds) are architecturally open portals rather than doors —
  // fitting a 3.2m swing door would be absurd, and an open threshold is also the step-free,
  // wheelchair-friendly choice for a main circulation route.
  if (width > 1.6) {
    return (
      <group position={[wallPosition[0] + offsetX, 0, wallPosition[2] + offsetZ]} rotation={[0, wallRotation, 0]}>
        {/* Portal lining so the opening reads as a built threshold. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[(side * width) / 2, 1.15, 0]} castShadow receiveShadow material={M.oak}>
            <boxGeometry args={[0.09, 2.3, 0.3]} />
          </mesh>
        ))}
        <mesh position={[0, 2.32, 0]} castShadow receiveShadow material={M.oak}>
          <boxGeometry args={[width + 0.18, 0.09, 0.3]} />
        </mesh>
      </group>
    );
  }

  return (
    <Door
      position={[wallPosition[0] + offsetX, 0, wallPosition[2] + offsetZ]}
      rotation={[0, wallRotation, 0]}
      width={width}
      height={2.1}
      hinge={door.hinge ?? "left"}
      playerPosition={playerPosition}
      reducedMotion={reducedMotion}
    />
  );
}

/**
 * Ceiling treatments. Each is visually distinct because ceiling character is one of the strongest
 * signals of what a space is for — an acoustic-tile classroom, a warm slatted lounge, an exposed
 * services corridor, and a daylit skylight atrium should never read the same.
 */
function Ceiling({ shell, quiet }: { shell: RoomShell; quiet: boolean }) {
  const [cx, cz] = shell.center;
  const [w, d] = shell.size;
  const y = shell.height;

  const downlights = useMemo(() => {
    const lights: Array<[number, number]> = [];
    const cols = Math.max(2, Math.round(w / 3.2));
    const rows = Math.max(2, Math.round(d / 3.2));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        lights.push([
          cx + (col - (cols - 1) / 2) * (w / cols),
          cz + (row - (rows - 1) / 2) * (d / rows),
        ]);
      }
    }
    return lights;
  }, [cx, cz, w, d]);

  const lightMaterial = useMemo(() => makeEmissive("#fff4e0", quiet ? 0.7 : 1.6), [quiet]);

  return (
    <group>
      {shell.ceiling === "skylight" ? (
        <>
          {/* Structural ribs with glazing between — the atrium roof. */}
          {Array.from({ length: 7 }, (_, index) => (
            <mesh
              key={index}
              position={[cx - w / 2 + ((index + 0.5) * w) / 7, y, cz]}
              castShadow
              material={M.steel}
            >
              <boxGeometry args={[0.18, 0.42, d]} />
            </mesh>
          ))}
          <mesh position={[cx, y - 0.05, cz]} rotation={[-Math.PI / 2, 0, 0]} material={M.glass}>
            <planeGeometry args={[w, d]} />
          </mesh>
        </>
      ) : shell.ceiling === "slat" ? (
        <>
          {/* Timber slats — warm, and they break up a large flat plane. */}
          {Array.from({ length: Math.round(d / 0.34) }, (_, index) => (
            <mesh
              key={index}
              position={[cx, y - 0.06, cz - d / 2 + index * 0.34 + 0.17]}
              castShadow
              material={M.oak}
            >
              <boxGeometry args={[w, 0.09, 0.16]} />
            </mesh>
          ))}
          <mesh position={[cx, y, cz]} rotation={[Math.PI / 2, 0, 0]} material={M.concreteRaw}>
            <planeGeometry args={[w, d]} />
          </mesh>
        </>
      ) : shell.ceiling === "exposed" ? (
        <>
          <mesh position={[cx, y, cz]} rotation={[Math.PI / 2, 0, 0]} material={M.concreteRaw}>
            <planeGeometry args={[w, d]} />
          </mesh>
          {/* Exposed services: a cable tray and duct run along the corridor. */}
          <mesh position={[cx, y - 0.28, cz]} castShadow material={M.aluminium}>
            <boxGeometry args={[0.5, 0.28, d]} />
          </mesh>
        </>
      ) : (
        <>
          {/* Acoustic tile with a visible grid — the classroom default. */}
          <mesh position={[cx, y, cz]} rotation={[Math.PI / 2, 0, 0]} receiveShadow material={M.plaster}>
            <planeGeometry args={[w, d]} />
          </mesh>
          {Array.from({ length: Math.round(w / 1.2) + 1 }, (_, index) => (
            <mesh key={`x${index}`} position={[cx - w / 2 + index * 1.2, y - 0.02, cz]} material={M.aluminium}>
              <boxGeometry args={[0.03, 0.03, d]} />
            </mesh>
          ))}
          {Array.from({ length: Math.round(d / 1.2) + 1 }, (_, index) => (
            <mesh key={`z${index}`} position={[cx, y - 0.02, cz - d / 2 + index * 1.2]} material={M.aluminium}>
              <boxGeometry args={[w, 0.03, 0.03]} />
            </mesh>
          ))}
        </>
      )}

      {/* Recessed downlights on the ceiling grid, plus real point lights in the larger rooms. */}
      {downlights.map(([lx, lz], index) => (
        <group key={index} position={[lx, y - 0.06, lz]}>
          <mesh material={lightMaterial}>
            <cylinderGeometry args={[0.11, 0.13, 0.05, 14]} />
          </mesh>
        </group>
      ))}
      {!quiet && shell.height > 4 && (
        <pointLight position={[cx, y - 1.2, cz]} intensity={12} distance={shell.height * 3.4} decay={2} color="#ffeed6" />
      )}
    </group>
  );
}
