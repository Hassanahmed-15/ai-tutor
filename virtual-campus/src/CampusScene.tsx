import { Bvh } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CAMPUS_ROOMS } from "./campus";
import { PlayerController, type TeleportRequest, type TouchInput } from "./PlayerController";
import { RemoteAvatars } from "./net/RemoteAvatars";
import type { PeerState } from "./net/useCampusNetwork";
import { CampusBuilding } from "./scene/CampusBuilding";
import { Lighting } from "./scene/Lighting";
import { Postprocessing } from "./scene/Postprocessing";
import { applyHighContrast, applyLowStimulation } from "./scene/materials";
import { ROOMS, boardPlacement } from "./scene/floorplan";
import type { AccessibilityProfile, CampusRoom } from "./types";

type SceneProps = {
  selectedRoom: CampusRoom;
  profile: AccessibilityProfile;
  onSelectRoom: (roomId: string) => void;
  onOpenBoard: () => void;
  touch: TouchInput;
  teleport: TeleportRequest;
  paused: boolean;
  onRoomChange: (room: CampusRoom) => void;
  onBoardProximity: (room: CampusRoom | null) => void;
  onPlayerUpdate: (position: [number, number, number], state: "idle" | "walking" | "running", rotation: number) => void;
  peers?: PeerState[];
  onNetworkFrame?: (position: [number, number, number], rotation: number) => void;
  seatedAt: string | null;
  onSit: (seatId: string, position: [number, number, number]) => void;
  focusedBoardRoomId: string | null;
  onFocusBoard: (roomId: string) => void;
  boardPortal?: React.MutableRefObject<HTMLElement | null>;
};

export function CampusScene(props: SceneProps) {
  const { profile, onSelectRoom, onOpenBoard } = props;

  // Accessibility preferences that are genuinely rendering modes rather than UI styling: they
  // mutate the shared material library in place so every surface responds at once.
  useEffect(() => {
    applyLowStimulation(profile.quietWorld);
  }, [profile.quietWorld]);
  useEffect(() => {
    applyHighContrast(profile.highContrast);
  }, [profile.highContrast]);

  // The player's live world position, shared with doors (proximity opening) and the board
  // manager. Held in a ref updated each frame rather than state, so it never triggers a re-render
  // of the whole scene graph 60 times a second.
  const playerVec = useRef(new THREE.Vector3(0, 1, 14));
  const [playerSnapshot, setPlayerSnapshot] = useState<THREE.Vector3 | null>(null);

  // Only ONE board hosts a live tutor iframe at a time — each is an entire browser document
  // running the full tutor app. The nearest board within range wins.
  const [liveBoardRoomId, setLiveBoardRoomId] = useState<string | null>(null);

  const boardAnchors = useMemo(
    () =>
      ROOMS.flatMap((shell) => {
        const placement = boardPlacement(shell);
        return placement ? [{ id: shell.id, position: placement.position }] : [];
      }),
    [],
  );

  return (
    <>
      <color attach="background" args={[profile.highContrast ? "#e8f1f4" : "#b9d2dd"]} />
      <fog attach="fog" args={[profile.highContrast ? "#e8f1f4" : "#b9d2dd", 70, 160]} />
      <Lighting profile={profile} bounds={[46, 46]} />
      <Postprocessing profile={profile} />

      {/* BVH acceleration: replaces three's linear raycast with a bounded hierarchy. Speeds up
          the board's Html occlusion raycasts, chair clicks, and all pointer picking at once. */}
      <Bvh firstHitOnly>
        <Physics gravity={[0, -18, 0]} timeStep="vary">
          <CampusBuilding
            profile={profile}
            selectedRoomId={props.selectedRoom.id}
            playerPosition={playerSnapshot}
            liveBoardRoomId={liveBoardRoomId}
            focusedBoardRoomId={props.focusedBoardRoomId}
            onFocusBoard={props.onFocusBoard}
            seatedAt={props.seatedAt}
            onSit={props.onSit}
            boardPortal={props.boardPortal}
          />

          <RemoteAvatars peers={props.peers ?? []} showLabels={!profile.quietWorld} />

          <PlayerController
            profile={profile}
            touch={props.touch}
            teleport={props.teleport}
            paused={props.paused || props.focusedBoardRoomId !== null}
            onRoomChange={props.onRoomChange}
            onBoardProximity={props.onBoardProximity}
            onPlayerUpdate={(position, state, rotation) => {
              playerVec.current.set(position[0], position[1], position[2]);
              // A cloned snapshot is handed to the door/board systems at the 20Hz controller rate
              // rather than every frame — proximity logic does not need per-frame precision.
              setPlayerSnapshot(playerVec.current.clone());

              // Pick the nearest board within mounting range.
              let nearest: string | null = null;
              let nearestDistance = 9;
              for (const anchor of boardAnchors) {
                const distance = Math.hypot(
                  anchor.position[0] - position[0],
                  anchor.position[2] - position[2],
                );
                if (distance < nearestDistance) {
                  nearestDistance = distance;
                  nearest = anchor.id;
                }
              }
              setLiveBoardRoomId((current) => (current === nearest ? current : nearest));

              props.onPlayerUpdate(position, state, rotation);
              props.onNetworkFrame?.(position, rotation);
            }}
            onInteract={(room) => {
              onSelectRoom(room.id);
              // Interacting with a board now focuses it in-world rather than opening the old
              // full-screen 2D dialog. The dialog remains available from the HUD as the
              // non-3D accessibility route.
              const hasInWorldBoard = ROOMS.some((shell) => shell.id === room.id && shell.boardWall);
              if (hasInWorldBoard) props.onFocusBoard(room.id);
              else onOpenBoard();
            }}
          />
        </Physics>
      </Bvh>
    </>
  );
}

export { CAMPUS_ROOMS };
