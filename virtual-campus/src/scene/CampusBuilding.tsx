import { Text } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { CAMPUS_ROOMS } from "../campus";
import type { AccessibilityProfile, CampusRoom } from "../types";
import { ROOMS, boardPlacement, type RoomShell } from "./floorplan";
import { CorridorSpine, Grounds } from "./kit/Corridor";
import { Room } from "./kit/Room";
import { M } from "./materials";
import { Bookshelf, SeatingGrid, TeacherDesk, buildSeatGrid, type SeatSpec } from "./props/Furniture";
import { TutorBoard } from "./TutorBoard";

/**
 * The campus, assembled from the floorplan.
 *
 * Every room's walls, doors, glazing, ceiling, colliders, furniture, and board position derive
 * from one `RoomShell` in floorplan.ts, so adding or moving a room is a data change rather than
 * a geometry rewrite — and the physics can never disagree with what you can see.
 */

export type CampusBuildingProps = {
  profile: AccessibilityProfile;
  selectedRoomId: string;
  playerPosition: THREE.Vector3 | null;
  /** Room whose board currently hosts the live tutor iframe (only ever one). */
  liveBoardRoomId: string | null;
  focusedBoardRoomId: string | null;
  onFocusBoard: (roomId: string) => void;
  seatedAt: string | null;
  onSit: (seatId: string, position: [number, number, number]) => void;
  boardPortal?: React.MutableRefObject<HTMLElement | null>;
};

export function CampusBuilding({
  profile,
  selectedRoomId,
  playerPosition,
  liveBoardRoomId,
  focusedBoardRoomId,
  onFocusBoard,
  seatedAt,
  onSit,
  boardPortal,
}: CampusBuildingProps) {
  const quiet = profile.quietWorld;

  return (
    <group>
      <Grounds quiet={quiet} />
      <CorridorSpine quiet={quiet} />

      {ROOMS.map((shell) => {
        const meta = CAMPUS_ROOMS.find((room) => room.id === shell.id);
        return (
          <Room
            key={shell.id}
            shell={shell}
            playerPosition={playerPosition}
            reducedMotion={profile.reducedMotion}
            quiet={quiet}
          >
            <RoomContents
              shell={shell}
              meta={meta}
              selected={selectedRoomId === shell.id}
              quiet={quiet}
              liveBoard={liveBoardRoomId === shell.id}
              focusedBoard={focusedBoardRoomId === shell.id}
              onFocusBoard={() => onFocusBoard(shell.id)}
              seatedAt={seatedAt}
              onSit={onSit}
              boardPortal={boardPortal}
            />
          </Room>
        );
      })}
    </group>
  );
}

/** Everything inside a room: board, furniture, signage, and room-specific character. */
function RoomContents({
  shell,
  meta,
  selected,
  quiet,
  liveBoard,
  focusedBoard,
  onFocusBoard,
  seatedAt,
  onSit,
  boardPortal,
}: {
  shell: RoomShell;
  meta?: CampusRoom;
  selected: boolean;
  quiet: boolean;
  liveBoard: boolean;
  focusedBoard: boolean;
  onFocusBoard: () => void;
  seatedAt: string | null;
  onSit: (seatId: string, position: [number, number, number]) => void;
  boardPortal?: React.MutableRefObject<HTMLElement | null>;
}) {
  const board = boardPlacement(shell);
  const [cx, cz] = shell.center;
  const [w, d] = shell.size;

  // Seating faces the board wall, so the grid is laid out relative to it.
  const seats: SeatSpec[] = useMemo(() => {
    if (!shell.seating) return [];
    const facingEast = shell.boardWall === "east";
    const facingWest = shell.boardWall === "west";
    const rotation = facingEast ? -Math.PI / 2 : facingWest ? Math.PI / 2 : 0;
    const grid = buildSeatGrid({
      center: [cx, 0, cz],
      rows: shell.seating.rows,
      columns: shell.seating.columns,
      spacingX: 1.5,
      spacingZ: 1.35,
      startZ: cz - (shell.seating.rows - 1) * 0.675,
    });
    // For side-mounted boards, rotate the whole grid about the room centre so rows face the wall.
    return grid.map((seat, index) => {
      if (!facingEast && !facingWest) return { ...seat, id: `${shell.id}-${index}` };
      const dx = seat.position[0] - cx;
      const dz = seat.position[2] - cz;
      const sign = facingWest ? 1 : -1;
      return {
        id: `${shell.id}-${index}`,
        position: [cx + dz * sign, seat.position[1], cz - dx * sign] as [number, number, number],
        rotation,
      };
    });
  }, [shell, cx, cz]);

  const occupiedHere = seatedAt && seatedAt.startsWith(shell.id) ? seatedAt : null;

  return (
    <group>
      {board && meta && (
        <TutorBoard
          position={board.position}
          rotation={board.rotation}
          roomName={meta.name}
          tutorRoute={meta.tutorRoute}
          live={liveBoard}
          focused={focusedBoard}
          onRequestFocus={onFocusBoard}
          portal={boardPortal}
        />
      )}

      {seats.length > 0 && (
        <SeatingGrid
          seats={seats}
          occupiedSeatId={occupiedHere}
          onSit={(seat) => onSit(seat.id, seat.position)}
        />
      )}

      {shell.boardWall && (
        <TeacherDesk
          position={teacherDeskPosition(shell)}
          rotation={board?.rotation ?? 0}
        />
      )}

      {/* Room-specific character. Each space gets props that explain what it is for — a room
          full of identical furniture is what makes a campus feel like a template. */}
      {shell.id === "library" && (
        <>
          {[-9, -4.5, 4.5, 9].map((x) => (
            <Bookshelf key={x} position={[cx + x, 0, cz - 2.5]} rotation={0} />
          ))}
          {[-6, 0, 6].map((x) => (
            <group key={x} position={[cx + x, 0, cz + 3]}>
              <TeacherDesk position={[0, 0, 0]} rotation={0} />
            </group>
          ))}
        </>
      )}

      {shell.id === "commons" && (
        <>
          {[-5, 0, 5].map((x) => (
            <group key={x} position={[cx + x, 0, cz]}>
              {/* Round café tables read very differently from classroom desks. */}
              <mesh position={[0, 0.72, 0]} castShadow receiveShadow material={M.walnut}>
                <cylinderGeometry args={[0.55, 0.55, 0.04, 24]} />
              </mesh>
              <mesh position={[0, 0.36, 0]} castShadow material={M.steel}>
                <cylinderGeometry args={[0.06, 0.06, 0.72, 12]} />
              </mesh>
              <mesh position={[0, 0.02, 0]} castShadow material={M.steel}>
                <cylinderGeometry args={[0.34, 0.36, 0.04, 16]} />
              </mesh>
            </group>
          ))}
        </>
      )}

      {shell.id === "atrium" && <Reception position={[cx, 0, cz - 3]} />}

      {/* Wall-mounted room sign at a consistent height beside every door. */}
      {meta && <RoomSign shell={shell} meta={meta} selected={selected} />}

      {/* Indoor planting. Not decoration for its own sake: plants are how modern institutional
          interiors soften hard concrete, and their absence is conspicuous. */}
      {!quiet && (
        <>
          <PlantPot position={[cx - w / 2 + 0.8, 0, cz - d / 2 + 0.8]} />
          <PlantPot position={[cx + w / 2 - 0.8, 0, cz + d / 2 - 0.8]} scale={0.85} />
        </>
      )}
    </group>
  );
}

function teacherDeskPosition(shell: RoomShell): [number, number, number] {
  const [cx, cz] = shell.center;
  const [w, d] = shell.size;
  switch (shell.boardWall) {
    case "west":
      return [cx - w / 2 + 1.9, 0, cz + d / 2 - 1.6];
    case "east":
      return [cx + w / 2 - 1.9, 0, cz + d / 2 - 1.6];
    case "north":
      return [cx + w / 2 - 1.8, 0, cz - d / 2 + 1.5];
    default:
      return [cx, 0, cz - d / 2 + 1.5];
  }
}

function Reception({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Curved reception desk — a landmark you orient by on arrival. */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow material={M.walnut}>
        <cylinderGeometry args={[2.6, 2.6, 1.1, 32, 1, false, Math.PI * 0.15, Math.PI * 0.7]} />
      </mesh>
      <mesh position={[0, 1.13, 0]} castShadow material={M.concreteFloor}>
        <cylinderGeometry args={[2.72, 2.72, 0.06, 32, 1, false, Math.PI * 0.15, Math.PI * 0.7]} />
      </mesh>
      <Text
        position={[0, 2.4, -2.2]}
        fontSize={0.34}
        color="#2c3a37"
        anchorX="center"
        anchorY="middle"
      >
        WELCOME
      </Text>
    </group>
  );
}

function RoomSign({ shell, meta, selected }: { shell: RoomShell; meta: CampusRoom; selected: boolean }) {
  const door = shell.doors[0];
  if (!door) return null;
  const [cx, cz] = shell.center;
  const [w, d] = shell.size;

  // Beside the door, on the corridor side, at a consistent 1.6m — signage at a predictable
  // height is a genuine wayfinding accessibility requirement, not a stylistic choice.
  let position: [number, number, number];
  let rotation = 0;
  switch (door.side) {
    case "east":
      position = [cx + w / 2 + 0.14, 1.6, cz + door.offset + 1.0];
      rotation = -Math.PI / 2;
      break;
    case "west":
      position = [cx - w / 2 - 0.14, 1.6, cz + door.offset + 1.0];
      rotation = Math.PI / 2;
      break;
    case "north":
      position = [cx + door.offset + 1.9, 1.6, cz - d / 2 - 0.14];
      rotation = Math.PI;
      break;
    default:
      position = [cx + door.offset + 1.9, 1.6, cz + d / 2 + 0.14];
      rotation = 0;
  }

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow material={selected ? M.brass : M.aluminium}>
        <boxGeometry args={[0.62, 0.3, 0.014]} />
      </mesh>
      <Text
        position={[0, 0.05, 0.009]}
        fontSize={0.072}
        color="#1d2a27"
        anchorX="center"
        anchorY="middle"
        maxWidth={0.55}
      >
        {meta.shortName}
      </Text>
      <Text
        position={[0, -0.07, 0.009]}
        fontSize={0.038}
        color="#5a6764"
        anchorX="center"
        anchorY="middle"
        maxWidth={0.55}
      >
        {meta.subject}
      </Text>
    </group>
  );
}

function PlantPot({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.24, 0]} castShadow receiveShadow material={M.ceramic}>
        <cylinderGeometry args={[0.26, 0.19, 0.48, 18]} />
      </mesh>
      {/* Layered foliage masses rather than one blob. */}
      {[
        { p: [0, 0.85, 0], r: 0.34, c: "#4a6b3c" },
        { p: [0.2, 0.68, 0.14], r: 0.26, c: "#3f5f34" },
        { p: [-0.17, 0.72, -0.12], r: 0.23, c: "#55764a" },
      ].map((mass, index) => (
        <mesh key={index} position={mass.p as [number, number, number]} castShadow>
          <icosahedronGeometry args={[mass.r, 1]} />
          <meshStandardMaterial color={mass.c} roughness={0.86} flatShading envMapIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}
