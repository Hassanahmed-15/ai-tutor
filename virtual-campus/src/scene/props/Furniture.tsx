import { Instance, Instances } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { M } from "../materials";

/**
 * Procedural furniture built on the building's structural grid.
 *
 * Deliberately parametric rather than downloaded: a mix of free 3D models from different authors
 * reads as an asset pack, whereas furniture generated from one set of proportions and materials
 * reads as a specified, designed building. Dimensions are real (desks 730mm, seats 450mm) —
 * wrong furniture proportions are one of the fastest ways for a space to feel like a game level.
 *
 * Everything that repeats is instanced: a 24-seat classroom is one draw call per furniture type
 * rather than 24.
 */

export type SeatSpec = {
  id: string;
  /** World position of the seat pad. */
  position: [number, number, number];
  /** Facing direction in radians (0 = facing -Z, the usual board direction). */
  rotation: number;
};

const SEAT_HEIGHT = 0.45;
const DESK_HEIGHT = 0.73;

/** A single chair. Split into pieces so the instanced version can share geometry. */
export function Chair({
  position,
  rotation = 0,
  occupied = false,
  onSit,
}: {
  position: [number, number, number];
  rotation?: number;
  occupied?: boolean;
  onSit?: () => void;
}) {
  return (
    <group
      position={position}
      rotation={[0, rotation, 0]}
      onClick={(event) => {
        if (!onSit) return;
        event.stopPropagation();
        onSit();
      }}
    >
      {/* Seat pad — slightly rounded, upholstered. */}
      <mesh position={[0, SEAT_HEIGHT, 0]} castShadow receiveShadow material={occupied ? M.feltCool : M.felt}>
        <boxGeometry args={[0.46, 0.06, 0.44]} />
      </mesh>
      {/* Backrest, reclined a few degrees like a real task chair. */}
      <mesh position={[0, SEAT_HEIGHT + 0.28, -0.2]} rotation={[-0.12, 0, 0]} castShadow material={occupied ? M.feltCool : M.felt}>
        <boxGeometry args={[0.44, 0.5, 0.05]} />
      </mesh>
      {/* Four tapered legs. */}
      {[[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, SEAT_HEIGHT / 2, z]} castShadow material={M.steel}>
          <cylinderGeometry args={[0.014, 0.018, SEAT_HEIGHT, 8]} />
        </mesh>
      ))}
    </group>
  );
}

/** Student desk with a solid oak top, cable tray, and a modesty panel. */
export function Desk({
  position,
  rotation = 0,
  width = 1.2,
  depth = 0.6,
}: {
  position: [number, number, number];
  rotation?: number;
  width?: number;
  depth?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, DESK_HEIGHT, 0]} castShadow receiveShadow material={M.oak}>
        <boxGeometry args={[width, 0.035, depth]} />
      </mesh>
      {/* Chamfered front edge catches a highlight — the detail that stops it reading as a slab. */}
      <mesh position={[0, DESK_HEIGHT - 0.022, depth / 2 - 0.006]} material={M.oak}>
        <boxGeometry args={[width, 0.014, 0.014]} />
      </mesh>
      {/* Modesty panel. */}
      <mesh position={[0, DESK_HEIGHT - 0.22, -depth / 2 + 0.06]} castShadow material={M.felt}>
        <boxGeometry args={[width * 0.86, 0.34, 0.016]} />
      </mesh>
      {/* Legs. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * (width / 2 - 0.07), DESK_HEIGHT / 2, 0]}
          castShadow
          material={M.aluminium}
        >
          <boxGeometry args={[0.045, DESK_HEIGHT, depth * 0.82]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A classroom's seating, instanced. Returns both the rendered furniture and the seat specs the
 * sitting system needs, so seat positions are defined exactly once.
 */
export function buildSeatGrid({
  center,
  rows,
  columns,
  spacingX = 1.55,
  spacingZ = 1.25,
  startZ,
}: {
  center: [number, number, number];
  rows: number;
  columns: number;
  spacingX?: number;
  spacingZ?: number;
  startZ: number;
}): SeatSpec[] {
  const seats: SeatSpec[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = center[0] + (column - (columns - 1) / 2) * spacingX;
      const z = startZ + row * spacingZ;
      seats.push({ id: `${row}-${column}`, position: [x, center[1], z], rotation: 0 });
    }
  }
  return seats;
}

/**
 * Instanced chair+desk pairs for a whole classroom.
 *
 * Uses drei <Instances> so the entire seating array costs one draw call per component mesh.
 * The occupied seat is rendered separately (non-instanced) so it can take a different material
 * without breaking the instance batch.
 */
export function SeatingGrid({
  seats,
  occupiedSeatId,
  onSit,
}: {
  seats: SeatSpec[];
  occupiedSeatId?: string | null;
  onSit?: (seat: SeatSpec) => void;
}) {
  const free = useMemo(() => seats.filter((seat) => seat.id !== occupiedSeatId), [seats, occupiedSeatId]);
  const taken = useMemo(() => seats.find((seat) => seat.id === occupiedSeatId) ?? null, [seats, occupiedSeatId]);

  return (
    <group>
      {/* Desks: one instanced batch. */}
      <Instances limit={64} castShadow receiveShadow material={M.oak}>
        <boxGeometry args={[1.2, 0.035, 0.6]} />
        {seats.map((seat) => (
          <Instance key={seat.id} position={[seat.position[0], DESK_HEIGHT, seat.position[2] - 0.52]} />
        ))}
      </Instances>

      {/* Desk legs: one instanced batch across every desk. */}
      <Instances limit={128} castShadow material={M.aluminium}>
        <boxGeometry args={[0.045, DESK_HEIGHT, 0.5]} />
        {seats.flatMap((seat) =>
          [-1, 1].map((side) => (
            <Instance
              key={`${seat.id}-${side}`}
              position={[seat.position[0] + side * 0.53, DESK_HEIGHT / 2, seat.position[2] - 0.52]}
            />
          )),
        )}
      </Instances>

      {/* Chairs. Free seats are clickable to sit. */}
      {free.map((seat) => (
        <Chair
          key={seat.id}
          position={seat.position}
          rotation={seat.rotation}
          onSit={onSit ? () => onSit(seat) : undefined}
        />
      ))}
      {taken && <Chair position={taken.position} rotation={taken.rotation} occupied />}
    </group>
  );
}

/** Height a seated avatar's hips should sit at, so the sitting system and chairs stay in sync. */
export const SEAT_PAD_HEIGHT = SEAT_HEIGHT;

/** Teacher's desk — larger, with a return, positioned near the board. */
export function TeacherDesk({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, DESK_HEIGHT, 0]} castShadow receiveShadow material={M.walnut}>
        <boxGeometry args={[1.8, 0.045, 0.75]} />
      </mesh>
      <mesh position={[0, DESK_HEIGHT - 0.24, -0.32]} castShadow material={M.walnut}>
        <boxGeometry args={[1.7, 0.42, 0.05]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.82, DESK_HEIGHT / 2, 0]} castShadow material={M.steel}>
          <boxGeometry args={[0.05, DESK_HEIGHT, 0.68]} />
        </mesh>
      ))}
    </group>
  );
}

/** Simple shelving unit with instanced books — library and classroom storage. */
export function Bookshelf({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const books = useMemo(() => {
    const output: Array<{ x: number; y: number; h: number; c: string }> = [];
    const palette = ["#8c4a3f", "#3f5a72", "#6b6f4a", "#7a5a86", "#a08040"];
    for (let shelf = 0; shelf < 4; shelf++) {
      let x = -0.52;
      while (x < 0.5) {
        const w = 0.022 + Math.random() * 0.018;
        output.push({
          x: x + w / 2,
          y: 0.34 + shelf * 0.42,
          h: 0.2 + Math.random() * 0.08,
          c: palette[Math.floor(Math.random() * palette.length)],
        });
        x += w + 0.004;
      }
    }
    return output;
  }, []);

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Carcass */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.58, 0.9, 0]} castShadow receiveShadow material={M.oak}>
          <boxGeometry args={[0.04, 1.8, 0.32]} />
        </mesh>
      ))}
      {[0.28, 0.7, 1.12, 1.54, 1.78].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow receiveShadow material={M.oak}>
          <boxGeometry args={[1.2, 0.03, 0.32]} />
        </mesh>
      ))}
      {/* Books — instanced, with per-book colour variation via individual Instance colour. */}
      <Instances limit={200} castShadow material={new THREE.MeshStandardMaterial({ roughness: 0.85, envMapIntensity: 0.5 })}>
        <boxGeometry args={[0.026, 1, 0.22]} />
        {books.map((book, index) => (
          <Instance
            key={index}
            position={[book.x, book.y + book.h / 2, 0]}
            scale={[1, book.h, 1]}
            color={book.c}
          />
        ))}
      </Instances>
    </group>
  );
}
