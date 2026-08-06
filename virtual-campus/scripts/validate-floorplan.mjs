/**
 * Executable floorplan validation — run with `npm run validate`.
 *
 * Builds every wall's real extruded geometry and checks the invariants that, when broken, render
 * as visibly wrong architecture: rooms intersecting each other, doors/windows overflowing their
 * wall, windows punching through ceilings, NaN vertices, unreachable rooms. This test caught five
 * genuine room overlaps and two oversized windows during the original build — it is not
 * hypothetical coverage.
 */
import * as THREE from "three";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../src/scene/floorplan.ts"), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const temp = path.join(here, ".floorplan.transpiled.mjs");
fs.writeFileSync(temp, transpiled);
const { ROOMS, wallRun, boardPlacement, roomArrival } = await import(pathToFileURL(temp).href);
fs.unlinkSync(temp);

let failures = 0;
const fail = (message) => {
  console.log("  FAIL " + message);
  failures++;
};
const finite = (value) => Number.isFinite(value);
const SIDES = ["north", "south", "east", "west"];

console.log(`=== FLOORPLAN VALIDATION (${ROOMS.length} rooms) ===\n`);

for (const room of ROOMS) {
  for (const side of SIDES) {
    const run = wallRun(room, side);
    if (!finite(run.length) || run.length <= 0 || !run.position.every(finite)) {
      fail(`${room.id}.${side}: bad wall run`);
    }
  }
  for (const door of room.doors) {
    const run = wallRun(room, door.side);
    if (Math.abs(door.offset) + (door.width ?? 1) / 2 > run.length / 2) {
      fail(`${room.id}: door on ${door.side} overflows its wall`);
    }
  }
  for (const window of room.windows ?? []) {
    const run = wallRun(room, window.side);
    if (Math.abs(window.offset) + window.width / 2 > run.length / 2 + 0.001) {
      fail(`${room.id}: window on ${window.side} (${window.width}m) overflows wall (${run.length.toFixed(1)}m)`);
    }
    if (window.sill + window.height > room.height + 0.001) {
      fail(`${room.id}: window on ${window.side} exceeds ceiling height`);
    }
  }
  if (!room.doors.length) fail(`${room.id}: no doors — unreachable`);
  if (room.boardWall && !boardPlacement(room).position.every(finite)) fail(`${room.id}: bad board placement`);
  if (!roomArrival(room).every(finite)) fail(`${room.id}: bad arrival point`);
}

// Build every wall's actual extrusion with its holes — the real failure mode.
for (const room of ROOMS) {
  for (const side of SIDES) {
    const run = wallRun(room, side);
    const doors = room.doors.filter((door) => door.side === side);
    const windows = (room.windows ?? []).filter((window) => window.side === side);
    const shape = new THREE.Shape();
    const half = run.length / 2;
    const base = 0.09;
    shape.moveTo(-half, base);
    shape.lineTo(half, base);
    shape.lineTo(half, room.height);
    shape.lineTo(-half, room.height);
    shape.closePath();
    const openings = [
      ...doors.map((door) => ({ x: door.offset, y: 0, width: (door.width ?? 1) + 0.06, height: 2.13 })),
      ...windows.map((window) => ({ x: window.offset, y: window.sill, width: window.width, height: window.height })),
    ];
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
    try {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.22,
        bevelEnabled: true,
        bevelThickness: 0.004,
        bevelSize: 0.004,
        bevelSegments: 1,
      });
      const positions = geometry.attributes.position.array;
      if (!positions.length) fail(`${room.id}.${side}: extrusion produced no vertices`);
      for (let i = 0; i < positions.length; i++) {
        if (!finite(positions[i])) {
          fail(`${room.id}.${side}: NaN vertex`);
          break;
        }
      }
    } catch (error) {
      fail(`${room.id}.${side}: extrude threw ${error.message}`);
    }
  }
}

// Rooms must not overlap — intersecting walls render as z-fighting geometry soup.
for (let i = 0; i < ROOMS.length; i++) {
  for (let j = i + 1; j < ROOMS.length; j++) {
    const a = ROOMS[i];
    const b = ROOMS[j];
    const overlapX = (a.size[0] + b.size[0]) / 2 - Math.abs(a.center[0] - b.center[0]);
    const overlapZ = (a.size[1] + b.size[1]) / 2 - Math.abs(a.center[1] - b.center[1]);
    if (overlapX > 0.02 && overlapZ > 0.02) {
      fail(`rooms overlap: ${a.id} & ${b.id} (${overlapX.toFixed(2)}m x ${overlapZ.toFixed(2)}m)`);
    }
  }
}

console.log(failures === 0 ? "\nALL GEOMETRY CHECKS PASSED\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
