import { Text } from "@react-three/drei";
import { CuboidCollider } from "@react-three/rapier";
import { useMemo } from "react";
import * as THREE from "three";
import { CAMPUS_ROOMS } from "../campus";
import type { AccessibilityProfile, CampusRoom } from "../types";
import { ROOMS, boardPlacement, type RoomShell } from "./floorplan";
import { CorridorSpine, Grounds } from "./kit/Corridor";
import { Room } from "./kit/Room";
import { M, makeEmissive } from "./materials";

// One shared glowing-screen material for every monitor on campus — a screen is a light source,
// and reusing the instance keeps the shader program count flat.
const screenGlow = makeEmissive("#1c2f3a", 0.85);
import { Bookshelf, SeatingGrid, TeacherDesk, buildSeatGrid, type SeatSpec } from "./props/Furniture";
import {
  CoffeeMachine,
  ElevatorDoors,
  ExitSign,
  InfoKiosk,
  LockerBank,
  NoticeBoard,
  Projector,
  RestroomSign,
  WallClock,
  WaterDispenser,
} from "./props/Fixtures";
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

      {/* Corridor service core: restrooms, lockers, and the fire-exit signage that makes an
          institutional corridor read as legally real. Placed in the gap between the spine and
          the east teaching wing. */}
      <group position={[4.0, 0, -22]}>
        <mesh position={[0, 1.5, 0]} castShadow receiveShadow material={M.concreteWall}>
          <boxGeometry args={[2.6, 3.0, 5.6]} />
        </mesh>
        <CuboidCollider position={[0, 1.5, 0]} args={[1.3, 1.5, 2.8]} />
        {/* Two restroom doors on the corridor-facing side. */}
        {[-1.5, 1.5].map((dz, index) => (
          <group key={dz} position={[-1.31, 0, dz]}>
            <mesh position={[0, 1.05, 0]} castShadow material={M.oak}>
              <boxGeometry args={[0.05, 2.1, 0.92]} />
            </mesh>
            <RestroomSign
              position={[-0.05, 1.55, 0]}
              rotation={-Math.PI / 2}
              label={index === 0 ? "WC ♿" : "WC"}
            />
          </group>
        ))}
        <ExitSign position={[-1.34, 2.62, 0]} rotation={-Math.PI / 2} />
        <LockerBank position={[1.32, 0, -2.2]} rotation={Math.PI / 2} count={8} />
      </group>

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

      {/* Standard classroom kit: every taught room gets a projector over the seats, a clock the
          students can see, and a notice board by the door — the fixtures a room needs before
          anyone believes lessons happen in it. */}
      {shell.seating && (
        <>
          <Projector position={[cx, shell.height - 0.35, cz + 0.6]} />
          <WallClock
            position={[cx, 2.45, cz + d / 2 - 0.06]}
            rotation={Math.PI}
          />
          <NoticeBoard position={[cx + w / 2 - 0.08, 1.5, cz + d / 2 - 2.2]} rotation={-Math.PI / 2} />
        </>
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

      {shell.id === "atrium" && (
        <>
          <Reception position={[cx, 0, cz - 3]} />
          {/* Arrival services along the east wall: directory kiosk and the lift core. */}
          <InfoKiosk
            position={[cx + 5.2, 0, cz + 2.5]}
            rotation={-Math.PI / 4}
            lines={CAMPUS_ROOMS.map((room) => ({ label: room.shortName, detail: room.nextSession }))}
          />
          <ElevatorDoors position={[cx + w / 2 - 1.2, 0, cz - d / 2 + 2.6]} rotation={-Math.PI / 2} />
          <ExitSign position={[cx, 2.55, cz + d / 2 - 0.3]} rotation={Math.PI} />
        </>
      )}

      {shell.id === "cafeteria" && (
        <>
          {/* Service counter along the north wall, coffee + water at its ends. */}
          <mesh position={[cx, 0.5, cz - d / 2 + 0.9]} castShadow receiveShadow material={M.walnut}>
            <boxGeometry args={[5.4, 1.0, 0.8]} />
          </mesh>
          <mesh position={[cx, 1.02, cz - d / 2 + 0.9]} castShadow material={M.concreteFloor}>
            <boxGeometry args={[5.6, 0.05, 0.9]} />
          </mesh>
          <CoffeeMachine position={[cx - 2.9, 0, cz - d / 2 + 0.9]} />
          <WaterDispenser position={[cx + 3.2, 0, cz - d / 2 + 0.7]} />
          {/* Menu board above the counter. */}
          <group position={[cx, 2.6, cz - d / 2 + 0.18]}>
            <mesh material={M.rubberFloor} castShadow>
              <boxGeometry args={[3.2, 0.9, 0.05]} />
            </mesh>
            <Text position={[0, 0.24, 0.03]} fontSize={0.16} color="#f0d9a8" anchorX="center" anchorY="middle">
              ARIA CAFÉ
            </Text>
            <Text position={[0, -0.08, 0.03]} fontSize={0.09} color="#cfe4dd" anchorX="center" anchorY="middle">
              flat white · pour-over · chai · soup of the day
            </Text>
            <Text position={[0, -0.28, 0.03]} fontSize={0.07} color="#8aa39d" anchorX="center" anchorY="middle">
              all items allergy-labelled at the counter
            </Text>
          </group>
          {/* Shared dining tables. */}
          {[[-2.6, 1.2], [0.4, 1.6], [3.0, 0.6], [-0.8, -1.6], [2.2, -2.0]].map(([dx, dz], index) => (
            <group key={index} position={[cx + dx, 0, cz + dz]}>
              <mesh position={[0, 0.72, 0]} castShadow receiveShadow material={M.oak}>
                <cylinderGeometry args={[0.55, 0.55, 0.04, 20]} />
              </mesh>
              <mesh position={[0, 0.36, 0]} castShadow material={M.steel}>
                <cylinderGeometry args={[0.05, 0.05, 0.72, 10]} />
              </mesh>
            </group>
          ))}
        </>
      )}

      {shell.id === "innovation" && (
        <>
          {/* Workstation benches with monitors — two rows. */}
          {[[-2.2, -1.4], [1.6, -1.4], [-2.2, 1.4], [1.6, 1.4]].map(([dx, dz], index) => (
            <group key={index} position={[cx + dx, 0, cz + dz]}>
              <mesh position={[0, 0.74, 0]} castShadow receiveShadow material={M.oak}>
                <boxGeometry args={[2.4, 0.04, 0.8]} />
              </mesh>
              {[-1, 1].map((side) => (
                <mesh key={side} position={[side * 1.1, 0.37, 0]} castShadow material={M.steel}>
                  <boxGeometry args={[0.05, 0.74, 0.7]} />
                </mesh>
              ))}
              {/* Two monitors per bench, screens facing the seats. */}
              {[-0.6, 0.6].map((mx) => (
                <group key={mx} position={[mx, 0.98, -0.12]}>
                  <mesh castShadow material={M.rubberFloor}>
                    <boxGeometry args={[0.52, 0.32, 0.03]} />
                  </mesh>
                  <mesh position={[0, 0, 0.017]} material={screenGlow}>
                    <planeGeometry args={[0.48, 0.28]} />
                  </mesh>
                  <mesh position={[0, -0.2, 0.04]} material={M.aluminium}>
                    <boxGeometry args={[0.06, 0.1, 0.06]} />
                  </mesh>
                </group>
              ))}
            </group>
          ))}
          {/* Robot-arm demo bench. */}
          <group position={[cx + 3.4, 0, cz - 2.6]}>
            <mesh position={[0, 0.5, 0]} castShadow receiveShadow material={M.concreteRaw}>
              <boxGeometry args={[1.2, 1.0, 1.0]} />
            </mesh>
            <mesh position={[0, 1.08, 0]} castShadow material={M.steel}>
              <cylinderGeometry args={[0.12, 0.16, 0.16, 14]} />
            </mesh>
            <mesh position={[0.12, 1.42, 0]} rotation={[0, 0, -0.5]} castShadow material={M.brass}>
              <boxGeometry args={[0.1, 0.62, 0.1]} />
            </mesh>
            <mesh position={[0.4, 1.66, 0]} rotation={[0, 0, 0.9]} castShadow material={M.brass}>
              <boxGeometry args={[0.08, 0.5, 0.08]} />
            </mesh>
            <mesh position={[0.56, 1.5, 0]} castShadow material={M.steel}>
              <boxGeometry args={[0.1, 0.12, 0.14]} />
            </mesh>
          </group>
          <LockerBank position={[cx - w / 2 + 0.5, 0, cz + d / 2 - 1.2]} rotation={Math.PI / 2} count={4} />
        </>
      )}

      {shell.id === "auditorium" && (
        <>
          {/* Stage at the north end with a step-free side ramp — the accommodation the room
              metadata promises, built into the geometry rather than noted on a sign. */}
          <mesh position={[cx, 0.2, cz - d / 2 + 1.9]} castShadow receiveShadow material={M.oakFloor}>
            <boxGeometry args={[12, 0.4, 3.4]} />
          </mesh>
          <CuboidCollider position={[cx, 0.2, cz - d / 2 + 1.9]} args={[6, 0.2, 1.7]} />
          <mesh
            position={[cx + 7.1, 0.1, cz - d / 2 + 1.9]}
            rotation={[0, 0, 0.19]}
            castShadow
            receiveShadow
            material={M.oakFloor}
          >
            <boxGeometry args={[2.2, 0.06, 3.4]} />
          </mesh>
          <CuboidCollider
            position={[cx + 7.1, 0.1, cz - d / 2 + 1.9]}
            rotation={[0, 0, 0.19]}
            args={[1.1, 0.03, 1.7]}
          />
          {/* Tiered rows rising toward the back, every tier reachable without steps along the
              centre aisle (flat floor) — wheelchair positions are the aisle ends of each tier. */}
          {[0, 1, 2, 3].map((tier) => {
            const tierZ = cz - d / 2 + 6.4 + tier * 2.2;
            const tierY = tier * 0.32;
            return (
              <group key={tier}>
                {tier > 0 && (
                  <>
                    <mesh position={[cx, tierY / 2, tierZ]} castShadow receiveShadow material={M.concreteWall}>
                      <boxGeometry args={[w - 2.4, tierY, 2.0]} />
                    </mesh>
                    <CuboidCollider position={[cx, tierY / 2, tierZ]} args={[(w - 2.4) / 2, tierY / 2, 1.0]} />
                  </>
                )}
                {[-7.2, -4.8, -2.4, 2.4, 4.8, 7.2].map((sx) => (
                  <group key={sx} position={[cx + sx, tierY, tierZ]} rotation={[0, Math.PI, 0]}>
                    <mesh position={[0, 0.45, 0]} castShadow material={M.feltCool}>
                      <boxGeometry args={[1.9, 0.07, 0.5]} />
                    </mesh>
                    <mesh position={[0, 0.75, -0.24]} rotation={[-0.14, 0, 0]} castShadow material={M.feltCool}>
                      <boxGeometry args={[1.9, 0.55, 0.06]} />
                    </mesh>
                    {[-0.85, 0.85].map((lx) => (
                      <mesh key={lx} position={[lx, 0.22, 0]} castShadow material={M.steel}>
                        <boxGeometry args={[0.05, 0.44, 0.4]} />
                      </mesh>
                    ))}
                  </group>
                ))}
              </group>
            );
          })}
          <ExitSign position={[cx - 6, 2.5, cz - d / 2 + 0.3]} />
        </>
      )}

      {shell.id === "meditation" && (
        <>
          {/* A circle of floor cushions on a soft rug; a low shelf for shoes by the door. The
              quietest room in the plan stays deliberately near-empty. */}
          <mesh position={[cx, 0.012, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[2.4, 28]} />
            <meshStandardMaterial color="#b9a88c" roughness={0.98} envMapIntensity={0.4} />
          </mesh>
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const angle = (index / 6) * Math.PI * 2;
            return (
              <mesh
                key={index}
                position={[cx + Math.cos(angle) * 1.5, 0.09, cz + Math.sin(angle) * 1.5]}
                castShadow
                receiveShadow
              >
                <cylinderGeometry args={[0.32, 0.36, 0.16, 16]} />
                <meshStandardMaterial color={index % 2 ? "#8c7a62" : "#6f7d72"} roughness={0.95} envMapIntensity={0.4} />
              </mesh>
            );
          })}
          <mesh position={[cx + w / 2 - 1.2, 0.18, cz + d / 2 - 0.5]} castShadow receiveShadow material={M.oak}>
            <boxGeometry args={[1.6, 0.36, 0.36]} />
          </mesh>
        </>
      )}

      {shell.id === "offices" && (
        <>
          {/* Three faculty desks with monitors and privacy panels. */}
          {[[-1.8, -1.5, 0], [1.8, -1.5, 0], [0, 1.7, Math.PI]].map(([dx, dz, rot], index) => (
            <group key={index} position={[cx + (dx as number), 0, cz + (dz as number)]} rotation={[0, rot as number, 0]}>
              <TeacherDesk position={[0, 0, 0]} rotation={0} />
              <group position={[0, 1.1, -0.14]}>
                <mesh castShadow material={M.rubberFloor}>
                  <boxGeometry args={[0.5, 0.3, 0.03]} />
                </mesh>
                <mesh position={[0, 0, 0.017]} material={screenGlow}>
                  <planeGeometry args={[0.46, 0.26]} />
                </mesh>
              </group>
              <mesh position={[0, 1.05, -0.55]} castShadow material={M.feltCool}>
                <boxGeometry args={[1.9, 1.2, 0.04]} />
              </mesh>
            </group>
          ))}
          {/* The accessibility centre identity — this room IS the service, said plainly. */}
          <group position={[cx, 1.9, cz - d / 2 + 0.16]}>
            <mesh castShadow material={M.brass}>
              <boxGeometry args={[2.4, 0.42, 0.03]} />
            </mesh>
            <Text position={[0, 0.06, 0.02]} fontSize={0.14} color="#241f16" anchorX="center" anchorY="middle">
              ACCESSIBILITY CENTRE
            </Text>
            <Text position={[0, -0.12, 0.02]} fontSize={0.07} color="#4b4232" anchorX="center" anchorY="middle">
              every accommodation on campus is arranged here
            </Text>
          </group>
        </>
      )}

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
