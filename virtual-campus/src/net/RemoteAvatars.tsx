import { Html, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { PeerState } from "./useCampusNetwork";

/**
 * Other real people, rendered from network state.
 *
 * The critical detail here is INTERPOLATION. Network updates arrive at ~15Hz; applying them
 * directly to a transform produces visible 15-step-per-second stuttering that instantly reads as
 * "networked game" rather than "person walking". Instead each avatar damps toward its latest
 * received position every frame, so 15Hz of data renders as continuous 60fps motion. Rotation is
 * interpolated on the shortest arc so an avatar turning past -180°/+180° doesn't spin the wrong
 * way round.
 *
 * Avatars also lean slightly into their movement direction and bob while walking — small
 * procedural touches that cost nothing and do a lot to stop a moving model looking like a
 * sliding statue.
 */

const AVATAR_URL = "/models/student-avatar.glb";

export function RemoteAvatars({
  peers,
  showLabels = true,
}: {
  peers: PeerState[];
  showLabels?: boolean;
}) {
  return (
    <group>
      {peers.map((peer) => (
        <RemoteAvatar key={peer.id} peer={peer} showLabel={showLabels} />
      ))}
    </group>
  );
}

function RemoteAvatar({ peer, showLabel }: { peer: PeerState; showLabel: boolean }) {
  const group = useRef<THREE.Group>(null);
  const model = useRef<THREE.Group>(null);
  const { scene } = useGLTF(AVATAR_URL);

  // Each peer needs its own skinned copy — sharing one scene would make every avatar move
  // identically.
  const avatar = useMemo(() => {
    const clone = cloneSkeleton(scene);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        // Tint per person so individuals are distinguishable at a glance. Cloned material so
        // one peer's colour doesn't bleed onto everyone.
        if (child.material) {
          const material = (child.material as THREE.MeshStandardMaterial).clone();
          material.color = new THREE.Color(peer.color).lerp(new THREE.Color("#ffffff"), 0.55);
          material.envMapIntensity = 0.8;
          child.material = material;
        }
      }
    });
    return clone;
  }, [scene, peer.color]);

  const walkPhase = useRef(0);
  const lastPosition = useRef(new THREE.Vector3(...peer.position));

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;

    const target = peer.position;
    const seated = peer.animation === "sitting";

    // Damp toward the networked position. The rate is a compromise: too low and avatars lag
    // visibly behind their real location, too high and the 15Hz stepping shows through.
    node.position.x = THREE.MathUtils.damp(node.position.x, target[0], 9, delta);
    node.position.z = THREE.MathUtils.damp(node.position.z, target[2], 9, delta);
    // A seated avatar's hips drop to the seat pad height.
    const targetY = seated ? target[1] - 0.42 : target[1];
    node.position.y = THREE.MathUtils.damp(node.position.y, targetY, 12, delta);

    // Shortest-arc rotation interpolation.
    let deltaAngle = peer.rotation - node.rotation.y;
    while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
    while (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
    node.rotation.y += deltaAngle * Math.min(1, delta * 10);

    // Procedural locomotion: bob and lean derived from actual measured speed, so it always
    // matches how fast the avatar is really travelling rather than a fixed animation.
    const speed = lastPosition.current.distanceTo(new THREE.Vector3(target[0], target[1], target[2])) / Math.max(delta, 0.001);
    lastPosition.current.set(target[0], target[1], target[2]);

    if (model.current) {
      if (seated) {
        model.current.position.y = 0;
        model.current.rotation.x = 0;
      } else {
        const moving = peer.animation === "walking" || peer.animation === "running";
        const cadence = peer.animation === "running" ? 11 : 7;
        walkPhase.current += delta * cadence * (moving ? 1 : 0);
        model.current.position.y = moving ? Math.abs(Math.sin(walkPhase.current)) * 0.045 : 0;
        model.current.rotation.x = THREE.MathUtils.damp(
          model.current.rotation.x,
          moving ? Math.min(0.09, speed * 0.012) : 0,
          8,
          delta,
        );
      }
    }
  });

  return (
    <group ref={group} position={peer.position}>
      <group ref={model}>
        <primitive object={avatar} scale={1} />
      </group>

      {showLabel && (
        <Html
          position={[0, 1.95, 0]}
          center
          distanceFactor={9}
          // Occlusion by raycast so a name tag behind a wall doesn't float through it.
          occlude="raycast"
          style={{ pointerEvents: "none" }}
        >
          <div className={`peer-tag${peer.speaking ? " is-speaking" : ""}`}>
            <span className="peer-dot" style={{ background: peer.color }} />
            {peer.name}
            {peer.speaking && <span className="peer-speaking" aria-hidden="true" />}
          </div>
        </Html>
      )}
    </group>
  );
}

useGLTF.preload(AVATAR_URL);
