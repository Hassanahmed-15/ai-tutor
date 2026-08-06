import { useFrame } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useRef, useState } from "react";
import * as THREE from "three";
import { M } from "../materials";
import { DoorFrame } from "./Wall";

/**
 * A door that actually opens.
 *
 * Behaviour, in the order a real door works:
 *  · The leaf swings on a hinge at its edge, not about its centre — implemented with a pivot
 *    group offset by half the leaf width, which is the detail that separates a real door from a
 *    rotating rectangle.
 *  · It opens automatically when someone is close and closes behind them, like a sensor door in
 *    a modern institutional building. Manual interaction (E) also toggles it.
 *  · It swings AWAY from the approaching person, so the door never sweeps through them.
 *  · Its physics collider is kinematic and follows the leaf, so a closed door genuinely blocks
 *    the player and an open one genuinely doesn't. A door you can walk through while it is shut
 *    breaks presence instantly.
 *
 * Motion uses a critically-damped approach to the target angle rather than a linear tween, so it
 * eases naturally and can be interrupted mid-swing without snapping.
 */

type DoorProps = {
  position: [number, number, number];
  rotation?: [number, number, number];
  width?: number;
  height?: number;
  /** Which way the leaf swings when unobstructed. */
  hinge?: "left" | "right";
  /** Player world position, for proximity opening. */
  playerPosition?: THREE.Vector3 | null;
  /** Distance at which the door begins to open. */
  triggerDistance?: number;
  /** Disables auto-open; door then only responds to interaction. */
  manualOnly?: boolean;
  reducedMotion?: boolean;
};

const OPEN_ANGLE = Math.PI * 0.52; // ~94°, slightly past square as real doors rest

export function Door({
  position,
  rotation = [0, 0, 0],
  width = 0.92,
  height = 2.1,
  hinge = "left",
  playerPosition = null,
  triggerDistance = 2.4,
  manualOnly = false,
  reducedMotion = false,
}: DoorProps) {
  const pivot = useRef<THREE.Group>(null);
  const collider = useRef<RapierRigidBody>(null);
  const angle = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const worldPos = useRef(new THREE.Vector3());
  const localPlayer = useRef(new THREE.Vector3());
  const hingeSign = hinge === "left" ? 1 : -1;

  useFrame((_, delta) => {
    if (!pivot.current) return;

    let target = 0;
    let swingSign = hingeSign;

    if (playerPosition) {
      pivot.current.getWorldPosition(worldPos.current);
      const distance = worldPos.current.distanceTo(playerPosition);

      if (!manualOnly && distance < triggerDistance) {
        target = OPEN_ANGLE;
        // Swing away from the approaching player: transform them into the door's local space and
        // read which side of the door plane they are on.
        localPlayer.current.copy(playerPosition);
        pivot.current.parent?.worldToLocal(localPlayer.current);
        swingSign = localPlayer.current.z > 0 ? -hingeSign : hingeSign;
      } else if (isOpen && manualOnly) {
        target = OPEN_ANGLE;
      }
    }

    const desired = target * swingSign;
    // Critically-damped ease. reducedMotion snaps instantly — a swinging door is exactly the
    // kind of peripheral motion that triggers vestibular discomfort.
    if (reducedMotion) {
      angle.current = desired;
    } else {
      angle.current = THREE.MathUtils.damp(angle.current, desired, 6.5, delta);
    }
    pivot.current.rotation.y = angle.current;

    // Keep the kinematic collider aligned with the swung leaf, so a closed door genuinely blocks
    // the player and an open one genuinely doesn't. The leaf's centre orbits the hinge, so its
    // offset from the closed position is derived from the swing angle about that pivot.
    if (collider.current) {
      const half = width / 2;
      const yaw = rotation[1] ?? 0;
      // Leaf centre relative to the hinge, in the door's local frame, after swinging.
      const localX = -hingeSign * half + hingeSign * half * Math.cos(angle.current);
      const localZ = hingeSign * half * Math.sin(angle.current);
      // Rotate that local offset into world space by the door group's own yaw.
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      collider.current.setNextKinematicTranslation({
        x: position[0] + localX * cos + localZ * sin,
        y: position[1] + height / 2,
        z: position[2] - localX * sin + localZ * cos,
      });
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + angle.current, 0));
      collider.current.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  });

  return (
    <group position={position} rotation={rotation}>
      <DoorFrame width={width} height={height} />

      {/* Hinge pivot sits at the leaf edge, so the door swings on its hinge like a real one. */}
      <group ref={pivot} position={[-hingeSign * (width / 2), 0, 0]}>
        <group
          position={[hingeSign * (width / 2), 0, 0]}
          onClick={(event) => {
            event.stopPropagation();
            setIsOpen((value) => !value);
          }}
        >
          {/* Leaf: a rail-and-stile door, not a flat slab. The recessed centre panel is what
              makes it read as joinery rather than a rectangle. */}
          <mesh position={[0, height / 2, 0]} castShadow receiveShadow material={M.oak}>
            <boxGeometry args={[width, height, 0.042]} />
          </mesh>
          <mesh position={[0, height / 2, 0.001]} castShadow material={M.walnut}>
            <boxGeometry args={[width * 0.74, height * 0.82, 0.046]} />
          </mesh>

          {/* Lever handle + backplate, both faces. */}
          {[0.032, -0.032].map((z) => (
            <group key={z} position={[hingeSign * (width * 0.34), 1.05, z]}>
              <mesh castShadow material={M.steel}>
                <cylinderGeometry args={[0.026, 0.026, 0.02, 12]} />
              </mesh>
              <mesh position={[-hingeSign * 0.055, 0, Math.sign(z) * 0.03]} rotation={[Math.PI / 2, 0, 0]} castShadow material={M.steel}>
                <cylinderGeometry args={[0.014, 0.014, 0.11, 10]} />
              </mesh>
            </group>
          ))}

          {/* Hinges — three, as on any real full-height door. */}
          {[0.28, height / 2, height - 0.28].map((y) => (
            <mesh key={y} position={[-hingeSign * (width / 2 - 0.012), y, 0]} castShadow material={M.steel}>
              <cylinderGeometry args={[0.017, 0.017, 0.1, 10]} />
            </mesh>
          ))}
        </group>
      </group>

      {/* Kinematic collider tracking the leaf. */}
      <RigidBody
        ref={collider}
        type="kinematicPosition"
        colliders="cuboid"
        position={[position[0], position[1] + height / 2, position[2]]}
      >
        <mesh visible={false}>
          <boxGeometry args={[width, height, 0.05]} />
        </mesh>
      </RigidBody>
    </group>
  );
}
