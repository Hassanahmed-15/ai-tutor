import { useGLTF, useKeyboardControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CAMPUS_ROOMS } from "./campus";
import { ROOMS, boardPlacement } from "./scene/floorplan";
import type { AccessibilityProfile, CampusRoom } from "./types";

export type PlayerControl = "forward" | "back" | "left" | "right" | "run" | "jump" | "interact";

export const PLAYER_CONTROL_MAP = [
  { name: "forward" as const, keys: ["KeyW", "ArrowUp"] },
  { name: "back" as const, keys: ["KeyS", "ArrowDown"] },
  { name: "left" as const, keys: ["KeyA", "ArrowLeft"] },
  { name: "right" as const, keys: ["KeyD", "ArrowRight"] },
  { name: "run" as const, keys: ["ShiftLeft", "ShiftRight"] },
  { name: "jump" as const, keys: ["Space"] },
  { name: "interact" as const, keys: ["KeyE"] },
];

export type TouchInput = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  interactNonce: number;
};

export type TeleportRequest = {
  id: number;
  position: [number, number, number];
};

type PlayerProps = {
  profile: AccessibilityProfile;
  touch: TouchInput;
  teleport: TeleportRequest;
  paused: boolean;
  onRoomChange: (room: CampusRoom) => void;
  onBoardProximity: (room: CampusRoom | null) => void;
  onInteract: (room: CampusRoom) => void;
  onPlayerUpdate: (position: [number, number, number], state: "idle" | "walking" | "running", rotation: number) => void;
  /** Seat id when the player is sitting; movement is frozen and the camera drops to seated eye
   *  height. Null when standing. */
  seated?: string | null;
};

const PLAYER_HEIGHT = 1.78;
const WALK_SPEED = 3.4;
const RUN_SPEED = 6.2;

export function PlayerController({ profile, touch, teleport, paused, onRoomChange, onBoardProximity, onInteract, onPlayerUpdate, seated = null }: PlayerProps) {
  const body = useRef<RapierRigidBody>(null);
  const modelRoot = useRef<THREE.Group>(null);
  const [, getKeyboard] = useKeyboardControls<PlayerControl>();
  const { camera, gl } = useThree();
  const { scene } = useGLTF("/models/student-avatar.glb");
  const model = useMemo(() => {
    const cloned = cloneSkeleton(scene);
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return cloned;
  }, [scene]);
  const animatedBones = useMemo(() => {
    const bones: Record<string, { bone: THREE.Bone; base: THREE.Euler }> = {};
    model.traverse((child) => {
      if (child instanceof THREE.Bone) bones[child.name] = { bone: child, base: child.rotation.clone() };
    });
    return bones;
  }, [model]);
  const walkPhase = useRef(0);
  const cameraYaw = useRef(0);
  const cameraPitch = useRef(0.42);
  const cameraDistance = useRef(5.2);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const currentRoom = useRef<string>("");
  const nearbyBoard = useRef<CampusRoom | null>(null);
  const grounded = useRef(true);
  const jumpHeld = useRef(false);
  const lastPlayerUpdate = useRef(0);

  useEffect(() => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    if (paused) {
      const velocity = rigidBody.linvel();
      rigidBody.setLinvel({ x: 0, y: velocity.y, z: 0 }, true);
      return;
    }
    rigidBody.setTranslation({ x: teleport.position[0], y: teleport.position[1], z: teleport.position[2] }, true);
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    cameraYaw.current = 0;
  }, [camera, teleport]);

  useEffect(() => {
    const canvas = gl.domElement;
    const pointerDown = (event: PointerEvent) => {
      dragging.current = true;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture?.(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      const dx = event.clientX - lastPointer.current.x;
      const dy = event.clientY - lastPointer.current.y;
      cameraYaw.current -= dx * 0.006;
      cameraPitch.current = THREE.MathUtils.clamp(cameraPitch.current + dy * 0.004, 0.18, 0.9);
      lastPointer.current = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      dragging.current = false;
      canvas.releasePointerCapture?.(event.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      cameraDistance.current = THREE.MathUtils.clamp(cameraDistance.current + event.deltaY * 0.004, 3.2, 7.4);
    };
    const contextMenu = (event: Event) => event.preventDefault();
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: true });
    canvas.addEventListener("contextmenu", contextMenu);
    return () => {
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", contextMenu);
    };
  }, [gl]);

  useEffect(() => {
    if (touch.interactNonce > 0 && nearbyBoard.current) onInteract(nearbyBoard.current);
  }, [onInteract, touch.interactNonce]);

  useEffect(() => {
    const onInteractKey = (event: KeyboardEvent) => {
      if (event.code === "KeyE" && !event.repeat && nearbyBoard.current) onInteract(nearbyBoard.current);
    };
    window.addEventListener("keydown", onInteractKey);
    return () => window.removeEventListener("keydown", onInteractKey);
  }, [onInteract]);

  useFrame((_, delta) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    const keyboard = getKeyboard();
    const translation = rigidBody.translation();
    const velocity = rigidBody.linvel();
    const forwardPressed = keyboard.forward || touch.forward;
    const backPressed = keyboard.back || touch.back;
    const leftPressed = keyboard.left || touch.left;
    const rightPressed = keyboard.right || touch.right;
    const running = keyboard.run || touch.run;
    const input = new THREE.Vector2(
      (rightPressed ? 1 : 0) - (leftPressed ? 1 : 0),
      (forwardPressed ? 1 : 0) - (backPressed ? 1 : 0),
    );
    // Sitting freezes locomotion: a seated avatar that can still walk breaks the illusion
    // immediately. Standing up is an explicit action.
    if (seated) input.set(0, 0);
    const moving = input.lengthSq() > 0;
    if (moving) input.normalize();

    const yaw = cameraYaw.current;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const direction = forward.multiplyScalar(input.y).add(right.multiplyScalar(input.x));
    if (direction.lengthSq() > 0) direction.normalize();
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const targetX = direction.x * speed;
    const targetZ = direction.z * speed;
    const responsiveness = 1 - Math.exp(-delta * 14);
    const nextX = THREE.MathUtils.lerp(velocity.x, targetX, responsiveness);
    const nextZ = THREE.MathUtils.lerp(velocity.z, targetZ, responsiveness);

    grounded.current = translation.y <= 1.03;
    const jumpPressed = keyboard.jump;
    let nextY = velocity.y;
    if (jumpPressed && !jumpHeld.current && grounded.current) nextY = 5.1;
    jumpHeld.current = jumpPressed;
    rigidBody.setLinvel({ x: nextX, y: nextY, z: nextZ }, true);

    // 0.05s (~20Hz) rather than 0.12s: this callback now also feeds multiplayer position sync and
    // the spatial-audio listener, both of which need to track the avatar closely. The network
    // layer applies its own rate limiting and change-gating on top, so this does not translate
    // into 20 messages/sec on the wire.
    lastPlayerUpdate.current += delta;
    if (lastPlayerUpdate.current >= 0.05) {
      lastPlayerUpdate.current = 0;
      onPlayerUpdate(
        [translation.x, translation.y, translation.z],
        moving ? (running ? "running" : "walking") : "idle",
        modelRoot.current?.rotation.y ?? 0,
      );
    }

    if (moving && modelRoot.current) {
      const desiredRotation = Math.atan2(direction.x, direction.z);
      modelRoot.current.rotation.y = dampAngle(modelRoot.current.rotation.y, desiredRotation, 13, delta);
    }

    animateHumanoid(animatedBones, walkPhase, moving, running, profile.reducedMotion, delta);

    const playerPosition = new THREE.Vector3(translation.x, translation.y, translation.z);
    // Seated eye height (~1.2m) rather than standing (~1.78m). Getting this right matters for
    // wheelchair users too, who experience the whole building from roughly this height.
    const eyeOffset = seated ? 0.52 : 1.05;
    const target = playerPosition.clone().add(new THREE.Vector3(0, eyeOffset, 0));
    const horizontalDistance = Math.cos(cameraPitch.current) * cameraDistance.current;
    const desiredCamera = new THREE.Vector3(
      target.x + Math.sin(yaw) * horizontalDistance,
      target.y + Math.sin(cameraPitch.current) * cameraDistance.current,
      target.z + Math.cos(yaw) * horizontalDistance,
    );
    const cameraAmount = profile.reducedMotion ? 1 : 1 - Math.exp(-delta * 9);
    camera.position.lerp(desiredCamera, cameraAmount);
    camera.lookAt(target);

    let nearestRoom = CAMPUS_ROOMS[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const room of CAMPUS_ROOMS) {
      const distance = Math.hypot(translation.x - room.position[0], translation.z - room.position[2]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestRoom = room;
      }
    }
    if (nearestRoom.id !== currentRoom.current) {
      currentRoom.current = nearestRoom.id;
      onRoomChange(nearestRoom);
    }

    // Board proximity now derives from the floorplan's actual board mounts rather than the old
    // hand-tuned per-zone offsets, so any room with a boardWall — classroom, lab, auditorium —
    // offers the "press E" prompt at the real board position.
    const shell = ROOMS.find((entry) => entry.id === nearestRoom.id);
    const mount = shell ? boardPlacement(shell) : null;
    const boardDistance = mount
      ? Math.hypot(translation.x - mount.position[0], translation.z - mount.position[2])
      : Number.POSITIVE_INFINITY;
    const nextBoard = boardDistance < 3.4 ? nearestRoom : null;
    if (nextBoard?.id !== nearbyBoard.current?.id) {
      nearbyBoard.current = nextBoard;
      onBoardProximity(nextBoard);
    }
  });

  return (
    <RigidBody
      ref={body}
      position={teleport.position}
      colliders={false}
      enabledRotations={[false, false, false]}
      linearDamping={0.4}
      angularDamping={1}
      mass={1.2}
      canSleep={false}
      ccd
    >
      <CapsuleCollider args={[0.57, 0.31]} friction={0} restitution={0} />
      <group ref={modelRoot} position={[0, -PLAYER_HEIGHT / 2 - (seated ? 0.42 : 0), 0]} rotation={[0, Math.PI, 0]}>
        <primitive object={model} scale={0.92} />
      </group>
    </RigidBody>
  );
}

function dampAngle(current: number, target: number, lambda: number, delta: number) {
  let difference = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return current + difference * (1 - Math.exp(-lambda * delta));
}

function animateHumanoid(
  bones: Record<string, { bone: THREE.Bone; base: THREE.Euler }>,
  phase: React.MutableRefObject<number>,
  moving: boolean,
  running: boolean,
  reducedMotion: boolean,
  delta: number,
) {
  if (reducedMotion) return;
  phase.current += delta * (moving ? (running ? 10.5 : 7) : 1.7);
  const stride = moving ? Math.sin(phase.current) * (running ? 0.72 : 0.48) : 0;
  const idle = moving ? 0 : Math.sin(phase.current) * 0.018;
  const setX = (name: string, offset: number) => {
    const entry = bones[name];
    if (entry) entry.bone.rotation.x = THREE.MathUtils.damp(entry.bone.rotation.x, entry.base.x + offset, 16, delta);
  };
  const setZ = (name: string, offset: number) => {
    const entry = bones[name];
    if (entry) entry.bone.rotation.z = THREE.MathUtils.damp(entry.bone.rotation.z, entry.base.z + offset, 12, delta);
  };
  setX("LeftArm", -stride * 0.75);
  setX("RightArm", stride * 0.75);
  setZ("LeftArm", -1.02);
  setZ("RightArm", 1.02);
  setX("LeftForeArm", moving ? Math.max(0, stride) * 0.28 - 0.12 : -0.08);
  setX("RightForeArm", moving ? Math.max(0, -stride) * 0.28 - 0.12 : -0.08);
  setX("LeftUpLeg", stride * 0.72);
  setX("RightUpLeg", -stride * 0.72);
  setX("LeftLeg", moving ? Math.max(0, -stride) * 0.62 : 0);
  setX("RightLeg", moving ? Math.max(0, stride) * 0.62 : 0);
  setZ("Spine", idle + (moving ? Math.sin(phase.current * 2) * 0.025 : 0));
  setZ("Head", -idle * 0.35);
}

useGLTF.preload("/models/student-avatar.glb");
