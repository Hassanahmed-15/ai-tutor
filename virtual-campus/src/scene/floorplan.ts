/**
 * The building's floorplan — a single source of truth for geometry, colliders, and navigation.
 *
 * The previous campus placed rooms at arbitrary coordinates with hand-written collider numbers
 * that had to be kept in sync by hand. Here every wall, door, and collider is derived from one
 * declarative description, so geometry and physics can never drift apart.
 *
 * ── Design rules encoded here ──
 * · A 7.2m structural grid. Every room dimension, column, and mullion is a multiple or clean
 *   subdivision of it. Consistent rhythm is what separates designed architecture from randomly
 *   placed boxes.
 * · Real dimensions: 3.2m classroom ceilings, 7.4m atrium, 2.1m doors, 2.4m corridors (above the
 *   1.8m accessible minimum so two wheelchairs can pass).
 * · A central corridor spine. Rooms open off it rather than floating in a void — this single
 *   decision is what makes the campus read as one building.
 * · Every room is step-free and reachable from the atrium without passing through another room.
 */

export type WallSide = "north" | "south" | "east" | "west";

export type DoorSpec = {
  /** Which wall the door sits in. */
  side: WallSide;
  /** Offset from the wall's centre along its run, in metres. */
  offset: number;
  width?: number;
  hinge?: "left" | "right";
};

export type WindowSpec = {
  side: WallSide;
  offset: number;
  width: number;
  height: number;
  /** Sill height. 0 = floor-to-ceiling glazing. */
  sill: number;
};

export type RoomShell = {
  id: string;
  /** Centre of the room floor. */
  center: [number, number];
  /** Interior width (x) and depth (z). */
  size: [number, number];
  height: number;
  doors: DoorSpec[];
  windows?: WindowSpec[];
  floor: "concrete" | "oak" | "carpet" | "rubber";
  ceiling: "acoustic" | "slat" | "exposed" | "skylight";
  /** Wall the teaching board is mounted on, if any. */
  boardWall?: WallSide;
  /** Seat grid dimensions for classrooms. */
  seating?: { rows: number; columns: number };
};

const GRID = 7.2;

/**
 * Layout: a west wing and an east wing of teaching rooms flanking a north-south corridor spine,
 * with the atrium at the south (entrance) end and the library/commons at the north.
 *
 *                        ┌─────────────┐
 *                        │   LIBRARY   │  z = -26
 *              ┌─────────┴──┬──────────┴────────┐
 *   z = -16    │  FOCUS LAB │  CORRIDOR │ CALM  │
 *              ├────────────┤   SPINE   ├───────┤
 *   z = -6     │  STUDIO101 │           │VISION │
 *              └────────────┴───────────┴───────┘
 *   z = 4                 │  COMMONS  │
 *              ┌──────────┴───────────┴─────────┐
 *   z = 12     │            ATRIUM              │
 *              └────────────────────────────────┘  entrance (south, z = 20)
 */
export const CORRIDOR = {
  /** Centre-line x of the north-south spine. */
  x: 0,
  width: 3.6,
  /** Extent along z. */
  from: -30,
  to: 6,
  height: 3.6,
};

export const ROOMS: RoomShell[] = [
  {
    id: "atrium",
    center: [0, 15.5],
    size: [GRID * 4, GRID * 1.9],
    height: 7.4,
    floor: "concrete",
    ceiling: "skylight",
    doors: [{ side: "north", offset: 0, width: 3.2 }],
    windows: [
      // Full-height entrance curtain wall facing south.
      { side: "south", offset: 0, width: GRID * 3.2, height: 6.4, sill: 0 },
      { side: "east", offset: 0, width: GRID * 1.6, height: 5.2, sill: 0.9 },
      { side: "west", offset: 0, width: GRID * 1.6, height: 5.2, sill: 0.9 },
    ],
  },
  {
    id: "commons",
    center: [0, 3.6],
    size: [GRID * 1.9, GRID * 1.1],
    height: 4.2,
    floor: "oak",
    ceiling: "slat",
    doors: [
      { side: "south", offset: 0, width: 3.2 },
      { side: "north", offset: 0, width: 3.2 },
    ],
    windows: [
      { side: "east", offset: 0, width: 6.4, height: 2.6, sill: 0.95 },
      { side: "west", offset: 0, width: 6.4, height: 2.6, sill: 0.95 },
    ],
  },
  {
    id: "general",
    center: [-11.4, -6],
    size: [GRID * 1.5, GRID * 1.3],
    height: 3.2,
    floor: "carpet",
    ceiling: "acoustic",
    boardWall: "west",
    seating: { rows: 3, columns: 4 },
    doors: [{ side: "east", offset: 1.8, width: 1.0, hinge: "left" }],
    windows: [{ side: "west", offset: 0, width: 7.4, height: 2.2, sill: 0.95 }],
  },
  {
    id: "focus",
    center: [-11.4, -17.4],
    size: [GRID * 1.5, GRID * 1.3],
    height: 3.2,
    floor: "carpet",
    ceiling: "acoustic",
    boardWall: "west",
    seating: { rows: 2, columns: 3 },
    doors: [{ side: "east", offset: 1.8, width: 1.0, hinge: "left" }],
    windows: [{ side: "west", offset: 0, width: 7.4, height: 2.2, sill: 0.95 }],
  },
  {
    id: "sensory",
    center: [11.4, -17.4],
    size: [GRID * 1.5, GRID * 1.3],
    height: 3.2,
    floor: "rubber",
    ceiling: "acoustic",
    boardWall: "east",
    seating: { rows: 2, columns: 3 },
    doors: [{ side: "west", offset: 1.8, width: 1.0, hinge: "right" }],
    windows: [{ side: "east", offset: 0, width: 7.4, height: 2.2, sill: 0.95 }],
  },
  {
    id: "vision",
    center: [11.4, -6],
    size: [GRID * 1.5, GRID * 1.3],
    height: 3.2,
    floor: "rubber",
    ceiling: "acoustic",
    boardWall: "east",
    seating: { rows: 3, columns: 4 },
    doors: [{ side: "west", offset: 1.8, width: 1.0, hinge: "right" }],
    windows: [{ side: "east", offset: 0, width: 7.4, height: 2.2, sill: 0.95 }],
  },
  {
    id: "communication",
    center: [11.4, -28],
    size: [GRID * 1.5, GRID * 1.2],
    height: 3.2,
    floor: "carpet",
    ceiling: "acoustic",
    boardWall: "east",
    seating: { rows: 2, columns: 3 },
    doors: [{ side: "west", offset: 1.6, width: 1.0, hinge: "right" }],
    windows: [{ side: "east", offset: 0, width: 7.4, height: 2.2, sill: 0.95 }],
  },
  {
    id: "wellness",
    center: [-11.4, -28],
    size: [GRID * 1.5, GRID * 1.2],
    height: 3.2,
    floor: "oak",
    ceiling: "slat",
    doors: [{ side: "east", offset: 1.6, width: 1.0, hinge: "left" }],
    windows: [{ side: "west", offset: 0, width: 7.4, height: 2.4, sill: 0.7 }],
  },
  {
    id: "library",
    center: [0, -39],
    size: [GRID * 2.9, GRID * 1.5],
    height: 5.0,
    floor: "oak",
    ceiling: "slat",
    doors: [{ side: "south", offset: 0, width: 3.2 }],
    windows: [
      { side: "north", offset: 0, width: GRID * 2.8, height: 3.4, sill: 0.8 },
      { side: "east", offset: 0, width: 7.2, height: 2.8, sill: 0.9 },
      { side: "west", offset: 0, width: 7.2, height: 2.8, sill: 0.9 },
    ],
  },
];

export function roomById(id: string): RoomShell | undefined {
  return ROOMS.find((room) => room.id === id);
}

/** Wall run geometry for one side of a room, in world space. */
export function wallRun(room: RoomShell, side: WallSide) {
  const [cx, cz] = room.center;
  const [w, d] = room.size;
  switch (side) {
    case "north":
      return { position: [cx, 0, cz - d / 2] as [number, number, number], length: w, rotation: 0 };
    case "south":
      return { position: [cx, 0, cz + d / 2] as [number, number, number], length: w, rotation: 0 };
    case "east":
      return { position: [cx + w / 2, 0, cz] as [number, number, number], length: d, rotation: Math.PI / 2 };
    case "west":
      return { position: [cx - w / 2, 0, cz] as [number, number, number], length: d, rotation: Math.PI / 2 };
  }
}

/** World position and facing of a room's teaching board. */
export function boardPlacement(room: RoomShell) {
  if (!room.boardWall) return null;
  const run = wallRun(room, room.boardWall);
  const inward: Record<WallSide, [number, number]> = {
    north: [0, 1],
    south: [0, -1],
    east: [-1, 0],
    west: [1, 0],
  };
  const [ix, iz] = inward[room.boardWall];
  const yaw: Record<WallSide, number> = {
    north: 0,
    south: Math.PI,
    east: -Math.PI / 2,
    west: Math.PI / 2,
  };
  return {
    position: [run.position[0] + ix * 0.14, 1.45, run.position[2] + iz * 0.14] as [number, number, number],
    rotation: yaw[room.boardWall],
  };
}

/** Where a student should stand to face the board — used for teleport arrival. */
export function roomArrival(room: RoomShell): [number, number, number] {
  const [cx, cz] = room.center;
  return [cx, 1, cz + room.size[1] * 0.28];
}
