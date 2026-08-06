import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ROOMS, boardPlacement } from "./floorplan";

/**
 * Ambient campus population — scripted teachers and students that make the building feel
 * inhabited between real (networked) visitors.
 *
 * These are deliberately NOT the multiplayer peers (net/RemoteAvatars.tsx renders those). They
 * are set dressing with routines: a teacher stands at each taught board and gestures through an
 * explanation, seated students occupy the auditorium and meditation room, and a couple of
 * walkers commute the corridor loop. All of it is pose-level animation on the shared Mixamo rig
 * — no baked clips — which keeps every routine parameterised and reactive (the teacher turns to
 * face someone who walks close, which a baked idle loop cannot do).
 *
 * Hidden entirely in quiet mode: unpredictable background motion is precisely what
 * sensory-sensitive users asked to remove, and the real humans remain visible.
 */

type Bones = Record<string, { bone: THREE.Bone; base: THREE.Euler }>;

function useRiggedClone(url: string, tint?: string) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const model = cloneSkeleton(scene);
    const bones: Bones = {};
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (tint && child.material) {
          const material = (child.material as THREE.MeshStandardMaterial).clone();
          material.color = new THREE.Color(tint).lerp(new THREE.Color("#ffffff"), 0.6);
          material.envMapIntensity = 0.8;
          child.material = material;
        }
      }
      if (child instanceof THREE.Bone) bones[child.name] = { bone: child, base: child.rotation.clone() };
    });
    return { model, bones };
  }, [scene, tint]);
}

function setBone(bones: Bones, name: string, axis: "x" | "y" | "z", offset: number, delta: number, rate = 10) {
  const entry = bones[name];
  if (!entry) return;
  entry.bone.rotation[axis] = THREE.MathUtils.damp(entry.bone.rotation[axis], entry.base[axis] + offset, rate, delta);
}

/**
 * A teacher at a board: relaxed stance facing the seats, a gesture cycle that turns toward the
 * board and raises an arm to it (the "as you can see here" move), and head tracking that greets
 * anyone who walks up close. Phase-offset per instance so two teachers never move in sync.
 */
export function TeacherNpc({
  position,
  facing,
  boardFacing,
  playerPosition,
  reducedMotion,
  seed = 0,
}: {
  position: [number, number, number];
  /** Yaw when addressing the class. */
  facing: number;
  /** Yaw when turned to the board. */
  boardFacing: number;
  playerPosition: THREE.Vector3 | null;
  reducedMotion: boolean;
  seed?: number;
}) {
  const { model, bones } = useRiggedClone("/models/michelle.glb");
  const root = useRef<THREE.Group>(null);
  const clock = useRef(seed * 3.7);

  useFrame((_, delta) => {
    if (!root.current || reducedMotion) return;
    clock.current += delta;
    const t = clock.current;

    // 12-second routine: 0-7s address the class, 7-10.5s turn to the board and point, then back.
    const cycle = t % 12;
    const gesturing = cycle > 7 && cycle < 10.5;
    const gestureRamp = gesturing ? Math.min(1, (cycle - 7) / 0.7) * Math.min(1, (10.5 - cycle) / 0.7) : 0;

    // Head: track a nearby visitor, otherwise sweep slowly across the (imagined) seats.
    let headYaw = Math.sin(t * 0.35) * 0.4;
    if (playerPosition) {
      const dx = playerPosition.x - position[0];
      const dz = playerPosition.z - position[2];
      if (Math.hypot(dx, dz) < 5.5) {
        headYaw = THREE.MathUtils.clamp(Math.atan2(dx, dz) - root.current.rotation.y, -0.85, 0.85);
      }
    }

    const targetYaw = facing + (boardFacing - facing) * gestureRamp * 0.75;
    root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, targetYaw, 4, delta);

    // Idle breathing + weight shift.
    const breathe = Math.sin(t * 1.6) * 0.02;
    setBone(bones, "Spine", "z", breathe + Math.sin(t * 0.5) * 0.03, delta, 6);
    setBone(bones, "Head", "y", headYaw, delta, 6);
    setBone(bones, "Head", "x", Math.sin(t * 0.9) * 0.03, delta, 6);
    // Arms: relaxed by default; right arm rises toward the board during the gesture.
    setBone(bones, "LeftArm", "z", -1.12 + breathe, delta, 8);
    setBone(bones, "RightArm", "z", 1.12 - gestureRamp * 1.5, delta, 8);
    setBone(bones, "RightArm", "x", -gestureRamp * 0.5, delta, 8);
    setBone(bones, "RightForeArm", "x", -0.1 - gestureRamp * 0.25, delta, 8);
    setBone(bones, "LeftForeArm", "x", -0.1, delta, 8);
  });

  return (
    <group ref={root} position={position} rotation={[0, facing, 0]}>
      <primitive object={model} />
    </group>
  );
}

/** A student posed seated — auditorium benches, meditation cushions. */
export function SeatedNpc({
  position,
  rotation,
  tint,
  crossLegged = false,
  reducedMotion,
  seed = 0,
}: {
  position: [number, number, number];
  rotation: number;
  tint?: string;
  crossLegged?: boolean;
  reducedMotion: boolean;
  seed?: number;
}) {
  const { model, bones } = useRiggedClone("/models/student-avatar.glb", tint);
  const clock = useRef(seed * 5.1);

  useFrame((_, delta) => {
    clock.current += delta;
    const t = clock.current;
    const idle = reducedMotion ? 0 : Math.sin(t * 1.4) * 0.018;
    // Seated pose: hips and knees bent; cross-legged tucks the calves under instead.
    setBone(bones, "LeftUpLeg", "x", crossLegged ? -1.1 : -1.5, delta, 14);
    setBone(bones, "RightUpLeg", "x", crossLegged ? -1.1 : -1.5, delta, 14);
    setBone(bones, "LeftUpLeg", "z", crossLegged ? 0.7 : 0.06, delta, 14);
    setBone(bones, "RightUpLeg", "z", crossLegged ? -0.7 : -0.06, delta, 14);
    setBone(bones, "LeftLeg", "x", crossLegged ? 2.1 : 1.45, delta, 14);
    setBone(bones, "RightLeg", "x", crossLegged ? 2.1 : 1.45, delta, 14);
    setBone(bones, "LeftArm", "z", -1.16, delta, 10);
    setBone(bones, "RightArm", "z", 1.16, delta, 10);
    setBone(bones, "LeftForeArm", "x", -0.35, delta, 10);
    setBone(bones, "RightForeArm", "x", -0.35, delta, 10);
    setBone(bones, "Spine", "z", idle, delta, 6);
    setBone(bones, "Head", "y", reducedMotion ? 0 : Math.sin(t * 0.4 + seed) * 0.22, delta, 5);
  });

  const height = crossLegged ? -0.62 : -0.42;
  return (
    <group position={[position[0], position[1] + height + 0.89, position[2]]} rotation={[0, rotation, 0]}>
      <primitive object={model} />
    </group>
  );
}

/** A student walking a waypoint loop — the corridor commuters. */
export function WalkerNpc({
  waypoints,
  speed = 1.1,
  tint,
  reducedMotion,
  seed = 0,
}: {
  waypoints: Array<[number, number]>;
  speed?: number;
  tint?: string;
  reducedMotion: boolean;
  seed?: number;
}) {
  const { model, bones } = useRiggedClone("/models/student-avatar.glb", tint);
  const root = useRef<THREE.Group>(null);
  const progress = useRef(seed * 7.3);
  const phase = useRef(seed * 2.2);

  // Precompute segment lengths so speed is constant in metres/second, not per-segment.
  const segments = useMemo(() => {
    const list: Array<{ from: THREE.Vector2; to: THREE.Vector2; length: number; start: number }> = [];
    let total = 0;
    for (let i = 0; i < waypoints.length; i++) {
      const from = new THREE.Vector2(...waypoints[i]);
      const to = new THREE.Vector2(...waypoints[(i + 1) % waypoints.length]);
      const length = from.distanceTo(to);
      list.push({ from, to, length, start: total });
      total += length;
    }
    return { list, total };
  }, [waypoints]);

  useFrame((_, delta) => {
    if (!root.current) return;
    progress.current = (progress.current + delta * speed) % segments.total;
    const segment = segments.list.find(
      (candidate) => progress.current >= candidate.start && progress.current < candidate.start + candidate.length,
    ) ?? segments.list[0];
    const local = (progress.current - segment.start) / segment.length;
    const x = THREE.MathUtils.lerp(segment.from.x, segment.to.x, local);
    const z = THREE.MathUtils.lerp(segment.from.y, segment.to.y, local);
    root.current.position.set(x, 0.89, z);
    const heading = Math.atan2(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, heading, 6, delta);

    if (reducedMotion) return;
    phase.current += delta * 6.4 * speed;
    const stride = Math.sin(phase.current) * 0.46;
    setBone(bones, "LeftArm", "x", -stride * 0.7, delta, 16);
    setBone(bones, "RightArm", "x", stride * 0.7, delta, 16);
    setBone(bones, "LeftArm", "z", -1.05, delta, 10);
    setBone(bones, "RightArm", "z", 1.05, delta, 10);
    setBone(bones, "LeftUpLeg", "x", stride * 0.68, delta, 16);
    setBone(bones, "RightUpLeg", "x", -stride * 0.68, delta, 16);
    setBone(bones, "LeftLeg", "x", Math.max(0, -stride) * 0.58, delta, 16);
    setBone(bones, "RightLeg", "x", Math.max(0, stride) * 0.58, delta, 16);
    root.current.position.y = 0.89 + Math.abs(Math.sin(phase.current)) * 0.035;
  });

  return (
    <group ref={root} rotation={[0, Math.PI, 0]}>
      <primitive object={model} />
    </group>
  );
}

/** The whole ambient cast, placed from the floorplan so it survives layout changes. */
export function CampusNpcs({
  playerPosition,
  reducedMotion,
  quiet,
}: {
  playerPosition: THREE.Vector3 | null;
  reducedMotion: boolean;
  quiet: boolean;
}) {
  const teachers = useMemo(() => {
    return ["general", "vision", "innovation"].flatMap((id, index) => {
      const shell = ROOMS.find((room) => room.id === id);
      const board = shell ? boardPlacement(shell) : null;
      if (!shell || !board) return [];
      // Stand beside the board, facing back into the room.
      const facing = board.rotation + Math.PI;
      const inward = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
      return [{
        id,
        seed: index + 1,
        position: [
          board.position[0] + inward.x * 1.1 + Math.cos(facing) * 0.9,
          0.89,
          board.position[2] + inward.z * 1.1 - Math.sin(facing) * 0.9,
        ] as [number, number, number],
        facing,
        boardFacing: board.rotation,
      }];
    });
  }, []);

  const auditoriumSeats = useMemo(() => {
    const shell = ROOMS.find((room) => room.id === "auditorium");
    if (!shell) return [];
    const [cx, cz] = shell.center;
    const d = shell.size[1];
    // A scattering across the tiers, not a full house — a half-empty hall reads as more
    // believable between events than a packed one.
    return [
      { x: cx - 4.8, tier: 1, seed: 1 },
      { x: cx + 2.4, tier: 1, seed: 2 },
      { x: cx - 2.4, tier: 2, seed: 3 },
      { x: cx + 7.2, tier: 3, seed: 4 },
    ].map((seat) => ({
      position: [seat.x, seat.tier * 0.32 + 0.45, cz - d / 2 + 6.4 + seat.tier * 2.2] as [number, number, number],
      seed: seat.seed,
    }));
  }, []);

  const meditators = useMemo(() => {
    const shell = ROOMS.find((room) => room.id === "meditation");
    if (!shell) return [];
    const [cx, cz] = shell.center;
    return [0, 2].map((index) => {
      const angle = (index / 6) * Math.PI * 2;
      return {
        position: [cx + Math.cos(angle) * 1.5, 0.17, cz + Math.sin(angle) * 1.5] as [number, number, number],
        rotation: Math.atan2(cx - (cx + Math.cos(angle) * 1.5), cz - (cz + Math.sin(angle) * 1.5)),
        seed: index + 5,
      };
    });
  }, []);

  if (quiet) return null;

  return (
    <group>
      {teachers.map((teacher) => (
        <TeacherNpc
          key={teacher.id}
          position={teacher.position}
          facing={teacher.facing}
          boardFacing={teacher.boardFacing}
          playerPosition={playerPosition}
          reducedMotion={reducedMotion}
          seed={teacher.seed}
        />
      ))}
      {auditoriumSeats.map((seat, index) => (
        <SeatedNpc
          key={`aud-${index}`}
          position={seat.position}
          rotation={Math.PI}
          tint={["#0072b2", "#d55e00", "#009e73", "#cc79a7"][index % 4]}
          reducedMotion={reducedMotion}
          seed={seat.seed}
        />
      ))}
      {meditators.map((seat, index) => (
        <SeatedNpc
          key={`med-${index}`}
          position={seat.position}
          rotation={seat.rotation}
          crossLegged
          reducedMotion={reducedMotion}
          seed={seat.seed}
        />
      ))}
      {/* Corridor commuters — the campus's circulatory system made visible. */}
      <WalkerNpc
        waypoints={[[0.9, 4], [0.9, -26], [-0.9, -26], [-0.9, 4]]}
        speed={1.05}
        tint="#56b4e9"
        reducedMotion={reducedMotion}
        seed={1}
      />
      <WalkerNpc
        waypoints={[[-4, 24.5], [5, 24.5], [5, 27.5], [-4, 27.5]]}
        speed={0.85}
        tint="#e69f00"
        reducedMotion={reducedMotion}
        seed={2}
      />
    </group>
  );
}

useGLTF.preload("/models/michelle.glb");
