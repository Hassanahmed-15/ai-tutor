import { Html, RoundedBox, useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, Physics } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CAMPUS_PEOPLE, CAMPUS_ROOMS } from "./campus";
import { PlayerController, type TeleportRequest, type TouchInput } from "./PlayerController";
import { RemoteAvatars } from "./net/RemoteAvatars";
import type { PeerState } from "./net/useCampusNetwork";
import { GroundingShadow, Lighting } from "./scene/Lighting";
import { M, applyHighContrast, applyLowStimulation } from "./scene/materials";
import type { AccessibilityProfile, CampusPerson, CampusRoom } from "./types";

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
  /** Real people from the multiplayer server, rendered alongside the scripted campus NPCs. */
  peers?: PeerState[];
  /** Called every frame with the player's world transform so the network layer can sync position
   *  and keep the spatial-audio listener attached to the avatar. */
  onNetworkFrame?: (position: [number, number, number], rotation: number) => void;
};

export function CampusScene(props: SceneProps) {
  const { selectedRoom, profile, onSelectRoom, onOpenBoard } = props;

  // Accessibility preferences that are genuinely *rendering* modes rather than UI styling: they
  // mutate the shared material library in place, so every surface in the building responds at
  // once without threading props through the whole scene graph.
  useEffect(() => {
    applyLowStimulation(profile.quietWorld);
  }, [profile.quietWorld]);
  useEffect(() => {
    applyHighContrast(profile.highContrast);
  }, [profile.highContrast]);

  return (
    <>
      {/* Sky. A single flat colour reads as a backdrop; a subtle vertical gradient reads as
          atmosphere, and it is what the glass facade reflects. */}
      <color attach="background" args={[profile.highContrast ? "#e8f1f4" : "#b9d2dd"]} />
      {/* Fog pushed much further out. The previous 42-92 range greyed out the far side of the
          campus, flattening depth; distance haze should be a subtle cue, not a wall. */}
      <fog attach="fog" args={[profile.highContrast ? "#e8f1f4" : "#b9d2dd", 68, 145]} />
      <Lighting profile={profile} />

      <Physics gravity={[0, -18, 0]} timeStep="vary">
        <WorldColliders />
        <CampusArchitecture {...props} />
        {!profile.quietWorld && CAMPUS_PEOPLE.map((person) => (
          <HumanAvatar key={person.id} person={person} reducedMotion={profile.reducedMotion} />
        ))}
        {/* Real people from the multiplayer server. Rendered outside the quietWorld gate that
            hides scripted NPCs: a low-stimulation preference is about ambient background
            activity, and hiding the actual humans you came to study with would be wrong. */}
        <RemoteAvatars peers={props.peers ?? []} showLabels={!profile.quietWorld} />
        <PlayerController
          profile={profile}
          touch={props.touch}
          teleport={props.teleport}
          paused={props.paused}
          onRoomChange={props.onRoomChange}
          onBoardProximity={props.onBoardProximity}
          onPlayerUpdate={(position, state, rotation) => {
            props.onPlayerUpdate(position, state, rotation);
            props.onNetworkFrame?.(position, rotation);
          }}
          onInteract={(room) => {
            onSelectRoom(room.id);
            onOpenBoard();
          }}
        />
      </Physics>
    </>
  );
}

function WorldColliders() {
  const classrooms = CAMPUS_ROOMS.filter((room) => room.zone === "classroom");
  return (
    <group>
      <CuboidCollider position={[0, -0.55, 3]} args={[36, 0.28, 27.5]} friction={0.8} />
      <CuboidCollider position={[0, 1.8, -12.2]} args={[24.5, 2, 0.18]} />
      <CuboidCollider position={[-24.2, 1.8, 3]} args={[0.18, 2, 15.1]} />
      <CuboidCollider position={[24.2, 1.8, 3]} args={[0.18, 2, 15.1]} />
      {classrooms.map((room) => {
        const [x, , z] = room.position;
        const boardZ = z - (z > 0 ? 4.45 : 4.7);
        return (
          <group key={room.id}>
            <CuboidCollider position={[x - 4.35, 1.65, z]} args={[0.1, 1.75, 4.9]} />
            <CuboidCollider position={[x + 4.35, 1.65, z]} args={[0.1, 1.75, 4.9]} />
            <CuboidCollider position={[x, 1.65, boardZ - 0.28]} args={[4.4, 1.75, 0.1]} />
          </group>
        );
      })}
    </group>
  );
}

function CampusArchitecture(props: SceneProps) {
  const classroomRooms = CAMPUS_ROOMS.filter((room) => room.zone === "classroom");
  return (
    <group>
      <Ground />
      <BuildingShell />
      <Atrium selected={props.selectedRoom.id === "atrium"} onSelect={() => props.onSelectRoom("atrium")} />
      {classroomRooms.map((room) => (
        <Classroom
          key={room.id}
          room={room}
          selected={props.selectedRoom.id === room.id}
          quiet={props.profile.quietWorld}
          onSelect={() => props.onSelectRoom(room.id)}
          onOpenBoard={props.onOpenBoard}
        />
      ))}
      <Commons selected={props.selectedRoom.id === "commons"} onSelect={() => props.onSelectRoom("commons")} />
      <Library selected={props.selectedRoom.id === "library"} onSelect={() => props.onSelectRoom("library")} />
      <WellnessRoom selected={props.selectedRoom.id === "wellness"} onSelect={() => props.onSelectRoom("wellness")} />
      <Wayfinding />
    </group>
  );
}

function Ground() {
  return (
    <>
      {/* Landscape. Fully matte, no env contribution — grass should never look wet. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 3]} receiveShadow>
        <planeGeometry args={[72, 55]} />
        <meshStandardMaterial color="#5f7a58" roughness={1} metalness={0} envMapIntensity={0.35} />
      </mesh>
      {/* Building floor plate — polished concrete. This surface is doing a lot of the realism
          work now: at roughness 0.25 with envMapIntensity 1.15 it picks up the window wall as a
          soft vertical reflection, which is the signature look of a daylit concrete interior. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.28, 3]} receiveShadow material={M.concreteFloor}>
        <planeGeometry args={[49, 32]} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 27, 0, 3]}>
          {Array.from({ length: 7 }, (_, index) => (
            <Tree key={index} position={[side * (index % 2), 0, -15 + index * 5]} scale={0.8 + (index % 3) * 0.1} />
          ))}
        </group>
      ))}
    </>
  );
}

function BuildingShell() {
  return (
    <group>
      <Wall position={[0, 1.8, -12.2]} scale={[49, 3.9, 0.32]} color="#e5ded1" />
      <Wall position={[-24.2, 1.8, 3]} scale={[0.32, 3.9, 30.2]} color="#d8d2c8" />
      <Wall position={[24.2, 1.8, 3]} scale={[0.32, 3.9, 30.2]} color="#d8d2c8" />
      <Wall position={[-17, 1.8, 18]} scale={[14, 3.9, 0.32]} color="#dfd8cc" />
      <Wall position={[17, 1.8, 18]} scale={[14, 3.9, 0.32]} color="#dfd8cc" />
      {/*
        Entrance curtain wall. Previously 8 separate meshPhysicalMaterials with transmission —
        each of which renders its own backbuffer pass. Now: one shared reflective glass material
        across all panes (visually equivalent at this distance, ~8 render passes cheaper) plus
        real aluminium mullions between them. The mullion grid is what actually makes glazing
        read as a curtain wall rather than a blue rectangle.
      */}
      <group position={[0, 3.75, 18]}>
        {Array.from({ length: 8 }, (_, index) => (
          <mesh key={index} position={[-7.7 + index * 2.2, 0, 0]} material={M.glass}>
            <boxGeometry args={[2.06, 3.5, 0.04]} />
          </mesh>
        ))}
        {/* Vertical mullions on the structural grid. */}
        {Array.from({ length: 9 }, (_, index) => (
          <mesh key={`m${index}`} position={[-8.8 + index * 2.2, 0, 0]} castShadow material={M.aluminium}>
            <boxGeometry args={[0.09, 3.62, 0.14]} />
          </mesh>
        ))}
        {/* Head and sill transoms. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, side * 1.79, 0]} castShadow material={M.aluminium}>
            <boxGeometry args={[17.7, 0.1, 0.14]} />
          </mesh>
        ))}
      </group>
      {/* Clerestory roof glazing — daylight into the atrium from above. */}
      <group position={[0, 5.6, 4]}>
        {[-9, -3, 3, 9].map((x) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[0.1, 0, 0]} material={M.glass}>
            <boxGeometry args={[5.4, 0.06, 12]} />
          </mesh>
        ))}
        {/* Structural ribs between the roof lights. */}
        {[-12, -6, 0, 6, 12].map((x) => (
          <mesh key={`r${x}`} position={[x, 0.06, 0]} rotation={[0.1, 0, 0]} castShadow material={M.steel}>
            <boxGeometry args={[0.16, 0.34, 12.2]} />
          </mesh>
        ))}
      </group>
      {[-18, -6, 6, 18].map((x) => <Column key={x} position={[x, 0, 15.8]} />)}
    </group>
  );
}

function Atrium({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <group>
      <RoomFloor position={[0, -0.22, 8]} size={[8.8, 10]} color="#d7c5ab" selected={selected} onClick={onSelect} />
      <group position={[0, 0, 9]}>
        <RoundedBox args={[5.8, 1.05, 1.2]} radius={0.08} smoothness={4} position={[0, 0.52, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#9b573f" roughness={0.45} />
        </RoundedBox>
        <mesh position={[0, 1.33, 0.35]}>
          <boxGeometry args={[4.1, 1.25, 0.08]} />
          <meshStandardMaterial color="#f3eee5" roughness={0.9} />
        </mesh>
        <SignTexture text="WELCOME TO ARIA" subtext="Reception & student services" position={[0, 1.42, 0.4]} size={[3.7, 0.95]} />
      </group>
      <ScheduleBoard position={[0, 0, 4.2]} />
      <IndoorPlant position={[-3.6, 0, 11.2]} />
      <IndoorPlant position={[3.6, 0, 11.2]} />
      {selected && <SelectedMarker position={[0, 0.03, 8]} color="#c84f40" />}
    </group>
  );
}

function Classroom({ room, selected, quiet, onSelect, onOpenBoard }: { room: CampusRoom; selected: boolean; quiet: boolean; onSelect: () => void; onOpenBoard: () => void }) {
  const center = new THREE.Vector3(...room.position);
  const northRoom = center.z > 0;
  const boardZ = northRoom ? center.z - 4.45 : center.z - 4.7;
  const seatsStartZ = boardZ + 2.1;
  const lightColor = room.id === "sensory" ? "#dfd7ef" : room.id === "focus" ? "#e5eadb" : "#fff2d7";
  return (
    <group>
      <RoomFloor position={[center.x, -0.2, center.z]} size={[8.8, 9.8]} color={selected ? room.accent : "#c9c4b9"} selected={selected} onClick={onSelect} />
      <Wall position={[center.x - 4.35, 1.65, center.z]} scale={[0.18, 3.4, 9.8]} color="#eee8de" />
      <Wall position={[center.x + 4.35, 1.65, center.z]} scale={[0.18, 3.4, 9.8]} color="#eee8de" />
      <Wall position={[center.x, 1.65, boardZ - 0.28]} scale={[8.8, 3.4, 0.18]} color="#e6e1d8" />
      <Smartboard
        room={room}
        position={[center.x, 2.15, boardZ]}
        selected={selected}
        onClick={() => {
          onSelect();
          onOpenBoard();
        }}
      />
      <mesh position={[center.x, 4.45, center.z]}>
        <boxGeometry args={[4.8, 0.08, 3.8]} />
        <meshStandardMaterial color={lightColor} emissive={lightColor} emissiveIntensity={quiet ? 0.35 : 0.7} />
      </mesh>
      {Array.from({ length: room.id === "sensory" ? 2 : 3 }, (_, row) =>
        Array.from({ length: room.id === "sensory" ? 3 : 4 }, (__, col) => {
          const width = room.id === "sensory" ? 2.35 : 1.85;
          return (
            <StudentDesk
              key={`${row}-${col}`}
              position={[center.x + (col - (room.id === "sensory" ? 1 : 1.5)) * width, 0, seatsStartZ + row * 1.65]}
              accent={room.accent}
            />
          );
        }),
      )}
      <TeacherDesk position={[center.x + 2.75, 0, boardZ + 0.9]} accent={room.accent} />
      <RoomFeature room={room} boardZ={boardZ} />
      <RoomSign room={room} position={[center.x, 2.4, center.z + 4.35]} />
      {selected && <SelectedMarker position={[center.x, 0.04, center.z]} color={room.accent} />}
    </group>
  );
}

function Smartboard({ room, position, selected, onClick }: { room: CampusRoom; position: [number, number, number]; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <group position={position}>
      <RoundedBox args={[6.65, 3.15, 0.18]} radius={0.1} smoothness={4} castShadow onClick={(event) => { event.stopPropagation(); onClick(); }} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
        <meshStandardMaterial color="#202624" metalness={0.52} roughness={0.22} emissive={selected || hovered ? room.accent : "#000000"} emissiveIntensity={0.16} />
      </RoundedBox>
      <mesh position={[0, 0, 0.105]} onClick={onClick}>
        <planeGeometry args={[6.2, 2.72]} />
        <meshPhysicalMaterial color="#e8f1ef" emissive="#c6e7e3" emissiveIntensity={0.28} roughness={0.26} clearcoat={0.65} />
      </mesh>
      <BoardContent room={room} position={[0, 0, 0.115]} />
      {(selected || hovered) && (
        <Html position={[0, -1.95, 0]} center distanceFactor={7} zIndexRange={[20, 0]}>
          <button className="world-action" onClick={onClick}>Open Live Tutor board</button>
        </Html>
      )}
    </group>
  );
}

function BoardContent({ room, position }: { room: CampusRoom; position: [number, number, number] }) {
  const texture = useTextTexture("LIVE CLASSROOM", room.shortName, room.accent, 1024, 448);
  return (
    <mesh position={position}>
      <planeGeometry args={[5.95, 2.5]} />
      <meshBasicMaterial map={texture} transparent />
    </mesh>
  );
}

function RoomFeature({ room, boardZ }: { room: CampusRoom; boardZ: number }) {
  if (room.id === "vision") {
    return (
      <group position={[room.position[0] - 3.65, 0, room.position[2]]}>
        {[0, 1.2, 2.4, 3.6].map((z) => <mesh key={z} position={[0, -0.13, z - 1.8]}><boxGeometry args={[0.36, 0.06, 0.7]} /><meshStandardMaterial color="#f2c94c" /></mesh>)}
      </group>
    );
  }
  if (room.id === "focus") {
    return <VisualTimer position={[room.position[0] - 3.7, 1.8, boardZ + 0.2]} />;
  }
  if (room.id === "sensory") {
    return (
      <group position={[room.position[0] - 3.4, 0, room.position[2] + 3.1]}>
        <RoundedBox args={[1.7, 1.25, 1.55]} radius={0.22} smoothness={4} position={[0, 0.62, 0]}>
          <meshStandardMaterial color="#8f8096" roughness={0.85} />
        </RoundedBox>
      </group>
    );
  }
  if (room.id === "communication") {
    return <CaptionRail position={[room.position[0], 3.05, boardZ + 0.32]} />;
  }
  return <IndoorPlant position={[room.position[0] - 3.65, 0, boardZ + 0.8]} scale={0.65} />;
}

function Commons({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <group>
      <RoomFloor position={[18, -0.2, 8]} size={[11.5, 10]} color="#b8aaa0" selected={selected} onClick={onSelect} />
      {[[16, 6], [20, 6], [16, 10], [20, 10]].map(([x, z]) => <CafeTable key={`${x}-${z}`} position={[x, 0, z]} />)}
      <group position={[22.2, 0, 12]}><IndoorPlant position={[0, 0, 0]} /><IndoorPlant position={[-1.5, 0, 0.4]} scale={0.7} /></group>
      <RoomSign room={CAMPUS_ROOMS.find((room) => room.id === "commons")!} position={[18, 2.6, 3.5]} />
      {selected && <SelectedMarker position={[18, 0.04, 8]} color="#c55d34" />}
    </group>
  );
}

function Library({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <group>
      <RoomFloor position={[-18, -0.2, 8]} size={[11.5, 10]} color="#8a725f" selected={selected} onClick={onSelect} />
      {[-21.8, -18.5, -15.2].map((x) => <Bookshelf key={x} position={[x, 0, 4.1]} />)}
      <StudyTable position={[-18, 0, 8.8]} />
      <StudyTable position={[-18, 0, 12]} />
      <RoomSign room={CAMPUS_ROOMS.find((room) => room.id === "library")!} position={[-18, 2.6, 3.5]} />
      {selected && <SelectedMarker position={[-18, 0.04, 8]} color="#6a4f3a" />}
    </group>
  );
}

function WellnessRoom({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <group>
      <RoomFloor position={[18, -0.2, -5]} size={[11.5, 9.8]} color="#9db9aa" selected={selected} onClick={onSelect} />
      <Wall position={[18, 1.55, -9.7]} scale={[11.5, 3.2, 0.18]} color="#dce8e2" />
      <RoundedBox args={[3.2, 0.8, 1.7]} radius={0.24} smoothness={4} position={[17.5, 0.4, -5.5]} castShadow>
        <meshStandardMaterial color="#547968" roughness={0.85} />
      </RoundedBox>
      <IndoorPlant position={[21.5, 0, -7.5]} />
      <IndoorPlant position={[14.8, 0, -7]} scale={0.8} />
      <RoomSign room={CAMPUS_ROOMS.find((room) => room.id === "wellness")!} position={[18, 2.4, -9.55]} />
      {selected && <SelectedMarker position={[18, 0.04, -5]} color="#477c69" />}
    </group>
  );
}

function Wayfinding() {
  return (
    <group>
      <mesh position={[0, -0.14, 1.5]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[45, 1.15]} /><meshStandardMaterial color="#5c7775" roughness={0.8} /></mesh>
      <mesh position={[0, -0.13, 14.8]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[45, 0.26]} /><meshStandardMaterial color="#d2a838" /></mesh>
      {[-5, 5].map((z) => <mesh key={z} position={[0, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.5, 0.7, 32]} /><meshBasicMaterial color="#fff8e8" /></mesh>)}
    </group>
  );
}

function HumanAvatar({ person, reducedMotion }: { person: CampusPerson; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const seed = useMemo(() => person.id.length * 0.83, [person.id]);
  const avatarUrl = person.id === "teacher" ? "/models/michelle.glb" : "/models/student-avatar.glb";
  const { scene, animations } = useGLTF(avatarUrl);
  const avatar = useMemo(() => {
    const model = cloneSkeleton(scene);
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
      if (person.id !== "teacher" && child instanceof THREE.Bone) {
        if (child.name === "LeftArm") child.rotation.z -= 1.02;
        if (child.name === "RightArm") child.rotation.z += 1.02;
      }
    });
    return model;
  }, [person.id, scene]);
  const { actions, names } = useAnimations(animations, group);

  useEffect(() => {
    const preferred = names.find((name) => /idle/i.test(name)) ?? names[0];
    if (!preferred || reducedMotion) return;
    const action = actions[preferred];
    action?.reset().fadeIn(0.25).play();
    if (action) action.time = seed % Math.max(action.getClip().duration, 1);
    return () => { action?.fadeOut(0.2); };
  }, [actions, names, reducedMotion, seed]);

  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return;
    const time = clock.elapsedTime + seed;
    group.current.position.y = person.position[1] + Math.sin(time * 1.2) * 0.012;
    if (person.activity === "talk" || person.activity === "teach") {
      group.current.rotation.y = Math.sin(time * 0.45) * 0.12;
    }
  });

  const scale = person.id === "teacher" ? 0.93 : 1;
  return (
    <group ref={group} position={person.position} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <primitive object={avatar} scale={scale} />
      {hovered && (
        <Html position={[0, 2.25, 0]} center distanceFactor={8} zIndexRange={[15, 0]}>
          <div className="world-person-label"><strong>{person.name}</strong><span>{person.role} · {person.status}</span></div>
        </Html>
      )}
    </group>
  );
}

useGLTF.preload("/models/michelle.glb");
useGLTF.preload("/models/student-avatar.glb");

function StudentDesk({ position, accent }: { position: [number, number, number]; accent: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow><boxGeometry args={[1.25, 0.09, 0.62]} /><meshStandardMaterial color="#a77b54" roughness={0.58} /></mesh>
      {[-0.48, 0.48].map((x) => <mesh key={x} position={[x, 0.38, 0]} castShadow><boxGeometry args={[0.055, 0.75, 0.055]} /><meshStandardMaterial color="#465251" metalness={0.6} roughness={0.32} /></mesh>)}
      <mesh position={[0, 0.48, 0.58]} castShadow><boxGeometry args={[0.78, 0.72, 0.1]} /><meshStandardMaterial color={accent} roughness={0.78} /></mesh>
      <mesh position={[0, 0.18, 0.46]} castShadow><boxGeometry args={[0.76, 0.1, 0.55]} /><meshStandardMaterial color={accent} roughness={0.78} /></mesh>
    </group>
  );
}

function TeacherDesk({ position, accent }: { position: [number, number, number]; accent: string }) {
  return <group position={position}><RoundedBox args={[1.8, 0.78, 0.7]} radius={0.08} smoothness={4} position={[0, 0.39, 0]} castShadow><meshStandardMaterial color="#d2c4b0" roughness={0.6} /></RoundedBox><mesh position={[0, 0.82, 0]}><boxGeometry args={[0.7, 0.04, 0.32]} /><meshStandardMaterial color={accent} /></mesh></group>;
}

function CafeTable({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh position={[0, 0.72, 0]} castShadow><cylinderGeometry args={[0.72, 0.72, 0.09, 32]} /><meshStandardMaterial color="#b47e53" roughness={0.56} /></mesh><mesh position={[0, 0.36, 0]} castShadow><cylinderGeometry args={[0.08, 0.13, 0.72, 16]} /><meshStandardMaterial color="#343f3d" metalness={0.6} /></mesh>{[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((angle) => <mesh key={angle} position={[Math.cos(angle) * 1.1, 0.36, Math.sin(angle) * 1.1]} castShadow><cylinderGeometry args={[0.27, 0.3, 0.48, 24]} /><meshStandardMaterial color={angle % Math.PI === 0 ? "#8f4d3d" : "#416c6a"} roughness={0.75} /></mesh>)}</group>;
}

function StudyTable({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh position={[0, 0.73, 0]} castShadow><boxGeometry args={[4.2, 0.1, 1.25]} /><meshStandardMaterial color="#b58a62" roughness={0.62} /></mesh>{[-1.7, 1.7].map((x) => <mesh key={x} position={[x, 0.35, 0]}><boxGeometry args={[0.09, 0.7, 1]} /><meshStandardMaterial color="#384745" metalness={0.5} /></mesh>)}</group>;
}

function Bookshelf({ position }: { position: [number, number, number] }) {
  const colors = ["#a44f42", "#476b72", "#d1a441", "#68805c", "#6d4b62"];
  return <group position={position}><mesh position={[0, 1.3, 0]} castShadow><boxGeometry args={[2.6, 2.6, 0.5]} /><meshStandardMaterial color="#624b38" roughness={0.82} /></mesh>{[0.45, 1.2, 1.95].map((y, row) => Array.from({ length: 9 }, (_, index) => <mesh key={`${row}-${index}`} position={[-1.05 + index * 0.26, y, 0.3]}><boxGeometry args={[0.18, 0.52 + (index % 2) * 0.08, 0.25]} /><meshStandardMaterial color={colors[(index + row) % colors.length]} roughness={0.9} /></mesh>))}</group>;
}

function IndoorPlant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return <group position={position} scale={scale}><mesh position={[0, 0.32, 0]} castShadow><cylinderGeometry args={[0.33, 0.26, 0.64, 20]} /><meshStandardMaterial color="#a56947" roughness={0.84} /></mesh>{Array.from({ length: 7 }, (_, index) => { const angle = (index / 7) * Math.PI * 2; return <mesh key={index} position={[Math.cos(angle) * 0.22, 0.82 + (index % 2) * 0.18, Math.sin(angle) * 0.22]} rotation={[0.25, angle, Math.sin(angle) * 0.55]} castShadow><sphereGeometry args={[0.22, 12, 12]} /><meshStandardMaterial color={index % 2 ? "#47745b" : "#5b876a"} roughness={0.95} /></mesh>; })}</group>;
}

function Tree({ position, scale }: { position: [number, number, number]; scale: number }) {
  return <group position={position} scale={scale}><mesh position={[0, 1.5, 0]} castShadow><cylinderGeometry args={[0.18, 0.28, 3, 12]} /><meshStandardMaterial color="#65503a" roughness={1} /></mesh><mesh position={[0, 3.4, 0]} castShadow><icosahedronGeometry args={[1.35, 2]} /><meshStandardMaterial color="#3e6849" roughness={1} /></mesh></group>;
}

function Column({ position }: { position: [number, number, number] }) {
  return <mesh position={[position[0], 2.2, position[2]]} castShadow receiveShadow material={M.plaster}><cylinderGeometry args={[0.24, 0.3, 4.6, 20]} /></mesh>;
}

/**
 * A wall with a base reveal — the ~90mm recessed shadow gap where wall meets floor that is
 * standard in modern architectural detailing. It costs one extra thin box and does more for
 * perceived realism than any texture: it gives the wall a visible thickness and catches a dark
 * line of self-shadow, so the wall reads as a built element rather than a floating plane.
 */
function Wall({ position, scale }: { position: [number, number, number]; scale: [number, number, number]; color?: string }) {
  const [w, h, d] = scale;
  const horizontal = w >= d;
  return (
    <group position={position}>
      <mesh castShadow receiveShadow material={M.plaster} position={[0, 0.05, 0]}>
        <boxGeometry args={[w, h - 0.1, d]} />
      </mesh>
      {/* Recessed skirting reveal, inset on both faces. */}
      <mesh receiveShadow material={M.concreteRaw} position={[0, -h / 2 + 0.045, 0]}>
        <boxGeometry args={horizontal ? [w, 0.09, d * 0.72] : [w * 0.72, 0.09, d]} />
      </mesh>
    </group>
  );
}

/**
 * Room floor. Selection is signalled by a warmer, more reflective finish rather than a colour
 * wash — colour alone must never carry meaning (accessibility), and the `SelectedMarker` ring
 * provides the redundant non-colour cue.
 */
function RoomFloor({ position, size, color, selected, onClick }: { position: [number, number, number]; size: [number, number]; color: string; selected: boolean; onClick: () => void }) {
  return (
    <mesh
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      onClick={(event) => { event.stopPropagation(); onClick(); }}
    >
      <planeGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={selected ? 0.3 : 0.42}
        metalness={0}
        envMapIntensity={selected ? 1.25 : 1.0}
      />
    </mesh>
  );
}

function RoomSign({ room, position }: { room: CampusRoom; position: [number, number, number] }) {
  return <group position={position}><mesh><boxGeometry args={[3.5, 0.72, 0.1]} /><meshStandardMaterial color={room.accent} roughness={0.5} /></mesh><SignTexture text={room.shortName.toUpperCase()} subtext={room.subject} position={[0, 0, 0.06]} size={[3.25, 0.56]} dark /></group>;
}

function ScheduleBoard({ position }: { position: [number, number, number] }) {
  return <group position={position}><RoundedBox args={[4.6, 2.8, 0.18]} radius={0.08} smoothness={4} position={[0, 1.55, 0]} castShadow><meshStandardMaterial color="#243331" metalness={0.42} roughness={0.3} /></RoundedBox><SignTexture text="TODAY AT ARIA" subtext="10:30 Calculus  ·  11:00 Study Lab  ·  12:30 Literature" position={[0, 1.55, 0.1]} size={[4.2, 2.35]} dark /></group>;
}

function VisualTimer({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh><cylinderGeometry args={[0.42, 0.42, 0.12, 32]} /><meshStandardMaterial color="#f5f0e6" /></mesh><mesh position={[0, 0, 0.07]}><circleGeometry args={[0.31, 32, 0, Math.PI * 1.35]} /><meshBasicMaterial color="#d5a332" /></mesh></group>;
}

function CaptionRail({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh><boxGeometry args={[5.4, 0.34, 0.08]} /><meshStandardMaterial color="#202927" emissive="#202927" emissiveIntensity={0.25} /></mesh><SignTexture text="CAPTIONS READY" subtext="Visual speaker cues enabled" position={[0, 0, 0.05]} size={[5.1, 0.26]} dark /></group>;
}

function SelectedMarker({ position, color }: { position: [number, number, number]; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.z = clock.elapsedTime * 0.2; });
  return <mesh ref={ref} position={position} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.05, 1.15, 64]} /><meshBasicMaterial color={color} transparent opacity={0.78} depthWrite={false} /></mesh>;
}

function SignTexture({ text, subtext, position, size, dark = false }: { text: string; subtext: string; position: [number, number, number]; size: [number, number]; dark?: boolean }) {
  const texture = useTextTexture(text, subtext, dark ? "#ffffff" : "#1d2c2a", 1024, 320, dark);
  return <mesh position={position}><planeGeometry args={size} /><meshBasicMaterial map={texture} transparent /></mesh>;
}

function useTextTexture(title: string, subtitle: string, accent: string, width: number, height: number, dark = false) {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, width, height);
    if (!dark) {
      context.fillStyle = "rgba(236, 246, 243, 0.96)";
      context.fillRect(0, 0, width, height);
      context.fillStyle = accent;
      context.fillRect(0, 0, 16, height);
    }
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = dark ? "#ffffff" : "#18302d";
    context.font = `700 ${Math.round(height * 0.18)}px Arial`;
    context.fillText(title, width / 2, height * 0.39, width * 0.88);
    context.fillStyle = dark ? "#d8e3df" : "#47605d";
    context.font = `500 ${Math.round(height * 0.095)}px Arial`;
    context.fillText(subtitle, width / 2, height * 0.66, width * 0.88);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }, [title, subtitle, accent, width, height, dark]);
}
